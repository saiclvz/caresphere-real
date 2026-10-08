const { pool, withTransaction } = require('../config/db');
const Adoption = require('../models/adoptionModel');
const HttpError = require('../utils/HttpError');
const { saveUpload, readUpload, deleteUpload, verifyUpload, MB } = require('../utils/files');
const { toInt } = require('../utils/validate');
const { logActivity } = require('../utils/audit');
const {
  DOCUMENTS, STAGE_DOCUMENTS, PAGES, FILE_RULES, CONSENT_VERSION, PRIVACY_NOTICE, APPLICATION_TYPES, FIELDS, isVisible, formConfig,
} = require('../config/adoptionForm');
const WF = require('../config/adoptionWorkflow');
const { clean, validatePage, validateSubmission } = require('../services/adoptionValidation');
const workflow = require('../services/adoptionWorkflow');
const P = require('../services/protectedRecords');
const { watermarkFile } = require('../services/watermark');
const U = require('../services/unlockService');
const Notify = require('../services/notifications');
const Settings = require('../models/settingsModel');
const S = require('../config/adoptionSensitive');
const { isPublicRef, normalizePublicRef, formatPublicRef } = require('../utils/publicRef');
const { deviceType } = require('../utils/device');

const DOC_OPTS = { folder: 'adoption-docs', allowed: FILE_RULES.extensions, maxBytes: 10 * MB };
const NOT_FOUND = 'Application not found.';
const docDef = (type) => DOCUMENTS[type] || STAGE_DOCUMENTS[type] || null;
/** Donors see their own form documents and forum certificate, never staff or protected documents. */
const donorCanSee = (d) => !d.protected_record_id && (Boolean(DOCUMENTS[d.doc_type]) || d.doc_type === 'forum_certificate');

/**
 * Loads an application the current user may see. Every "no" is the same 404, so a
 * donor can't tell another donor's application from one that doesn't exist.
 *  - Donor: own applications only (drafts included).
 *  - Admin/Staff: submitted applications (drafts stay private to the donor).
 */
async function loadForUser(req, id) {
  const app = await Adoption.findById(id);
  if (!app) throw new HttpError(404, NOT_FOUND);
  if (req.user.role === 'Donor' && app.applicant_id !== req.user.user_id) throw new HttpError(404, NOT_FOUND);
  if (req.user.role !== 'Donor' && app.status === 'Draft') throw new HttpError(404, NOT_FOUND);
  return app;
}

async function loadById(req) {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) throw new HttpError(404, NOT_FOUND);
  return loadForUser(req, id);
}

/** 9-page documents with Done / Missing / Optional, for the visible types (and any type with files). */
function checklist(form, documents, isLegacy) {
  const current = documents.filter((d) => d.status !== 'Replaced');
  return Object.entries(DOCUMENTS)
    .filter(([key, def]) => isVisible(def, form) || current.some((d) => d.doc_type === key))
    .map(([key, def]) => {
      const files = current.filter((d) => d.doc_type === key);
      const required = def.required && isVisible(def, form) && !isLegacy;
      return { doc_type: key, label: def.label, page: def.page, multiple: def.multiple, required, status: files.length ? 'Done' : required ? 'Missing' : 'Optional', files };
    });
}

/** The current stage in plain language, for the 4-phase tracker. */
function stageInfo(status) {
  const s = WF.STAGES[status] || {};
  return { status, phase: s.phase || null, phase_index: WF.phaseIndex(status), description: s.donor || '', next_step: s.next || null };
}

/**
 * Need-to-know access (config/adoptionSensitive.js). Admin: always open. Staff: only the staff
 * member assigned to the application, and only during an unlock session (X-Unlock-Session) that
 * the server verified. Nothing stored in the browser can open a record by itself.
 */
async function sensitiveAccess(req, app) {
  if (req.user.role === 'Admin') return { unlocked: true, assigned: true, admin: true };
  const assigned = app.assigned_staff_id === req.user.user_id && !!app.assigned_staff_active;
  if (!assigned) return { unlocked: false, assigned: false };
  const s = await U.sessionFor(req, 'adoption_application', app.application_id);
  return { unlocked: Boolean(s), assigned: true, expires_at: s?.expires_at || null, remaining_seconds: s?.remaining_seconds || 0, purpose: s?.purpose || null };
}

/** Throws unless the user may see this application's sensitive sections. */
async function requireSensitive(req, app, what) {
  const access = await sensitiveAccess(req, app);
  if (!access.assigned) throw new HttpError(403, U.NOT_ASSIGNED, { not_assigned: true });
  if (!access.unlocked) throw new HttpError(403, `${what} is in a locked section. Unlock the sensitive sections first.`, { locked: true });
  return access;
}

/** Staff may act on an application (record a stage, upload their documents) only when assigned to it. */
function requireAssigned(req, app) {
  if (req.user.role === 'Staff' && !(app.assigned_staff_id === req.user.user_id && app.assigned_staff_active)) throw new HttpError(403, U.NOT_ASSIGNED, { not_assigned: true });
}

/** Assignment as shown to everyone: a deactivated staff account shows as unassigned (and is flagged). */
const assignmentOf = (app) => ({
  assigned_staff: app.assigned_staff_id && app.assigned_staff_active ? { user_id: app.assigned_staff_id, name: app.assigned_staff_name } : null,
  assignment_flag: app.assigned_staff_id && !app.assigned_staff_active ? `Assigned to ${app.assigned_staff_name}, whose account is deactivated` : null,
  assigned_by_name: app.assigned_by_name || null, assigned_at: app.assigned_at || null,
});

/**
 * What a locked Staff member receives: only the non-sensitive rows (reference, status, submission
 * date, assigned staff, QR link) and a masked name. Nothing else leaves the server.
 */
function lockedView(req, app, access) {
  return {
    application_id: app.application_id, reference_no: app.reference_no, status: app.status, status_label: app.status,
    submitted_at: app.submitted_at, applicant_masked: S.maskName(app.legal_name),
    ...assignmentOf(app), assignment_flag: undefined,
    locked: true,
    sensitive: { unlocked: false, assigned: access.assigned, sections: S.SENSITIVE_ADOPTION.map(({ key, label }) => ({ key, label })) },
    // Assigned Staff can still record a stage while locked (that reveals nothing); notes need an unlock.
    allowed_statuses: access.assigned && !app.archived_at ? WF.allowedTargets(app.status, app.application_type, req.user.role) : [],
  };
}

/**
 * The full application for the current user. Donors never get internal notes, staff names,
 * case study contents, protected or staff documents, or the finalize details.
 */
async function fullApplication(req, app) {
  const forDonor = req.user.role === 'Donor';
  const id = app.application_id;
  // Staff without an unlock get the locked view: the sensitive data is never loaded or sent.
  const access = forDonor ? null : await sensitiveAccess(req, app);
  if (access && !access.unlocked) return lockedView(req, app, access);
  const [form, allDocs, history, requests, interviews] = await Promise.all([
    Adoption.form(id), Adoption.documents(id), Adoption.history(id, { forDonor }),
    Adoption.requests(id, { forDonor }), Adoption.interviews(id, { forDonor }),
  ]);
  const documents = forDonor
    ? allDocs.filter(donorCanSee).map(({ uploaded_by_name, uploaded_by, protected_record_id, protected_public_id, sha256, ...d }) => d)
    : allDocs.map(({ sha256, ...d }) => ({ ...d, has_hash: Boolean(sha256), is_protected: Boolean(d.protected_record_id) }));
  const base = {
    application_id: id, reference_no: app.reference_no, application_type: app.application_type,
    application_type_label: APPLICATION_TYPES[app.application_type]?.label || app.application_type,
    status: app.status, status_label: app.status, stage: stageInfo(app.status), phases: WF.PHASES,
    current_page: app.current_page, is_legacy: !!app.is_legacy, submitted_at: app.submitted_at, created_at: app.created_at,
    updated_at: app.updated_at, withdrawn_at: app.withdrawn_at, consented_at: app.consented_at,
    matched_child: app.matched_child_id ? { display_name: `${app.child_first_name} ${app.child_last_initial}.` } : null,
    trial: app.trial_start ? { start: app.trial_start, end: app.trial_end } : null,
    form, history, requests, interviews, documents,
    checklist: checklist(form, documents, !!app.is_legacy),
    can_withdraw: WF.WITHDRAWABLE.includes(app.status) && !app.archived_at,
    can_edit: app.status === 'Draft',
    can_upload_forum_certificate: forDonor && WF.PREPARATION.includes(app.status),
  };
  if (forDonor) return base;
  const isAdmin = req.user.role === 'Admin';
  return {
    ...base,
    applicant_id: app.applicant_id,
    matched_child: app.matched_child_id ? {
      ...base.matched_child, child_id: app.matched_child_id, full_name: app.child_full_name, age: app.child_age, status: app.child_status,
      placement_status: app.child_placement, cdclaa_verified: !!app.child_cdclaa_verified,
    } : null,
    milestones: {
      forum_verified_at: app.forum_verified_at, case_study_completed_at: app.case_study_completed_at, cleared_at: app.cleared_at,
      matched_at: app.matched_at, trial_start: app.trial_start, trial_end: app.trial_end, trial_completed_at: app.trial_completed_at,
      placement_ended_at: app.placement_ended_at, petition_date: app.petition_date, racco_office: app.racco_office, published_at: app.published_at,
      appearance_date: app.appearance_date, endorsed_date: app.endorsed_date, nacc_deadline: app.nacc_deadline,
      order_number: app.order_number, order_date: app.order_date, civil_registry_ref: app.civil_registry_ref, closed_at: app.closed_at,
      finalized_at: app.finalized_at, decided_at: app.decided_at,
    },
    deadlines: workflow.deadlines(app),
    consent_version: app.consent_version, privacy_notice_version: app.privacy_notice_version,
    archived_at: app.archived_at, archive_reason: app.archive_reason,
    legacy: Adoption.legacy(app),
    notes: await Adoption.notes(id),
    public_ref: app.public_ref, public_ref_display: formatPublicRef(app.public_ref),
    ...assignmentOf(app),
    locked: false,
    sensitive: {
      unlocked: true, admin: isAdmin, assigned: true, expires_at: access.expires_at || null,
      remaining_seconds: access.remaining_seconds || 0, purpose: access.purpose || null,
    },
    stage_documents: Object.entries(STAGE_DOCUMENTS).map(([key, def]) => ({
      doc_type: key, label: def.label, multiple: def.multiple, protected: Boolean(def.protected),
      can_upload: def.uploaders.includes(req.user.role) && !WF.FINAL.includes(app.status),
      files: documents.filter((d) => d.doc_type === key && d.status !== 'Replaced'),
    })),
    allowed_statuses: app.archived_at ? [] : WF.allowedTargets(app.status, app.application_type, req.user.role),
    protected_records: isAdmin ? await P.listRecords({ applicationId: id }) : undefined,
  };
}

/** Every view is logged; Staff and Admin views of the unlocked sections also go to the access log with the purpose. */
async function logView(req, app, sensitive) {
  const scope = sensitive ? (sensitive.unlocked ? ', sensitive sections included' : ', sensitive sections locked') : '';
  await logActivity(req, `VIEW_ADOPTION_APPLICATION (${deviceType(req) || 'unknown device'}${scope})`, `Application #${app.application_id}`);
  if (sensitive?.unlocked) {
    await U.logEvent(req, { recordType: 'adoption_application', recordId: app.application_id, event: 'view_sections',
      purpose: sensitive.admin ? 'Admin full access' : sensitive.purpose });
  }
}

// ------------------------------------------------------------------ shared

/** GET /api/adoptions/form-config - the 9 pages, documents, options, address lists, privacy notice, workflow. */
exports.formConfig = async (req, res) => {
  res.json({
    success: true,
    data: { ...formConfig(), statuses: WF.STATUSES, status_labels: Adoption.LABELS, phases: WF.PHASES,
      stages: Object.fromEntries(Object.entries(WF.STAGES).map(([k, v]) => [k, { phase: v.phase, description: v.donor, next_step: v.next }])) },
  });
};

/** GET /api/adoptions/:id - every view is audit-logged (RA 8792). */
exports.getOne = async (req, res) => {
  const app = await loadById(req);
  const data = await fullApplication(req, app);
  await logView(req, app, data.sensitive);
  res.json({ success: true, data });
};

async function loadDocument(req) {
  const app = await loadById(req);
  const docId = toInt(req.params.docId, 'docId', { min: 1 });
  const doc = (await Adoption.documents(app.application_id)).find((d) => d.document_id === docId);
  if (!doc) throw new HttpError(404, 'Document not found.');
  if (req.user.role === 'Donor' && !donorCanSee(doc)) throw new HttpError(404, 'Document not found.');
  let access = null;
  if (req.user.role !== 'Donor') access = await requireSensitive(req, app, 'This document');
  if (req.user.role === 'Staff' && doc.protected_record_id) {
    throw new HttpError(403, 'This is a protected record. Ask an administrator for a token, then open it from its Protected record QR.');
  }
  const full = await Adoption.document(app.application_id, docId);
  return { app, doc: { ...full, protected_record_id: doc.protected_record_id }, access };
}

/** GET /api/adoptions/:id/documents/:docId - permission-checked, logged, with an integrity check header. */
/**
 * GET /api/adoptions/:id/documents/:docId[?download=1]
 * Staff (unlocked): a preview watermarked with their name and the time. Downloading is allowed only
 * for document types Admin enabled in Settings (staff_download_doc_types), also watermarked.
 * Admin: the original file. Every view and download is logged with the purpose.
 */
exports.downloadDocument = async (req, res) => {
  const { app, doc, access } = await loadDocument(req);
  const download = req.query.download === '1';
  const isStaff = req.user.role === 'Staff';
  if (download && isStaff) {
    const allowed = String((await Settings.getAll()).staff_download_doc_types || '').split(',').map((x) => x.trim());
    if (!allowed.includes(doc.doc_type)) throw new HttpError(403, 'Downloading this document type is not allowed for Staff. You can view it here.');
  }
  const verified = verifyUpload(doc.storage_key, doc.sha256);
  let body = readUpload(doc.storage_key);
  let mime = doc.mime_type;
  if (isStaff) { body = await watermarkFile(body, doc.mime_type, req.user); mime = 'application/pdf'; }
  await logActivity(req, `${download ? 'DOWNLOAD' : 'VIEW'}_ADOPTION_DOCUMENT (${doc.doc_type})`, `Application #${app.application_id}`);
  if (access) {
    await U.logEvent(req, { recordType: 'adoption_application', recordId: app.application_id, event: download ? 'download_document' : 'view_document',
      purpose: access.admin ? 'Admin full access' : access.purpose, detail: `document #${doc.document_id}` });
  }
  const base = doc.original_name.replace(/\.[^.]+$/, '').replace(/["\r\n]/g, '') || 'document';
  const name = mime === 'application/pdf' && isStaff ? `${base}-watermarked.pdf` : doc.original_name.replace(/["\r\n]/g, '');
  res.setHeader('Content-Type', mime);
  res.setHeader('Content-Disposition', `${download ? 'attachment' : 'inline'}; filename="${name}"`);
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-File-Verified', verified === null ? 'unknown' : String(verified));
  res.send(body);
};

/** GET /api/adoptions/:id/documents/:docId/verify - does the stored file still match its SHA-256? */
exports.verifyDocument = async (req, res) => {
  const { app, doc } = await loadDocument(req);
  const verified = verifyUpload(doc.storage_key, doc.sha256);
  await logActivity(req, `VERIFY_ADOPTION_DOCUMENT (${verified === null ? 'no hash' : verified ? 'match' : 'MISMATCH'})`, `Application #${app.application_id}`);
  res.json({ success: true, data: { document_id: doc.document_id, verified, has_hash: Boolean(doc.sha256) } });
};

// ------------------------------------------------------------------ donor

/** GET /api/adoptions/mine (Donor) - own applications, with open document requests and the current stage. */
/**
 * Donor summary tracker: Submitted, Under review, Documents requested, Interview or home visit,
 * Decision. Each step has the date it was first reached (from the status history and requests).
 */
const PROGRESS_STEPS = [
  { key: 'submitted', label: 'Submitted', statuses: ['Submitted'] },
  { key: 'review', label: 'Under review', statuses: ['Initial review'] },
  { key: 'documents', label: 'Documents requested', statuses: [] },
  { key: 'visit', label: 'Interview or home visit', statuses: ['Home study scheduled', 'Home study completed'] },
  { key: 'decision', label: 'Decision', statuses: ['Cleared for matching', 'Declined', 'Withdrawn'] },
];
async function progressFor(ids) {
  if (!ids.length) return {};
  const [hist] = await pool.query('SELECT application_id, to_status, MIN(created_at) AS at FROM tbl_application_status_history WHERE application_id IN (?) GROUP BY application_id, to_status', [ids]);
  const [reqs] = await pool.query('SELECT application_id, MIN(requested_at) AS at FROM tbl_application_document_requests WHERE application_id IN (?) GROUP BY application_id', [ids]);
  const out = {};
  for (const id of ids) {
    const h = hist.filter((x) => x.application_id === id);
    const first = (statuses) => h.filter((x) => statuses.includes(x.to_status)).map((x) => x.at).sort()[0] || null;
    const decision = h.find((x) => ['Cleared for matching', 'Declined', 'Withdrawn'].includes(x.to_status));
    out[id] = PROGRESS_STEPS.map((st) => ({
      key: st.key, label: st.key === 'decision' && decision ? (decision.to_status === 'Cleared for matching' ? 'Approved' : decision.to_status) : st.label,
      reached_at: st.key === 'documents' ? (reqs.find((r) => r.application_id === id)?.at || null) : first(st.statuses),
    }));
  }
  return out;
}

exports.mine = async (req, res) => {
  const rows = await Adoption.list({ applicantId: req.user.user_id, includeArchived: true });
  const unread = await require('../services/notifications').unreadByApplication(req.user.user_id);
  const progress = await progressFor(rows.filter((r) => r.status !== 'Draft').map((r) => r.application_id));
  res.json({
    success: true,
    data: rows.map((r) => ({
      application_id: r.application_id, reference_no: r.reference_no, application_type: r.application_type, status: r.status,
      status_label: r.status, stage: stageInfo(r.status), submitted_at: r.submitted_at, created_at: r.created_at, updated_at: r.updated_at,
      open_requests: Number(r.open_requests), unread_notifications: unread[r.application_id] || 0, progress: progress[r.application_id] || null,
      matched_child: r.matched_child_id ? { display_name: `${r.child_first_name} ${r.child_last_initial}.` } : null,
    })),
  });
};

/** POST /api/adoptions (Donor) { application_type: Regular|Relative } - starts a draft. One active application per donor. */
exports.createDraft = async (req, res) => {
  const type = req.body?.application_type ? String(req.body.application_type) : 'Regular';
  if (!APPLICATION_TYPES[type]) throw new HttpError(400, 'Choose Regular or Relative/Stepchild.');
  const result = await withTransaction(async (conn) => {
    const active = await Adoption.activeFor(conn, req.user.user_id);
    if (active) return { existing: active };
    return { id: await Adoption.createDraft(conn, req.user, type) };
  });
  if (result.existing) {
    throw new HttpError(409, `You already have an active application (${result.existing.reference_no || 'draft'}, ${result.existing.status}). Open it from My applications.`,
      { existing_application_id: result.existing.application_id });
  }
  await logActivity(req, `ADOPTION_DRAFT_CREATED (${type})`, `Application #${result.id}`);
  res.status(201).json({ success: true, data: await fullApplication(req, await Adoption.findById(result.id)) });
};

/**
 * PUT /api/adoptions/:id (Donor, Draft only) { data, current_page, validate_page?, application_type? }
 * Autosave: stores whatever was typed (cleaned). With validate_page, also returns that page's errors.
 */
exports.saveDraft = async (req, res) => {
  const app = await loadById(req);
  if (req.user.role !== 'Donor') throw new HttpError(403, 'Only the applicant can edit a draft.');
  if (app.status !== 'Draft') throw new HttpError(409, 'Only a draft can be edited. Submitted applications are read-only.');
  const data = clean(req.body?.data);
  const page = req.body?.current_page === undefined ? null : toInt(req.body.current_page, 'current_page', { min: 1, max: PAGES.length });
  const type = req.body?.application_type;
  if (type !== undefined && !APPLICATION_TYPES[type]) throw new HttpError(400, 'Choose Regular or Relative/Stepchild.');
  await withTransaction(async (conn) => {
    await Adoption.saveForm(conn, app.application_id, data);
    await conn.query('UPDATE tbl_adoption_applications SET current_page = COALESCE(?, current_page), application_type = COALESCE(?, application_type), updated_at = NOW() WHERE application_id = ?',
      [page, type ?? null, app.application_id]);
  });
  let validation;
  if (req.body?.validate_page !== undefined) {
    const vp = toInt(req.body.validate_page, 'validate_page', { min: 1, max: PAGES.length });
    const errors = validatePage(vp, await Adoption.form(app.application_id));
    validation = { page: vp, valid: !Object.keys(errors).length, errors };
  }
  res.json({ success: true, data: { saved_at: new Date().toISOString(), validation } });
};

/**
 * POST /api/adoptions/:id/submit (Donor) { consent: true, consent_version, privacy_notice_version }
 * Full server check, consent record (versions + time), then a reference number.
 */
exports.submit = async (req, res) => {
  const app = await loadById(req);
  if (req.user.role !== 'Donor') throw new HttpError(403, 'Only the applicant can submit.');
  if (app.status !== 'Draft') throw new HttpError(409, 'This application has already been submitted.');
  if (req.body?.consent === true && (req.body.consent_version !== CONSENT_VERSION || req.body.privacy_notice_version !== PRIVACY_NOTICE.version)) {
    throw new HttpError(409, 'The privacy notice or consent text has changed. Reload the page, read it again and tick the box.');
  }
  const check = validateSubmission(await Adoption.form(app.application_id), await Adoption.documents(app.application_id), req.body?.consent === true);
  if (!check.ok) {
    throw new HttpError(422, 'Some required items are missing. Check the highlighted pages.', {
      pages: check.pages, missing_documents: check.missing_documents, consent: check.consent,
    });
  }
  const reference = await withTransaction(async (conn) => {
    const [[cur]] = await conn.query('SELECT status FROM tbl_adoption_applications WHERE application_id = ? FOR UPDATE', [app.application_id]);
    if (cur.status !== 'Draft') throw new HttpError(409, 'This application has already been submitted.');
    const other = await Adoption.activeFor(conn, req.user.user_id, app.application_id);
    if (other) throw new HttpError(409, 'You already have another active application.');
    const ref = await Adoption.nextReference(conn);
    await conn.query(
      `UPDATE tbl_adoption_applications SET status = 'Submitted', reference_no = ?, submitted_at = NOW(), declaration_accepted = TRUE,
              consented_at = NOW(), consent_version = ?, privacy_notice_version = ?, current_page = 9 WHERE application_id = ?`,
      [ref, CONSENT_VERSION, PRIVACY_NOTICE.version, app.application_id]);
    const historyId = await Adoption.addHistory(conn, { application_id: app.application_id, from_status: 'Draft', to_status: 'Submitted', changed_by: req.user.user_id });
    // Same transaction: the applicant's confirmation and an "action required" for every Admin.
    const params = { id: app.application_id, ref };
    await Notify.adoptionStatus(conn, { applicantId: req.user.user_id, applicationId: app.application_id, reference: ref, status: 'Submitted', historyId });
    await Notify.toAdmins(conn, 'admin_application_submitted', { entityType: 'application', entityId: app.application_id, params, groupKey: `admin_submitted:${app.application_id}` });
    return ref;
  });
  await logActivity(req, `ADOPTION_SUBMITTED (${reference}, consent ${CONSENT_VERSION}, notice ${PRIVACY_NOTICE.version})`, `Application #${app.application_id}`);
  res.json({ success: true, data: await fullApplication(req, await Adoption.findById(app.application_id)) });
};

/** POST /api/adoptions/:id/withdraw (Donor) - any stage before the Order of Adoption; kept on file. */
exports.withdraw = async (req, res) => {
  const app = await loadById(req);
  if (req.user.role !== 'Donor') throw new HttpError(403, 'Only the applicant can withdraw an application.');
  const from = await workflow.withdraw(app, req.user.user_id);
  await logActivity(req, `ADOPTION_WITHDRAWN (from ${from})`, `Application #${app.application_id}`);
  res.json({ success: true, data: await fullApplication(req, await Adoption.findById(app.application_id)) });
};

/**
 * POST /api/adoptions/:id/documents { doc_type, file: { name, data } }
 *  - Donor: form documents while Draft; afterwards only requested types, and the forum
 *    certificate during Preparation.
 *  - Staff: workflow documents they record (case study, monitoring reports, publication proof).
 *  - Admin: any document.
 * PDF/PNG/JPG checked by contents, 10 MB, random name, encrypted, SHA-256 recorded.
 * Case study, monitoring reports, Order of Adoption and Certificate of Finality become protected records.
 */
exports.uploadDocument = async (req, res) => {
  const app = await loadById(req);
  const role = req.user.role;
  const docType = String(req.body?.doc_type || '');
  const def = docDef(docType);
  if (!def) throw new HttpError(400, 'Choose a document type from the list.');
  if (WF.FINAL.includes(app.status) || app.archived_at) throw new HttpError(409, `Documents can no longer be added to an application that is ${app.status}.`);
  const isStage = Boolean(STAGE_DOCUMENTS[docType]);

  let requests = [];
  if (role === 'Donor') {
    if (app.status === 'Draft') {
      if (isStage) throw new HttpError(409, 'Upload this after you submit your application.');
    } else {
      requests = (await Adoption.requests(app.application_id)).filter((r) => r.status === 'Open' && r.doc_type === docType);
      const forumOk = docType === 'forum_certificate' && WF.PREPARATION.includes(app.status);
      if (!requests.length && !forumOk) throw new HttpError(409, 'This document has not been requested. After submitting, you can only add documents the home asks for.');
    }
  } else if (role === 'Staff') {
    requireAssigned(req, app);
    if (!isStage || !STAGE_DOCUMENTS[docType].uploaders.includes('Staff')) throw new HttpError(403, 'Staff can upload the case study, monitoring reports and proof of publication.');
  }
  const existing = (await Adoption.documents(app.application_id)).filter((d) => d.doc_type === docType && d.status !== 'Replaced');
  if (def.multiple && existing.length >= FILE_RULES.maxFilesPerType) throw new HttpError(400, `Up to ${FILE_RULES.maxFilesPerType} files for ${def.label}.`);

  const saved = saveUpload(req.body?.file, { ...DOC_OPTS, label: def.label });
  let replacedKeys = [];
  try {
    replacedKeys = await withTransaction(async (conn) => {
      let keys = [];
      if (!def.multiple && existing.length) {
        if (app.status === 'Draft') {
          const [old] = await conn.query("SELECT storage_key FROM tbl_adoption_documents WHERE application_id = ? AND doc_type = ? AND status = 'Uploaded'", [app.application_id, docType]);
          keys = old.map((o) => o.storage_key);
          await conn.query("DELETE FROM tbl_adoption_documents WHERE application_id = ? AND doc_type = ? AND status = 'Uploaded'", [app.application_id, docType]);
        } else {
          // After submitting, the old file stays on record, marked Replaced.
          await conn.query("UPDATE tbl_adoption_documents SET status = 'Replaced' WHERE application_id = ? AND doc_type = ? AND status = 'Uploaded'", [app.application_id, docType]);
        }
      }
      const documentId = await Adoption.insertDocument(conn, {
        ...saved, application_id: app.application_id, doc_type: docType, page: DOCUMENTS[docType]?.page ?? null,
        uploaded_by: req.user.user_id, request_id: requests[0]?.request_id,
      });
      if (isStage && STAGE_DOCUMENTS[docType].protected) {
        await P.createRecord(conn, { type: STAGE_DOCUMENTS[docType].protected, label: `${def.label}, ${app.reference_no}`,
          applicationId: app.application_id, documentId, childId: app.matched_child_id || null, createdBy: req.user.user_id });
      }
      if (requests.length) {
        await conn.query("UPDATE tbl_application_document_requests SET status = 'Fulfilled', fulfilled_at = NOW() WHERE request_id IN (?)", [requests.map((r) => r.request_id)]);
      }
      // A donor upload after submitting: Admins and the assigned staff member (one row per application, re-surfaced).
      if (role === 'Donor' && app.status !== 'Draft') {
        const params = { id: app.application_id, ref: app.reference_no };
        const common = { entityType: 'application', entityId: app.application_id, params, groupKey: `docs_uploaded:${app.application_id}`, mode: 'set' };
        await Notify.toAdmins(conn, 'admin_documents_uploaded', common);
        if (app.assigned_staff_id && app.assigned_staff_active) await Notify.emit(conn, 'staff_documents_uploaded', { ...common, userId: app.assigned_staff_id });
      }
      return keys;
    });
  } catch (err) {
    deleteUpload(saved.storage_key);
    throw err;
  }
  replacedKeys.forEach(deleteUpload);
  await logActivity(req, `UPLOAD_ADOPTION_DOCUMENT (${docType}${requests.length ? ', requested' : ''})`, `Application #${app.application_id}`);
  res.status(201).json({ success: true, data: await fullApplication(req, await Adoption.findById(app.application_id)) });
};

/** DELETE /api/adoptions/:id/documents/:docId (Donor, Draft only) */
exports.deleteDocument = async (req, res) => {
  const app = await loadById(req);
  if (req.user.role !== 'Donor' || app.status !== 'Draft') throw new HttpError(409, 'Files can only be removed while the application is a draft.');
  const doc = await Adoption.document(app.application_id, toInt(req.params.docId, 'docId', { min: 1 }));
  if (!doc) throw new HttpError(404, 'Document not found.');
  await pool.query('DELETE FROM tbl_adoption_documents WHERE document_id = ?', [doc.document_id]);
  deleteUpload(doc.storage_key);
  await logActivity(req, `REMOVE_ADOPTION_DOCUMENT (${doc.doc_type})`, `Application #${app.application_id}`);
  res.json({ success: true, data: await fullApplication(req, app) });
};

// ------------------------------------------------------------------ staff

/** GET /api/adoptions?phase=&status=&q= (Admin, Staff) - submitted applications; search by reference or applicant name. */
exports.list = async (req, res) => {
  const status = req.query.status ? String(req.query.status) : undefined;
  if (status && (!WF.STATUSES.includes(status) || status === 'Draft')) throw new HttpError(400, 'Choose a status from the list.');
  const phase = req.query.phase ? String(req.query.phase) : undefined;
  let statuses;
  if (phase) {
    if (phase === 'ended') statuses = ['Declined', 'Withdrawn', 'Closed'];
    else if (WF.PHASES.some((p) => p.key === phase)) statuses = WF.STATUSES.filter((s) => WF.STAGES[s].phase === phase && s !== 'Closed');
    else throw new HttpError(400, 'Choose a phase from the list.');
  }
  const isAdmin = req.user.role === 'Admin';
  // Assigned staff filter: Admin "none" or a staff id; anyone "me".
  const assigned = req.query.assigned === 'me' ? req.user.user_id : isAdmin && req.query.assigned ? String(req.query.assigned) : undefined;
  const rows = await Adoption.list({ status, statuses, search: req.query.q, includeArchived: req.query.archived === '1' && isAdmin, referenceSearchOnly: !isAdmin, assigned });
  res.json({
    success: true,
    data: rows.map((r) => {
      const row = { ...r, status_label: r.status, phase: WF.STAGES[r.status]?.phase || null, open_requests: Number(r.open_requests), is_legacy: !!r.is_legacy,
        deadlines: workflow.deadlines(r), assigned_to_me: r.assigned_staff_id === req.user.user_id && !!r.assigned_staff_active,
        assigned_staff_name: r.assigned_staff_active ? r.assigned_staff_name : null,
        assignment_flag: r.assigned_staff_id && !r.assigned_staff_active ? 'Assigned staff account is deactivated' : null };
      if (isAdmin) return row;
      // Staff: only the reference, status, submission date and assigned staff; the name is masked.
      return {
        application_id: r.application_id, reference_no: r.reference_no, status: r.status, status_label: r.status, phase: row.phase,
        submitted_at: r.submitted_at, legal_name: S.maskName(r.legal_name), assigned_staff_id: r.assigned_staff_active ? r.assigned_staff_id : null,
        assigned_staff_name: row.assigned_staff_name, assigned_to_me: row.assigned_to_me, masked: true,
      };
    }),
  });
};

/**
 * PUT /api/adoptions/:id/status (Admin, Staff)
 * { status, remark?, internal_note?, documents?, interview?, child_id?, trial_start?, reason?, petition_date?, racco_office?,
 *   appearance_date?, endorsed_date?, order_number?, order_date?, civil_registry_ref? }
 * Allowed transitions and role rules are enforced on the server (config/adoptionWorkflow.js).
 * Returns last_history_id so a note can be attached to this update.
 */
exports.updateStatus = async (req, res) => {
  const app = await loadById(req);
  const update = workflow.cleanStatusUpdate(app, req.body || {}, req.user.role);
  requireAssigned(req, app);
  if (update.internalNote) await requireSensitive(req, app, 'Adding an internal note');
  const { historyId, closed } = await workflow.applyStatusUpdate(app, update, req.user.user_id);
  const ref = `Application #${app.application_id}`;
  await logActivity(req, `ADOPTION_STATUS (${app.status} -> ${update.target})`, ref);
  if (update.internalNote) await logActivity(req, 'ADOPTION_INTERNAL_NOTE', ref);
  if (update.documents.length) await logActivity(req, `ADOPTION_DOCUMENTS_REQUESTED (${update.documents.map((d) => d.doc_type).join(', ')})`, ref);
  if (update.interview) await logActivity(req, `ADOPTION_HOME_STUDY_SCHEDULED (${update.interview.scheduled_at})`, ref);
  if (update.childId) await logActivity(req, `ADOPTION_CHILD_MATCHED (child ${update.childId})`, ref);
  if (update.target === 'Order of Adoption issued') {
    await logActivity(req, `ADOPTION_FINALIZED (order ${update.fields.order_number})`, ref);
    if (app.matched_child_id) await logActivity(req, 'CHILD_ADOPTED', `Child ${app.matched_child_id}`);
  }
  for (const id of closed) await logActivity(req, 'ADOPTION_AUTO_CLOSED (child adoption finalized)', `Application #${id}`);
  const data = await fullApplication(req, await Adoption.findById(app.application_id));
  res.json({ success: true, data: { ...data, last_history_id: historyId } });
};

/**
 * POST /api/adoptions/:id/notes (Admin, Staff) { history_id, note } - internal note on a status update (decision 3).
 * The status update must be one this reviewer saved.
 */
exports.addNote = async (req, res) => {
  const app = await loadById(req);
  await requireSensitive(req, app, 'Reading or adding internal notes');
  const historyId = Number(req.body?.history_id);
  const note = String(req.body?.note || '').trim();
  if (!Number.isInteger(historyId)) throw new HttpError(409, 'Save a status update first. Notes are attached to a status update.');
  if (!note) throw new HttpError(400, 'Write the note.');
  if (note.length > 5000) throw new HttpError(400, 'A note can be up to 5000 characters.');
  const [[h]] = await pool.query(
    'SELECT history_id, changed_by, to_status FROM tbl_application_status_history WHERE history_id = ? AND application_id = ?', [historyId, app.application_id]);
  if (!h || !h.to_status) throw new HttpError(409, 'Save a status update first. Notes are attached to a status update.');
  if (h.changed_by !== req.user.user_id) throw new HttpError(409, 'Notes can only be added to a status update you saved.');
  await withTransaction((conn) => Adoption.addNote(conn, { application_id: app.application_id, history_id: historyId, author_id: req.user.user_id, note }));
  await logActivity(req, `ADOPTION_INTERNAL_NOTE (on status ${h.to_status})`, `Application #${app.application_id}`);
  res.status(201).json({ success: true, data: await fullApplication(req, app) });
};

/** PUT /api/adoptions/:id/requests/:requestId/close (Admin, Staff) - closes an open document request. */
exports.closeRequest = async (req, res) => {
  const app = await loadById(req);
  await requireSensitive(req, app, 'Document requests');
  const requestId = toInt(req.params.requestId, 'requestId', { min: 1 });
  const [result] = await pool.query(
    "UPDATE tbl_application_document_requests SET status = 'Closed', closed_at = NOW() WHERE request_id = ? AND application_id = ? AND status = 'Open'",
    [requestId, app.application_id]);
  if (!result.affectedRows) throw new HttpError(404, 'That document request is not open.');
  await logActivity(req, 'ADOPTION_DOCUMENT_REQUEST_CLOSED', `Application #${app.application_id}`);
  res.json({ success: true, data: await fullApplication(req, app) });
};

/** POST /api/adoptions/:id/documents/:docId/protect (Admin) - mark any document as a protected record. */
exports.protectDocument = async (req, res) => {
  const app = await loadById(req);
  const docId = toInt(req.params.docId, 'docId', { min: 1 });
  const doc = (await Adoption.documents(app.application_id)).find((d) => d.document_id === docId);
  if (!doc) throw new HttpError(404, 'Document not found.');
  if (doc.protected_record_id) throw new HttpError(409, 'This document is already a protected record.');
  const label = `${docDef(doc.doc_type)?.label || 'Document'}, ${app.reference_no}`;
  await withTransaction((conn) => P.createRecord(conn, { type: 'document', label, applicationId: app.application_id, documentId: docId, createdBy: req.user.user_id }));
  await logActivity(req, `DOCUMENT_MARKED_PROTECTED (${doc.doc_type})`, `Application #${app.application_id}`);
  res.json({ success: true, data: await fullApplication(req, await Adoption.findById(app.application_id)) });
};

/** POST /api/adoptions/:id/archive (Admin) { reason } - soft delete for finished applications. Nothing is ever hard-deleted. */
exports.archive = async (req, res) => {
  const app = await loadById(req);
  if (!WF.FINAL.includes(app.status)) throw new HttpError(409, 'Only Closed, Declined or Withdrawn applications can be archived.');
  if (app.archived_at) throw new HttpError(409, 'This application is already archived.');
  const reason = String(req.body?.reason || '').trim();
  if (reason.length < 5) throw new HttpError(400, 'Give a reason for archiving.');
  await pool.query('UPDATE tbl_adoption_applications SET archived_at = NOW(), archived_by = ?, archive_reason = ? WHERE application_id = ?',
    [req.user.user_id, reason.slice(0, 500), app.application_id]);
  await logActivity(req, 'ADOPTION_ARCHIVED', `Application #${app.application_id}`);
  res.json({ success: true, data: await fullApplication(req, await Adoption.findById(app.application_id)) });
};

/**
 * POST /api/qr-prints (Admin, Staff) { kind: protected, id } - logs a protected-record QR label print.
 * (Application and child QR labels were removed; their old QR_PRINTED log entries stay as they are.)
 */
exports.logQrPrint = async (req, res) => {
  const kind = String(req.body?.kind || '');
  if (kind !== 'protected') throw new HttpError(400, 'Unknown QR kind.');
  const id = String(req.body?.id || '').slice(0, 60);
  const target = kind === 'application' ? `Application #${id}` : kind === 'child' ? `Child ${id}` : `Protected #${id}`;
  await logActivity(req, `QR_PRINTED (${kind}, ${deviceType(req) || 'unknown device'})`, target);
  res.json({ success: true });
};

/** PUT /api/adoptions/:id/assign (Admin) { staff_user_id | null } - shared assignment (services/assignment.js). */
exports.assign = async (req, res) => {
  const app = await loadById(req);
  await require('../services/assignment').assign(req, 'adoption_application', app.application_id, req.body?.staff_user_id, app.reference_no);
  res.json({ success: true, data: await fullApplication(req, await Adoption.findById(app.application_id)) });
};
