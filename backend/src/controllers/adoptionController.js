const { pool, withTransaction } = require('../config/db');
const Adoption = require('../models/adoptionModel');
const HttpError = require('../utils/HttpError');
const { saveUpload, readUpload, discardUnsavedUpload, verifyUpload, MB } = require('../utils/files');
const { toInt, localToday } = require('../utils/validate');
const { logActivity, logActivityWith, logSecurityEvent } = require('../utils/audit');
const {
  DOCUMENTS, STAGE_DOCUMENTS, PAGES, FILE_RULES, CONSENT_VERSION, PRIVACY_NOTICE, APPLICATION_TYPES, FIELDS, isVisible, formConfig, expiresOn, DOCUMENT_STATUSES,
} = require('../config/adoptionForm');
const WF = require('../config/adoptionWorkflow');
const { clean, validatePage, pageCheck, completedPages, reachablePage, validateSubmission, documentChecklist } = require('../services/adoptionValidation');
const workflow = require('../services/adoptionWorkflow');
const P = require('../services/protectedRecords');
const { watermarkFile } = require('../services/watermark');
const U = require('../services/unlockService');
const Notify = require('../services/notifications');
const Verification = require('../services/verification');
const IdScan = require('../services/idScan');
const IdTypes = require('../services/idTypes');
const MalwareScan = require('../services/malwareScan');
const Settings = require('../models/settingsModel');
const S = require('../config/adoptionSensitive');
const { isPublicRef, normalizePublicRef, formatPublicRef } = require('../utils/publicRef');
const { deviceType } = require('../utils/device');

/** Statuses from which the matched child is disclosed to the applicant. */
const DISCLOSED = ['Trial custody', 'Trial custody completed', 'Petition filed', 'Published', 'Mandatory appearance done', 'Endorsed to NACC',
  'Awaiting NACC decision', 'Order of Adoption issued', 'Civil registry updated', 'Closed'];
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
  // One assignment service (primary, backup or temporary cover), checked by the shared policy.
  const assigned = await require('../services/childAccess').isAssigned(req, 'adoption_application', app.application_id);
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
async function requireAssigned(req, app) {
  if (req.user.role === 'Staff' && !(await require('../services/childAccess').isAssigned(req, 'adoption_application', app.application_id))) throw new HttpError(403, U.NOT_ASSIGNED, { not_assigned: true });
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
    application_id: app.application_id, reference_no: app.reference_no, status: app.status, status_label: Adoption.LABELS[app.status] || app.status,
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
    status: app.status, status_label: forDonor ? WF.donorLabel(app.status) : (Adoption.LABELS[app.status] || app.status), stage: stageInfo(app.status), phases: WF.PHASES,
    current_page: app.current_page, is_legacy: !!app.is_legacy, submitted_at: app.submitted_at, created_at: app.created_at,
    updated_at: app.updated_at, withdrawn_at: app.withdrawn_at, consented_at: app.consented_at,
    // Applicants see the child only once the home discloses it (trial custody); before that only a notice.
    matched_child: app.matched_child_id && (!forDonor || DISCLOSED.includes(app.status)) ? { display_name: `${app.child_first_name} ${app.child_last_initial}.` } : null,
    match_notice: forDonor ? await require('../services/matching').donorNotice(id) : undefined,
    trial: app.trial_start ? { start: app.trial_start, end: app.trial_end } : null,
    form, history, requests, interviews, documents,
    ...(await (async () => {
      const c = documentChecklist(form, app.application_type, documents, { isLegacy: !!app.is_legacy });
      // ID and clearance checks count toward completeness too.
      const verifications = app.status === 'Draft' ? [] : await Verification.list(id, { withHistory: !forDonor });
      const vBlocking = verifications.filter((v) => v.status !== 'Verified')
        .map((v) => ({ doc_type: `verification:${v.slot}`, label: v.kind === 'government_id' ? `Government ID (${v.item_type})` : `${v.item_type} of ${v.holder || 'applicant'}`, status: v.status }));
      const blocking = [...c.summary.blocking, ...vBlocking];
      return {
        checklist: c.items, verifications,
        documents_summary: { ...c.summary, required: c.summary.required + verifications.length, verified: c.summary.verified + verifications.filter((v) => v.status === 'Verified').length,
          blocking, complete: blocking.length === 0 },
      };
    })()),
    can_withdraw: WF.WITHDRAWABLE.includes(app.status) && !app.archived_at,
    can_edit: app.status === 'Draft',
    // Drafts: which pages are complete and the furthest page the applicant may open.
    ...(app.status === 'Draft' ? (() => { const done = completedPages(form, app.application_type, allDocs); return { completed_pages: done, reachable_page: reachablePage(done) }; })() : {}),
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
    stage_documents: Object.entries(STAGE_DOCUMENTS).filter(([, def]) => !def.tracks || def.tracks.includes(WF.trackOf(app.application_type))).map(([key, def]) => ({
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
  const idTypes = (await IdTypes.all()).map(IdTypes.publicView);
  res.json({
    success: true,
    data: { ...formConfig(),
      verification: (() => { const VR = require('../config/verificationRules'); return { methods: VR.VERIFY_METHODS, review_results: Verification.REVIEW_RESULTS, id_types: idTypes.filter((t) => t.key !== 'Other').map((t) => t.key),
        reject_reasons: { government_id: VR.ID_REJECT_REASONS, clearance: VR.CLEARANCE_REJECT_REASONS }, needs_resolution_note: VR.NEEDS_RESOLUTION_NOTE, id_type_rules: idTypes, max_id_attempts: IdScan.MAX_ATTEMPTS }; })(),
      statuses: WF.STATUSES, status_labels: Adoption.LABELS, phases: WF.PHASES,
      stages: Object.fromEntries(Object.entries(WF.STAGES).map(([k, v]) => [k, { phase: v.phase, description: v.donor, next_step: v.next }])) },
  });
};

/** GET /api/adoptions/:id - every view is audit-logged (RA 8792). */
exports.getOne = async (req, res) => {
  const app = await loadById(req);
  // The staff page loads a small shell first; each tab loads its own data (adoptionDetailController).
  const data = req.query.view === 'shell' && req.user.role !== 'Donor'
    ? await require('./adoptionDetailController').shell(req, app) : await fullApplication(req, app);
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
  // Restricted (protected) documents: assigned Staff open them through the application's unlock (purpose, QR
  // token, 3 minutes) like the rest of the record; requireSensitive above already checked that. No per-file token.
  let record = null;
  if (doc.protected_record_id) {
    const [[r]] = await pool.query('SELECT record_id, allow_download FROM tbl_protected_records WHERE record_id = ?', [doc.protected_record_id]);
    record = r || null;
  }
  const full = await Adoption.document(app.application_id, docId);
  return { app, doc: { ...full, protected_record_id: doc.protected_record_id, allow_staff_download: Boolean(record?.allow_download) }, access };
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
    // Restricted documents: only when Admin turned on "Allow Staff to download (watermarked)" for that document.
    // Other documents: the document types Admin enabled in Settings.
    const allowed = String((await Settings.getAll()).staff_download_doc_types || '').split(',').map((x) => x.trim());
    if (doc.protected_record_id ? !doc.allow_staff_download : !allowed.includes(doc.doc_type)) {
      await logActivity(req, `DOWNLOAD_ADOPTION_DOCUMENT_DENIED (${doc.doc_type})`, `Application #${app.application_id}`); // attempt logged
      throw new HttpError(403, 'ACCESS DENIED – You are not authorized to download this document. You can view it here.');
    }
  }
  const verified = verifyUpload(doc.storage_key, doc.sha256);
  let body = readUpload(doc.storage_key);
  let mime = doc.mime_type;
  if (isStaff) { body = await watermarkFile(body, doc.mime_type, req.user); mime = 'application/pdf'; }
  await logActivity(req, `${download ? 'DOWNLOAD' : 'VIEW'}_ADOPTION_DOCUMENT (${doc.doc_type}${doc.protected_record_id ? ', restricted' : ''})`, `Application #${app.application_id}`);
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
  { key: 'visit', label: 'Interview or home visit', statuses: ['Home study scheduled', 'Case study completed'] },
  { key: 'decision', label: 'Decision', statuses: ['Cleared for matching', 'Declined', 'Withdrawn'] },
];
async function progressFor(ids) {
  if (!ids.length) return {};
  const [hist] = await pool.query('SELECT application_id, to_status, MIN(created_at) AS at FROM tbl_application_status_history WHERE application_id IN (?) GROUP BY application_id, to_status', [ids]);
  const [reqs] = await pool.query("SELECT application_id, MIN(requested_at) AS at FROM tbl_application_document_requests WHERE application_id IN (?) AND doc_type NOT IN ('divorce_or_death_certificate', 'child_abuse_clearance', 'fingerprint_clearance') GROUP BY application_id", [ids]);
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
      status_label: WF.donorLabel(r.status), stage: stageInfo(r.status), submitted_at: r.submitted_at, created_at: r.created_at, updated_at: r.updated_at,
      open_requests: Number(r.open_requests), unread_notifications: unread[r.application_id] || 0, progress: progress[r.application_id] || null,
      // The child is disclosed to the applicant only once trial custody starts.
      matched_child: r.matched_child_id && DISCLOSED.includes(r.status) ? { display_name: `${r.child_first_name} ${r.child_last_initial}.` } : null,
    })),
  });
};

/** POST /api/adoptions (Donor) { application_type: Regular|Relative } - starts a draft. One active application per donor. */
exports.createDraft = async (req, res) => {
  const type = req.body?.application_type ? String(req.body.application_type) : 'Regular';
  if (!APPLICATION_TYPES[type]) throw new HttpError(400, 'Choose an adoption type from the list.');
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
 * Autosave and Save as draft always store what was typed (cleaned), even on incomplete pages.
 * The server keeps the per-page completion state: after every save it recalculates which pages are
 * complete (fields and required uploads). With validate_page (the applicant pressed Next), the page is
 * accepted as complete only when nothing required is missing; otherwise 422 with each missing item.
 * current_page can never go past the first incomplete page, so pages can't be skipped through the URL or API.
 */
exports.saveDraft = async (req, res) => {
  const app = await loadById(req);
  if (req.user.role !== 'Donor') throw new HttpError(403, 'Only the applicant can edit a draft.');
  if (app.status !== 'Draft') throw new HttpError(409, 'Only a draft can be edited. Submitted applications are read-only.');
  const data = clean(req.body?.data);
  const page = req.body?.current_page === undefined ? null : toInt(req.body.current_page, 'current_page', { min: 1, max: PAGES.length });
  const vp = req.body?.validate_page === undefined ? null : toInt(req.body.validate_page, 'validate_page', { min: 1, max: 8 });
  const type = req.body?.application_type;
  if (type !== undefined && !APPLICATION_TYPES[type]) throw new HttpError(400, 'Choose an adoption type from the list.');
  const result = await withTransaction(async (conn) => {
    await conn.query('SELECT application_id FROM tbl_adoption_applications WHERE application_id = ? FOR UPDATE', [app.application_id]);
    await Adoption.saveForm(conn, app.application_id, data);
    const form = await Adoption.form(app.application_id);
    const docs = await Adoption.documents(app.application_id, conn);
    const appType = type ?? app.application_type;
    const completed = completedPages(form, appType, docs);
    const reachable = reachablePage(completed);
    const errors = vp ? pageCheck(vp, form, appType, docs) : null;
    // Never store a page beyond the first incomplete one.
    const target = page === null ? null : Math.min(page, reachable);
    await conn.query(`UPDATE tbl_adoption_applications SET current_page = COALESCE(?, current_page), application_type = COALESCE(?, application_type),
                             completed_pages = ?, updated_at = NOW() WHERE application_id = ?`,
      [target, type ?? null, completed.join(','), app.application_id]);
    return { completed, reachable, errors, redirect: page !== null && page > reachable ? reachable : null };
  });
  const validation = vp ? { page: vp, valid: !Object.keys(result.errors).length, errors: result.errors } : undefined;
  const body = { saved_at: new Date().toISOString(), validation, completed_pages: result.completed, reachable_page: result.reachable, redirect_page: result.redirect };
  // Continuing with required items missing is refused (the answers typed so far are still saved).
  if (validation && !validation.valid) {
    const n = Object.keys(result.errors).length;
    throw new HttpError(422, `${n} required item${n === 1 ? '' : 's'} left on this page.`, body);
  }
  res.json({ success: true, data: body });
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
  const submitForm = await Adoption.form(app.application_id);
  const submitDocs = await Adoption.documents(app.application_id);
  const check = validateSubmission(submitForm, submitDocs, req.body?.consent === true, app.application_type);
  // Every page must be complete (the same per-page check as Next), whatever the browser sent.
  const done = completedPages(submitForm, app.application_type, submitDocs);
  for (let n = 1; n <= 8; n += 1) {
    if (done.includes(n)) continue;
    check.ok = false;
    check.pages = { ...(check.pages || {}), [n]: { ...((check.pages || {})[n] || {}), ...pageCheck(n, submitForm, app.application_type, submitDocs) } };
  }
  // Card IDs need the back too (passports don't), per the ID type rules.
  const idRule = submitForm.id_type ? await IdTypes.get(submitForm.id_type) : null;
  if ((!idRule || idRule.needsBack) && !submitDocs.some((d) => d.doc_type === 'valid_id_back' && d.status === 'Uploaded')) {
    check.ok = false;
    check.missing_documents = [...(check.missing_documents || []), { doc_type: 'valid_id_back', label: 'Back of your government ID', page: 3 }];
    check.pages = { ...(check.pages || {}), 3: { ...((check.pages || {})[3] || {}), valid_id_back: 'Upload the back of your ID.' } };
  }
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
    // The government ID and clearances get their verification records (automatic checks; a person verifies).
    await Verification.syncFromForm(conn, app, await Adoption.form(app.application_id), req.user.user_id);
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
      // The ID photos may be retaken after submitting while the ID still needs a fix (not once it's verified).
      let idRetakeOk = false;
      if (IdScan.SIDE_OF[docType]) {
        const [[v]] = await pool.query("SELECT status FROM tbl_verifications WHERE application_id = ? AND slot = 'id'", [app.application_id]);
        // A missing back photo can always be added (applications submitted before the back slot existed).
        const hasBack = docType === 'valid_id_back' && (await Adoption.documents(app.application_id)).some((d) => d.doc_type === 'valid_id_back' && d.status !== 'Replaced');
        idRetakeOk = !v || v.status !== 'Verified' || (docType === 'valid_id_back' && !hasBack);
      }
      if (!requests.length && !forumOk && !idRetakeOk) throw new HttpError(409, 'This document has not been requested. After submitting, you can only add documents the home asks for.');
    }
  } else if (role === 'Staff') {
    await requireAssigned(req, app);
    // A case staff opened for a walk-in applicant: the assigned staff member also uploads the applicant's documents.
    const walkIn = Boolean(app.created_by_staff) && Boolean(DOCUMENTS[docType]);
    if (walkIn) await requireSensitive(req, app, 'Uploading the applicant\'s documents');
    else if (!isStage || !STAGE_DOCUMENTS[docType].uploaders.includes('Staff')) throw new HttpError(403, 'Staff can upload the case study, monitoring reports, proof of publication and the child\'s documents.');
  }
  // Documents with a validity period need the date issued or taken; a document already too old is refused.
  let issuedDate = null;
  const formDef = DOCUMENTS[docType];
  if (formDef?.validity_months) {
    issuedDate = String(req.body?.issued_date || '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(issuedDate)) throw new HttpError(400, `Enter the ${formDef.issued_label.toLowerCase()}.`);
    if (issuedDate > localToday()) throw new HttpError(400, `The ${formDef.issued_label.toLowerCase()} cannot be in the future.`);
    if (expiresOn(formDef, issuedDate) < localToday()) throw new HttpError(400, `${formDef.label} must be from the last ${formDef.validity_months} months.`);
  }
  const existing = (await Adoption.documents(app.application_id)).filter((d) => d.doc_type === docType && d.status !== 'Replaced');
  if (def.multiple && existing.length >= FILE_RULES.maxFilesPerType) throw new HttpError(400, `Up to ${FILE_RULES.maxFilesPerType} files for ${def.label}.`);

  // ID photos: the first upload plus 5 retakes per side; after that a person reviews the ID.
  if (IdScan.SIDE_OF[docType] && role === 'Donor') {
    const [[{ n }]] = await pool.query('SELECT COUNT(*) AS n FROM tbl_id_scans WHERE application_id = ? AND side = ?', [app.application_id, IdScan.SIDE_OF[docType]]).catch(() => [[{ n: 0 }]]);
    if (Number(n) >= IdScan.MAX_ATTEMPTS) {
      await logActivity(req, `ID_RETAKE_LIMIT (${IdScan.SIDE_OF[docType]})`, `Application #${app.application_id}`);
      throw new HttpError(409, `You've uploaded this side ${IdScan.MAX_ATTEMPTS} times. The home will check your ID by hand; you don't need to upload it again.`);
    }
  }
  // Malware scan (ClamAV, when installed on this server).
  {
    const raw = String(req.body?.file?.data || '');
    const mal = await MalwareScan.scan(Buffer.from(raw.includes(',') ? raw.slice(raw.indexOf(',') + 1) : raw, 'base64'));
    if (!mal.clean) {
      await logSecurityEvent(req, 'MALWARE_BLOCKED', { detail: `${docType} upload refused: ${mal.detail}` });
      throw new HttpError(400, 'This file was refused by the malware scan. Upload a different file.');
    }
  }
  const saved = saveUpload(req.body?.file, { ...DOC_OPTS, label: def.label });
  try {
    await withTransaction(async (conn) => {
      if (!def.multiple && existing.length) {
        if (app.status === 'Draft' && !IdScan.SIDE_OF[docType]) {
          // Draft: the old copy is kept (file and row), marked Replaced and hidden from the applicant's list.
          await conn.query(
            `UPDATE tbl_adoption_documents SET status = 'Replaced', archived_at = NOW(), archived_by = ?, archive_reason = 'Replaced while the application was a draft'
              WHERE application_id = ? AND doc_type = ? AND status = 'Uploaded' AND archived_at IS NULL`, [req.user.user_id, app.application_id, docType]);
        } else {
          // After submitting (and for ID photos, which have scan history), the old file stays on record, marked Replaced.
          await conn.query("UPDATE tbl_adoption_documents SET status = 'Replaced' WHERE application_id = ? AND doc_type = ? AND status = 'Uploaded'", [app.application_id, docType]);
        }
      }
      const documentId = await Adoption.insertDocument(conn, {
        ...saved, application_id: app.application_id, doc_type: docType, page: DOCUMENTS[docType]?.page ?? null,
        uploaded_by: req.user.user_id, request_id: requests[0]?.request_id, issued_date: issuedDate,
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
    });
  } catch (err) {
    discardUnsavedUpload(saved.storage_key);
    throw err;
  }
  await logActivity(req, `UPLOAD_ADOPTION_DOCUMENT (${docType}${requests.length ? ', requested' : ''})`, `Application #${app.application_id}`);
  // A new photo of the front or back of the ID is scanned in the background; the page polls for the result.
  if (IdScan.SIDE_OF[docType]) {
    const [[latest]] = await pool.query('SELECT document_id FROM tbl_adoption_documents WHERE application_id = ? AND doc_type = ? AND status = \'Uploaded\' ORDER BY document_id DESC LIMIT 1', [app.application_id, docType]);
    if (latest) IdScan.scanInBackground(latest.document_id, { actorId: req.user.user_id });
  }
  res.status(201).json({ success: true, data: await fullApplication(req, await Adoption.findById(app.application_id)) });
};

/** DELETE /api/adoptions/:id/documents/:docId (Donor, Draft only) */
exports.deleteDocument = async (req, res) => {
  const app = await loadById(req);
  if (req.user.role !== 'Donor' || app.status !== 'Draft') throw new HttpError(409, 'Files can only be removed while the application is a draft.');
  const doc = await Adoption.document(app.application_id, toInt(req.params.docId, 'docId', { min: 1 }));
  if (!doc) throw new HttpError(404, 'Document not found.');
  if (IdScan.SIDE_OF[doc.doc_type]) {
    // ID photos keep their scan history (retakes, duplicate checks), so the file is kept and marked Replaced.
    await pool.query("UPDATE tbl_adoption_documents SET status = 'Replaced' WHERE document_id = ?", [doc.document_id]);
  } else {
    // The file and the row are kept, marked Removed and hidden (uploaded files are never deleted).
    await pool.query(
      `UPDATE tbl_adoption_documents SET status = 'Removed', archived_at = NOW(), archived_by = ?, archive_reason = 'Removed by the applicant while the application was a draft'
        WHERE document_id = ?`, [req.user.user_id, doc.document_id]);
  }
  await logActivity(req, `REMOVE_ADOPTION_DOCUMENT (${doc.doc_type})`, `Application #${app.application_id}`);
  res.json({ success: true, data: await fullApplication(req, app) });
};

// ------------------------------------------------------------------ staff

/** GET /api/adoptions?phase=&status=&q= (Admin, Staff) - submitted applications; search by reference or applicant name. */
exports.list = async (req, res) => {
  const status = req.query.status ? String(req.query.status) : undefined;
  if (status && (!WF.STATUSES.includes(status) || status === 'Draft')) throw new HttpError(400, 'Choose a status from the list.');
  const phase = req.query.phase ? String(req.query.phase) : undefined;
  const ST = require('../config/adoptionStages');
  const bucket = req.query.bucket ? ST.BUCKETS.find((b) => b.key === String(req.query.bucket)) : null;
  if (req.query.bucket && !bucket) throw new HttpError(400, 'Choose a summary card from the list.');
  let statuses = bucket ? bucket.statuses : undefined;
  if (phase) {
    if (phase === 'ended') statuses = ['Declined', 'Withdrawn', 'Closed'];
    else if (WF.PHASES.some((p) => p.key === phase)) statuses = WF.STATUSES.filter((s) => WF.STAGES[s].phase === phase && s !== 'Closed');
    else throw new HttpError(400, 'Choose a phase from the list.');
  }
  const isAdmin = req.user.role === 'Admin';
  // Assigned staff filter: Admin "none" or a staff id; anyone "me".
  const assigned = req.query.assigned === 'me' ? req.user.user_id : isAdmin && req.query.assigned ? String(req.query.assigned) : undefined;
  const rows = await Adoption.list({ status, statuses, search: req.query.q, includeArchived: req.query.archived === '1' && isAdmin, referenceSearchOnly: !isAdmin, assigned });
  const mine = await require('../services/assignment').recordIdsFor(pool, 'adoption_application', req.user.user_id);
  // Summary cards (all applications, whatever the filter) and each row's stage and days in it.
  const counts = await Adoption.statusCounts({ includeArchived: req.query.archived === '1' && isAdmin });
  const summary = [{ key: 'total', label: 'Total applications', count: Object.values(counts).reduce((a, b) => a + b, 0) },
    ...ST.BUCKETS.map((b) => ({ key: b.key, label: b.label, count: b.statuses.reduce((n, st) => n + (counts[st] || 0), 0) }))];
  const stageLabel = (st) => ST.STAGES.find((x) => x.statuses.includes(st))?.label || st;
  const days = (r) => { const at = r.stage_since || r.submitted_at; return at ? Math.max(0, Math.floor((Date.now() - new Date(at).getTime()) / 86400000)) : null; };
  res.json({
    success: true,
    meta: { summary },
    data: rows.map((r) => {
      const row = { ...r, status_label: Adoption.LABELS[r.status] || r.status, phase: WF.STAGES[r.status]?.phase || null, open_requests: Number(r.open_requests), is_legacy: !!r.is_legacy,
        deadlines: workflow.deadlines(r), assigned_to_me: mine.has(String(r.application_id)),
        assigned_staff_name: r.assigned_staff_active ? r.assigned_staff_name : null,
        assignment_flag: r.assigned_staff_id && !r.assigned_staff_active ? 'Assigned staff account is deactivated' : null,
        current_stage: stageLabel(r.status), days_in_stage: days(r), last_updated: r.updated_at || r.submitted_at,
        child_name: r.case_child_name || null, child_id: r.case_child_id || null };
      delete row.stage_since; delete row.case_child_name; delete row.case_child_id;
      if (isAdmin) return row;
      // Staff: only the reference, status, submission date and assigned staff; the name is masked.
      return {
        application_id: r.application_id, reference_no: r.reference_no, status: r.status, status_label: r.status, phase: row.phase,
        submitted_at: r.submitted_at, legal_name: S.maskName(r.legal_name), assigned_staff_id: r.assigned_staff_active ? r.assigned_staff_id : null,
        assigned_staff_name: row.assigned_staff_name, assigned_to_me: row.assigned_to_me, masked: true,
        application_type: r.application_type, current_stage: row.current_stage, days_in_stage: row.days_in_stage, last_updated: row.last_updated,
        has_child: Boolean(row.child_id),
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
  await requireAssigned(req, app);
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

/**
 * POST /api/adoptions/:id/documents/:docId/review (Admin, Staff) { status, note }
 * Manual verification of one uploaded document: Under validation, Verified, Rejected, Requires
 * correction or Manual verification required. Nothing is verified automatically (there is no official
 * verification service). Rejected or Requires correction needs a note for the applicant and opens a
 * document request so they can upload a new file. Staff: assigned and unlocked.
 */
exports.reviewDocument = async (req, res) => {
  const app = await loadById(req);
  await requireSensitive(req, app, 'Document review');
  const docId = toInt(req.params.docId, 'docId', { min: 1 });
  const status = String(req.body?.status || '');
  if (!DOCUMENT_STATUSES.includes(status) || status === 'Submitted') throw new HttpError(400, 'Choose a review result.');
  const note = String(req.body?.note || '').trim().slice(0, 500);
  if (['Rejected', 'Requires correction'].includes(status) && note.length < 5) throw new HttpError(400, 'Tell the applicant what is wrong (at least 5 characters).');
  await withTransaction(async (conn) => {
    const [[doc]] = await conn.query("SELECT document_id, doc_type, verification_status FROM tbl_adoption_documents WHERE document_id = ? AND application_id = ? AND status = 'Uploaded' AND archived_at IS NULL FOR UPDATE",
      [docId, app.application_id]);
    if (!doc) throw new HttpError(404, 'Document not found.');
    if (STAGE_DOCUMENTS[doc.doc_type]) throw new HttpError(400, 'Workflow documents are handled through the stages.');
    await conn.query('UPDATE tbl_adoption_documents SET verification_status = ?, reviewed_by = ?, reviewed_at = NOW(), review_note = ? WHERE document_id = ?',
      [status, req.user.user_id, note || null, docId]);
    await logActivityWith(conn, req, `DOCUMENT_REVIEWED (${doc.doc_type}: ${doc.verification_status} -> ${status})`, `Application #${app.application_id}`);
    if (['Rejected', 'Requires correction'].includes(status) && app.applicant_id) {
      const label = DOCUMENTS[doc.doc_type]?.label || doc.doc_type;
      await conn.query("INSERT INTO tbl_application_document_requests (application_id, doc_type, message, requested_by) VALUES (?, ?, ?, ?)",
        [app.application_id, doc.doc_type, `${label}: ${note}`.slice(0, 500), req.user.user_id]);
      await Notify.emit(conn, 'documents_requested', { userId: app.applicant_id, applicationId: app.application_id, entityType: 'application',
        entityId: app.application_id, params: { id: app.application_id, ref: app.reference_no }, groupKey: `document_review:${docId}:${Date.now()}` });
    }
  });
  await U.logEvent(req, { recordType: 'adoption_application', recordId: app.application_id, event: 'document_reviewed', detail: `document #${docId}: ${status}` });
  res.json({ success: true, data: await fullApplication(req, await Adoption.findById(app.application_id)) });
};

/**
 * POST /api/adoptions/:id/verifications/:vid/review (Admin, Staff) { status, method?, method_ref?, note? }
 * A person's verification of the government ID or a clearance. Verified needs the method (original sighted,
 * official QR checked, confirmed with the issuer). Requires correction needs a note for the applicant.
 */
exports.reviewVerification = async (req, res) => {
  const app = await loadById(req);
  await requireSensitive(req, app, 'ID and clearance verification');
  const vid = toInt(req.params.vid, 'vid', { min: 1 });
  await withTransaction(async (conn) => {
    const r = await Verification.review(conn, req, app, vid, req.body || {});
    const action = r.to === 'Verified' ? 'VERIFIED' : r.to === 'Requires correction' ? 'CORRECTION_REQUESTED' : r.to === 'Flagged for review' ? 'FLAGGED' : 'REJECTED';
    await logActivityWith(conn, req, `${r.kind === 'government_id' ? 'ID' : 'CLEARANCE'}_MANUAL_${action} (${r.slot}, ${r.item_type}: ${r.from} -> ${r.to}${r.method ? `; ${r.method}` : ''})`, `Application #${app.application_id}`);
    if (['Requires correction', 'Invalid', 'Invalid ID', 'Invalid ID number', 'Information mismatch', 'Expired', 'ID type mismatch', 'Not verified', 'Verification failed'].includes(r.to) && app.applicant_id) {
      await Notify.emit(conn, 'documents_requested', { userId: app.applicant_id, applicationId: app.application_id, entityType: 'application', entityId: app.application_id,
        params: { id: app.application_id, ref: app.reference_no }, groupKey: `verification:${vid}:${Date.now()}` });
    }
  });
  await U.logEvent(req, { recordType: 'adoption_application', recordId: app.application_id, event: 'verification_reviewed', detail: `verification #${vid}` });
  res.json({ success: true, data: await fullApplication(req, await Adoption.findById(app.application_id)) });
};

/**
 * GET /api/adoptions/:id/id-scan (the applicant, or assigned Staff / Admin with the sensitive sections
 * unlocked) - the automatic scan of the front and back of the ID: per-side checks, what was read, the
 * applicant's checklist and the overall message. The applicant sees only their own application, and the ID
 * number only as its last 4 characters. Never another person's data.
 */
exports.idScan = async (req, res) => {
  const app = await loadById(req);
  const forDonor = req.user.role === 'Donor';
  if (!forDonor) await requireSensitive(req, app, 'The ID scan');
  const form = await Adoption.form(app.application_id);
  const scan = await IdScan.forApplication(pool, app, form);
  const rule = scan.rule;
  const sideView = (x) => {
    if (!x) return null;
    const f = x.fields || {}; const m = x.machine?.fields || {};
    const fields = {
      full_name: f.full_name || m.full_name || null, date_of_birth: f.date_of_birth || m.date_of_birth || null,
      id_number: forDonor ? IdScan.mask(f.id_number || m.id_number) : (f.id_number || m.id_number || null),
      date_issued: f.date_issued || null, expiry_date: f.expiry_date || m.expiry_date || null,
      ...(forDonor ? {} : { address: f.address || null }),
    };
    return {
      document_id: x.document_id, state: x.state, result: x.result, attempt_no: x.attempt_no, detected_type: x.detected_type, detected_side: x.detected_side,
      checks: (x.checks || []).map(({ check, result, message }) => ({ check, result, message })), fields, machine: { kind: x.machine?.kind, status: x.machine?.status },
      ...(forDonor ? {} : { quality: x.quality, flags: x.flags }),
    };
  };
  const sum = scan.summary;
  // Overall message for the applicant.
  const needsBack = rule ? rule.needsBack : true;
  const pending = [scan.front, needsBack ? scan.back : null].some((x) => x && x.state !== 'done');
  const missing = !scan.front || (needsBack && !scan.back);
  const fails = sum.checks.filter((c) => c.result === 'fail');
  const overall = pending ? { state: 'scanning', message: 'Scanning your ID...' }
    : missing ? { state: 'missing', message: needsBack ? 'Upload both the front and the back of your ID.' : 'Upload the photo page of your passport.' }
      : sum.auto_result === 'Unable to read' ? { state: 'unreadable', message: "We couldn't read this side. Please try again in good light.", retake: [scan.front, scan.back].filter((x) => x && x.result === 'unreadable').map((x) => x.side) }
        : sum.auto_result === 'Failed' ? { state: 'failed', message: 'Your ID needs a fix.', reasons: fails.map((c) => c.message), retake: [...new Set(fails.map((c) => c.side).filter(Boolean))] }
          : { state: 'passed', message: 'Your ID was scanned and the checks passed. Our team will confirm it.' };
  const [[ver]] = await pool.query("SELECT status, method, official_mode, reviewed_at FROM tbl_verifications WHERE application_id = ? AND slot = 'id'", [app.application_id]);
  // Official only while the current Verified status came from an official source (a person's later review replaces the method).
  const official = ver?.status === 'Verified' && String(ver.method || '').startsWith('Official verification') ? (ver.official_mode || 'automatic') : null;
  // Logged once the scan is finished (the page asks every few seconds while it runs).
  if (overall.state !== 'scanning') await logActivity(req, `VIEW_ID_SCAN (${forDonor ? 'applicant' : req.user.role})`, `Application #${app.application_id}`);
  res.json({
    success: true,
    data: {
      rule: rule ? IdTypes.publicView(rule) : null, front: sideView(scan.front), back: sideView(scan.back),
      attempts: scan.attempts, max_attempts: IdScan.MAX_ATTEMPTS, checklist: scan.checklist, overall,
      // "Verified" is shown only when the authenticity status is Verified (official or by the home after review).
      authenticity: ver ? { status: ver.status, official, manual: ver.status === 'Verified' && !official, at: ver.reviewed_at || null } : null,
      ...(forDonor ? {} : { checks: sum.checks, flags: sum.flag_text, extracted: sum.extracted, auto_result: sum.auto_result }),
    },
  });
};

/**
 * POST /api/adoptions/:id/verifications/:vid/philsys-check (Admin, assigned Staff with the sensitive sections
 * unlocked) { result: verified|deactivated|unreadable, details_match, reference?, note? } - records what
 * PhilSys Check (verify.philsys.gov.ph) showed for the original card's QR. Staff-confirmed, not automatic.
 */
exports.philsysCheck = async (req, res) => {
  const app = await loadById(req);
  await requireSensitive(req, app, 'ID verification');
  const vid = toInt(req.params.vid, 'vid', { min: 1 });
  await withTransaction(async (conn) => {
    const r = await Verification.recordPhilSysCheck(conn, req, app, vid, req.body || {});
    await logActivityWith(conn, req, `ID_PHILSYS_CHECK (${r.result}${r.result === 'verified' ? `, details ${r.matches ? 'match' : 'differ'}` : ''}: ${r.from} -> ${r.to})`, `Application #${app.application_id}`);
  });
  res.json({ success: true, data: await fullApplication(req, await Adoption.findById(app.application_id)) });
};

/**
 * GET /api/adoption-verification-queue (Admin, Staff with the adoption duty) - IDs and clearances waiting for
 * manual verification or review. Staff see only applications assigned to them, with the name masked.
 */
exports.verificationQueue = async (req, res) => {
  const isAdmin = req.user.role === 'Admin';
  const rows = await Verification.queue({ staffId: isAdmin ? null : req.user.user_id });
  await logActivity(req, `VIEW_ID_VERIFICATION_QUEUE (${rows.length} records)`, 'Adoption verifications');
  res.json({
    success: true,
    data: rows.map((r) => ({
      verification_id: r.verification_id, application_id: r.application_id, reference_no: r.reference_no, application_status: r.application_status,
      applicant: isAdmin ? r.legal_name : S.maskName(r.legal_name), kind: r.kind, item_type: r.item_type, status: r.status,
      waiting_since: r.updated_at || r.created_at, assigned_staff_name: r.assigned_staff_name || null,
    })),
  });
};

/**
 * PUT /api/adoptions/:id/verifications/:vid (Donor, own application) - corrects the ID or one clearance when
 * the home asked for a correction (or the checks found a problem). The automatic checks run again and the
 * record goes back for a person's review.
 */
exports.correctVerification = async (req, res) => {
  const app = await loadById(req);
  if (req.user.role !== 'Donor') throw new HttpError(403, 'Only the applicant corrects these details.');
  const vid = toInt(req.params.vid, 'vid', { min: 1 });
  const [[v]] = await pool.query('SELECT verification_id, kind, slot, status FROM tbl_verifications WHERE verification_id = ? AND application_id = ?', [vid, app.application_id]);
  if (!v) throw new HttpError(404, 'Record not found.');
  if (v.status === 'Verified') throw new HttpError(409, 'This is already verified.');
  const form = await Adoption.form(app.application_id);
  let patch;
  if (v.kind === 'government_id') {
    patch = clean({ id_type: req.body?.id_type, id_type_other: req.body?.id_type_other, id_number: req.body?.id_number, id_expiry: req.body?.id_expiry, id_name: req.body?.id_name, id_dob: req.body?.id_dob });
    const errors = validatePage(3, { ...form, ...patch }, app.application_type);
    const mine = Object.fromEntries(Object.entries(errors).filter(([k]) => k.startsWith('id_')));
    if (Object.keys(mine).length) throw new HttpError(400, 'Please check the highlighted details.', { errors: mine });
  } else {
    const index = Number(v.slot.split('-')[1]) - 1;
    const rows = [...(form.clearances || [])];
    rows[index] = req.body?.clearance || {};
    patch = clean({ clearances: rows });
    const errors = validatePage(4, { ...form, ...patch }, app.application_type);
    if (errors.clearances) throw new HttpError(400, errors.clearances, { errors: { clearances: errors.clearances } });
  }
  await withTransaction(async (conn) => {
    await Adoption.saveForm(conn, app.application_id, patch);
    await Verification.syncFromForm(conn, app, { ...form, ...patch }, req.user.user_id);
    await logActivityWith(conn, req, `${v.kind === 'government_id' ? 'ID' : 'CLEARANCE'}_DETAILS_CORRECTED (${v.slot})`, `Application #${app.application_id}`);
    const params = { id: app.application_id, ref: app.reference_no };
    const common = { entityType: 'application', entityId: app.application_id, params, groupKey: `docs_uploaded:${app.application_id}`, mode: 'set' };
    await Notify.toAdmins(conn, 'admin_documents_uploaded', common);
    if (app.assigned_staff_id && app.assigned_staff_active) await Notify.emit(conn, 'staff_documents_uploaded', { ...common, userId: app.assigned_staff_id });
  });
  res.json({ success: true, data: await fullApplication(req, await Adoption.findById(app.application_id)) });
};

/** Helpers shared with the tabbed detail page (controllers/adoptionDetailController.js). */
exports._detail = { loadById, sensitiveAccess, requireSensitive, lockedView, assignmentOf };
