/**
 * Staff and Admin application detail page, in tabs. The page first loads a small "shell" (header, stage
 * progress, what blocks the next stage, next action, key dates); each tab then loads its own data from
 * GET /api/adoptions/:id/tab/:tab. Same access rules as the full application: Admin always (logged);
 * Staff only when assigned and unlocked (purpose, QR token, 3 minutes). Locked Staff get the locked shell
 * and no tab data.
 *
 * Nothing here changes data. No names or sensitive values are put in URLs, logs or notifications.
 */
const { pool } = require('../config/db');
const Adoption = require('../models/adoptionModel');
const HttpError = require('../utils/HttpError');
const {
  DOCUMENTS, STAGE_DOCUMENTS, DOCUMENT_GROUPS, PAGES, FIELDS, APPLICATION_TYPES, isVisible, isRequired, answersFor,
} = require('../config/adoptionForm');
const WF = require('../config/adoptionWorkflow');
const { documentChecklist, completedPages } = require('../services/adoptionValidation');
const workflow = require('../services/adoptionWorkflow');
const P = require('../services/protectedRecords');
const U = require('../services/unlockService');
const Verification = require('../services/verification');
const Settings = require('../models/settingsModel');

const C = () => require('./adoptionController')._detail; // shared helpers (loaded late: circular require)

const TABS = ['workflow', 'overview', 'applicant', 'documents', 'idcheck', 'assessment', 'matching', 'notes', 'timeline'];
const iso = (v) => (v ? String(v instanceof Date ? v.toISOString() : v).slice(0, 10) : null);
const empty = (v) => v === undefined || v === null || (typeof v === 'string' && !v.trim()) || (Array.isArray(v) && !v.length);

/** Initials only ("J. D. C."), for Staff. */
const initials = (name) => String(name || '').split(/\s+/).filter(Boolean).map((w) => `${w[0].toUpperCase()}.`).join(' ') || 'Applicant';

/** A file name people can read: the stored name unless it looks machine-made (hashes, UUIDs, long digit runs). */
function displayName(file, label, index, total) {
  const name = String(file.original_name || '');
  const ext = (/\.([a-z0-9]{2,4})$/i.exec(name)?.[1] || '').toLowerCase();
  const base = name.replace(/\.[^.]+$/, '');
  const machine = /^[a-f0-9]{16,}$/i.test(base) || /^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(base) || /^\d{10,}$/.test(base) || !base;
  if (!machine) return name;
  return `${label}${total > 1 ? ` (${index + 1} of ${total})` : ''}${ext ? `.${ext}` : ''}`;
}

/** Answers still missing (required and empty), page by page. */
function missingAnswers(form, type) {
  const data = answersFor(form, type);
  const out = [];
  for (const [key, def] of Object.entries(FIELDS)) {
    if (def.page > 8 || !isRequired(def, data)) continue;
    if (empty(form[key])) out.push({ page: def.page, key, label: def.label });
  }
  return out;
}

/** The primary next stage (the forward step, not decline / request / placement ended), for the gate banner. */
function primaryNext(app) {
  const track = WF.trackOf(app.application_type);
  const here = WF.STATUSES.indexOf(app.status);
  const options = (WF.TRANSITIONS[app.status] || [])
    .filter((x) => !['Declined', 'Documents requested', 'Placement ended'].includes(x.to) && (!x.types || x.types.includes(track)))
    .map((x) => x.to);
  // The nearest stage ahead in the workflow (not a step back such as "Forum attended" after the case study).
  const ahead = options.filter((to) => WF.STATUSES.indexOf(to) > here).sort((a, b) => WF.STATUSES.indexOf(a) - WF.STATUSES.indexOf(b));
  return ahead[0] || options[0] || null;
}

/** Stage progress: Inquiry, Forum, Documents, Assessment, Matching, Trial custody, Petition, Order. */
function progressOf(app, docsComplete) {
  const track = WF.trackOf(app.application_type);
  const stages = WF.PROGRESS_STAGES;
  const currentIdx = stages.findIndex((s) => s.statuses.includes(app.status));
  const done = {
    inquiry: app.status !== 'Submitted' && Boolean(app.submitted_at), forum: Boolean(app.forum_verified_at), documents: Boolean(docsComplete),
    assessment: Boolean(app.cleared_at), matching: Boolean(app.trial_start || app.trial_completed_at), trial: Boolean(app.trial_completed_at),
    petition: Boolean(app.order_date || app.finalized_at), order: app.status === 'Closed' || Boolean(app.closed_at && app.finalized_at),
  };
  return stages.map((s, i) => ({
    key: s.key, label: s.label,
    state: s.tracks && !s.tracks.includes(track) ? 'skipped' : done[s.key] ? 'done' : i === currentIdx ? 'current' : 'upcoming',
  }));
}

/** Days since the application entered its current status. */
async function daysInStage(app) {
  const [[h]] = await pool.query('SELECT MAX(created_at) AS at FROM tbl_application_status_history WHERE application_id = ? AND to_status = ?', [app.application_id, app.status]);
  const at = h?.at || app.submitted_at;
  return at ? Math.max(0, Math.floor((Date.now() - new Date(at).getTime()) / 86400000)) : null;
}

/** Checklist + ID/clearance checks: the same completeness numbers the server gate uses. */
async function completeness(app, form, documents) {
  const c = documentChecklist(form, app.application_type, documents, { isLegacy: !!app.is_legacy });
  const verifications = await Verification.list(app.application_id);
  const vBlocking = verifications.filter((v) => v.status !== 'Verified')
    .map((v) => ({ doc_type: `verification:${v.slot}`, label: v.kind === 'government_id' ? `Government ID (${v.item_type})` : `${v.item_type} of ${v.holder || 'applicant'}`, status: v.status, tab: 'idcheck' }));
  const blocking = [...c.summary.blocking.map((b) => ({ ...b, tab: 'documents' })), ...vBlocking];
  return {
    checklist: c, verifications,
    summary: { required: c.summary.required + verifications.length, verified: c.summary.verified + verifications.filter((v) => v.status === 'Verified').length, blocking, complete: blocking.length === 0 },
  };
}

/** The most important open task, for the right rail. */
function nextAction(app, { summary, gate, openRequests, allowed, isAdmin }) {
  if (app.archived_at || WF.FINAL.includes(app.status)) return { text: 'This application is read-only.', tab: null };
  const waiting = summary.blocking.filter((b) => ['Submitted', 'Under validation', 'Manual verification required'].includes(b.status) && b.tab === 'documents');
  if (waiting.length) return { text: `Review ${waiting.length} document${waiting.length === 1 ? '' : 's'} waiting for verification.`, tab: 'documents', filter: 'review' };
  const id = summary.blocking.find((b) => b.doc_type === 'verification:id');
  if (id && !['Requires correction'].includes(id.status)) return { text: 'Check the government ID.', tab: 'idcheck' };
  if (openRequests) return { text: `Waiting for the applicant: ${openRequests} requested document${openRequests === 1 ? '' : 's'}.`, tab: 'documents' };
  if (gate?.blockers.length) return { text: `Resolve ${gate.blockers.length} blocking item${gate.blockers.length === 1 ? '' : 's'} before "${gate.target}".`, tab: 'documents', filter: 'blocking' };
  if (allowed.length) return { text: gate?.target && allowed.includes(gate.target) ? `Record the next stage: ${gate.target}.` : 'Record the next stage.', tab: null, update: true };
  return { text: isAdmin ? 'No stage can be recorded right now.' : 'The next stage is recorded by an administrator.', tab: null };
}

/** Allowed next statuses, each with what blocks it (the dialog lists them and explains blocked ones). */
async function transitionsFor(app, allowed) {
  const out = [];
  for (const to of allowed) {
    const blockers = await workflow.blockersFor(pool, app, to);
    out.push({ to, blocked: blockers.length > 0, reasons: blockers.slice(0, 6).map((b) => b.message), more: Math.max(0, blockers.length - 6) });
  }
  return out;
}

/** GET /api/adoptions/:id?view=shell (Admin, Staff) - header, progress, gate, next action, key dates. */
async function shell(req, app) {
  const { sensitiveAccess, lockedView, assignmentOf } = C();
  const access = await sensitiveAccess(req, app);
  const isAdmin = req.user.role === 'Admin';
  const type = APPLICATION_TYPES[app.application_type] || {};
  const common = {
    application_id: app.application_id, reference_no: app.reference_no, status: app.status, application_type: app.application_type,
    category: type.short || app.application_type, submitted_at: app.submitted_at, applicant_initials: initials(app.legal_name),
    days_in_stage: await daysInStage(app), archived_at: app.archived_at,
  };
  const Stages = require('../services/adoptionStages');
  if (!access.unlocked) {
    const locked = lockedView(req, app, access);
    // Locked: the stage names and states only (nothing about what is outstanding).
    const st = Stages.stageStates({ app, recs: await Stages.records(pool, app.application_id), ents: await Stages.entries(pool, app.application_id), docs: null, elig: null, pagesComplete: true })
      .map(({ key, label, short, state }) => ({ key, label, short, state }));
    return { ...locked, ...common, applicant_masked: common.applicant_initials, progress: progressOf(app, false), stages: st };
  }
  const [form, documents, requests, interviews] = await Promise.all([Adoption.form(app.application_id), Adoption.documents(app.application_id),
    Adoption.requests(app.application_id), Adoption.interviews(app.application_id)]);
  const comp = await completeness(app, form, documents);
  const allowed = app.archived_at ? [] : WF.allowedTargets(app.status, app.application_type, req.user.role);
  const target = app.archived_at ? null : primaryNext(app);
  const gate = target ? { target, blockers: (await workflow.blockersFor(pool, app, target)).map(({ message, ...b }) => ({ ...b, message })) } : null;
  const openRequests = requests.filter((r) => r.status === 'Open').length;
  const missing = missingAnswers(form, app.application_type);
  const pagesComplete = !app.created_by_staff || completedPages(form, app.application_type, documents).length === 8;
  const stageInfo = await require('../services/adoptionStages').caseStages(pool, app, { docs: comp.summary, pagesComplete });
  const nextInterview = interviews.filter((i) => new Date(i.scheduled_at) >= new Date()).sort((a, b) => new Date(a.scheduled_at) - new Date(b.scheduled_at))[0] || null;
  return {
    ...common,
    applicant_name: isAdmin ? app.legal_name : undefined,
    relationship: type.relationship || form.adoptee_relationship || '–',
    ...assignmentOf(app),
    locked: false,
    sensitive: { unlocked: true, admin: isAdmin, assigned: true, expires_at: access.expires_at || null, remaining_seconds: access.remaining_seconds || 0, purpose: access.purpose || null },
    is_legacy: !!app.is_legacy, archive_reason: isAdmin ? app.archive_reason : undefined,
    progress: progressOf(app, comp.summary.complete),
    stages: stageInfo.stages, created_by_staff: Boolean(app.created_by_staff),
    documents_summary: comp.summary,
    gate,
    missing_answers: missing,
    open_requests: openRequests,
    allowed_statuses: allowed,
    transitions: await transitionsFor(app, allowed),
    next_action: nextAction(app, { summary: comp.summary, gate, openRequests, allowed, isAdmin }),
    key_dates: {
      submitted_at: app.submitted_at, next_interview: nextInterview ? { kind: nextInterview.kind, at: nextInterview.scheduled_at } : null,
      trial_start: iso(app.trial_start), trial_end: iso(app.trial_end), nacc_deadline: iso(app.nacc_deadline), finalized_at: app.finalized_at,
    },
    deadlines: workflow.deadlines(app),
    matched_child: app.matched_child_id ? { child_id: app.matched_child_id, full_name: app.child_full_name, age: app.child_age } : null,
    trial_started: Boolean(app.trial_start),
  };
}

// ---------------------------------------------------------------- tabs

/** Upload, download and review rights for one document row. */
function rowRights(req, docType, { staffDownloadTypes, walkIn = false }) {
  const role = req.user.role;
  const stage = STAGE_DOCUMENTS[docType];
  return {
    // Applicant documents: Admin, or the assigned staff member for a walk-in case staff opened.
    can_upload: stage ? stage.uploaders.includes(role) : role === 'Admin' || walkIn,
    reviewable: Boolean(DOCUMENTS[docType]),
    staffDownload: staffDownloadTypes.includes(docType),
  };
}

/** One file as the Documents tab shows it: friendly name, who uploaded it and when, its review, restriction. */
function fileView(req, f, label, i, total, { records, staffDownload }) {
  const rec = f.protected_record_id ? records.find((r) => r.record_id === f.protected_record_id) : null;
  const isStaff = req.user.role === 'Staff';
  return {
    document_id: f.document_id, display_name: displayName(f, label, i, total), mime_type: f.mime_type, size_bytes: f.size_bytes,
    uploaded_by_name: f.uploaded_by_name, uploaded_at: f.uploaded_at, verification_status: f.verification_status, review_note: f.review_note,
    reviewed_by_name: f.reviewed_by_name, reviewed_at: f.reviewed_at, issued_date: f.issued_date, expires_on: f.expires_on || null, expired: Boolean(f.expired),
    restricted: Boolean(f.protected_record_id), record_id: f.protected_record_id || null, allow_staff_download: rec ? Boolean(rec.allow_download) : false,
    can_download: !isStaff ? true : f.protected_record_id ? Boolean(rec?.allow_download) : staffDownload,
  };
}

/** Document request threads: one per document type (duplicates merged), Open first, Closed collapsed by the page. */
function requestThreads(requests) {
  const by = new Map();
  for (const r of requests) {
    if (!by.has(r.doc_type)) by.set(r.doc_type, []);
    by.get(r.doc_type).push(r);
  }
  const label = (t) => DOCUMENTS[t]?.label || STAGE_DOCUMENTS[t]?.label || t;
  return [...by.entries()].map(([doc_type, rs]) => {
    const sorted = [...rs].sort((a, b) => (b.status === 'Open') - (a.status === 'Open') || new Date(b.requested_at) - new Date(a.requested_at));
    return { doc_type, label: label(doc_type), open: rs.some((r) => r.status === 'Open'), merged: rs.length, last_at: sorted[0].requested_at,
      requests: sorted.map((r) => ({ request_id: r.request_id, status: r.status, message: r.message, requested_at: r.requested_at, requested_by_name: r.requested_by_name, fulfilled_at: r.fulfilled_at, closed_at: r.closed_at })) };
  }).sort((a, b) => b.open - a.open || new Date(b.last_at) - new Date(a.last_at));
}

const statusOfFiles = (files) => {
  if (!files.length) return 'Pending submission';
  const latest = [...files].sort((a, b) => new Date(b.uploaded_at) - new Date(a.uploaded_at))[0];
  return latest.verification_status && latest.verification_status !== 'Submitted' ? latest.verification_status : 'Uploaded';
};

/** Documents tab: ONE list built from DOCUMENTS + STAGE_DOCUMENTS (config/adoptionForm.js), grouped. */
async function documentsTab(req, app) {
  const [form, documents, requests, records, settings] = await Promise.all([
    Adoption.form(app.application_id), Adoption.documents(app.application_id), Adoption.requests(app.application_id),
    P.listRecords({ applicationId: app.application_id }), Settings.getAll()]);
  const staffDownloadTypes = String(settings.staff_download_doc_types || '').split(',').map((x) => x.trim()).filter(Boolean);
  const all = documents.map(({ sha256, ...d }) => d);
  const comp = await completeness(app, form, all);
  const target = primaryNext(app);
  const gateDocs = target ? (await workflow.blockersFor(pool, app, target)).map((b) => b.doc_type).filter(Boolean) : [];
  const blockingTypes = new Set([...comp.summary.blocking.map((b) => b.doc_type), ...gateDocs]);
  const threads = requestThreads(requests);
  const rows = [];
  for (const item of comp.checklist.items) {
    const r = rowRights(req, item.doc_type, { staffDownloadTypes, walkIn: Boolean(app.created_by_staff) });
    rows.push({
      doc_type: item.doc_type, group: 'applicant', label: item.label, requirement: item.requirement, status: item.status, blocking: blockingTypes.has(item.doc_type),
      can_upload: r.can_upload && !WF.FINAL.includes(app.status) && !app.archived_at, reviewable: r.reviewable, multiple: item.multiple,
      validity_months: item.validity_months, issued_label: item.issued_label,
      files: item.files.map((f, i) => fileView(req, f, item.label, i, item.files.length, { records, staffDownload: r.staffDownload })),
    });
  }
  const track = WF.trackOf(app.application_type);
  const placed = Boolean(app.trial_start) || ['Trial custody', 'Trial custody completed'].includes(app.status);
  for (const [key, def] of Object.entries(STAGE_DOCUMENTS)) {
    if (def.tracks && !def.tracks.includes(track)) continue;
    if (def.group === 'post_placement' && !placed) continue;
    const files = all.filter((d) => d.doc_type === key && d.status !== 'Replaced');
    const r = rowRights(req, key, { staffDownloadTypes });
    const requirement = def.petition === 'age5' || def.petition === 'age10' ? 'Conditional' : 'Required';
    rows.push({
      doc_type: key, group: def.group, label: def.label, requirement, status: statusOfFiles(files), blocking: blockingTypes.has(key),
      can_upload: r.can_upload && !WF.FINAL.includes(app.status) && !app.archived_at, reviewable: false, multiple: def.multiple,
      restricted_type: Boolean(def.protected),
      files: files.map((f, i) => fileView(req, f, def.label, i, files.length, { records, staffDownload: r.staffDownload })),
    });
  }
  for (const row of rows) row.thread = threads.find((t) => t.doc_type === row.doc_type) || null;
  return {
    groups: DOCUMENT_GROUPS, rows, summary: comp.summary,
    // Request threads whose document type has no row on this application (for example a type that no longer applies).
    other_threads: threads.filter((t) => !rows.some((r) => r.doc_type === t.doc_type)),
    open_requests: requests.filter((r) => r.status === 'Open').length,
  };
}

/** Applicant tab: every answer, grouped 1 to 8, with what is missing and the consent record. */
async function applicantTab(req, app) {
  const form = await Adoption.form(app.application_id);
  return {
    form, legacy: Adoption.legacy(app), is_legacy: !!app.is_legacy, missing_answers: missingAnswers(form, app.application_type),
    consent: { consented_at: app.consented_at, consent_version: app.consent_version, privacy_notice_version: app.privacy_notice_version },
  };
}

async function idCheckTab(req, app) {
  const form = await Adoption.form(app.application_id);
  return { verifications: app.status === 'Draft' ? [] : await Verification.list(app.application_id, { withHistory: true }), form: { id_type: form.id_type } };
}

async function assessmentTab(req, app) {
  const [interviews, documents] = await Promise.all([Adoption.interviews(app.application_id), Adoption.documents(app.application_id)]);
  const pick = (t) => documents.filter((d) => d.doc_type === t && d.status !== 'Replaced').map((d) => ({ uploaded_at: d.uploaded_at, verification_status: d.verification_status }));
  return {
    interviews,
    forum_certificate: { files: pick('forum_certificate'), verified_at: app.forum_verified_at },
    case_study: { files: pick('case_study_report'), completed_at: app.case_study_completed_at },
    social_worker: C().assignmentOf(app).assigned_staff,
  };
}

async function matchingTab(req, app) {
  return {
    application_type: app.application_type, track: WF.trackOf(app.application_type),
    milestones: {
      forum_verified_at: app.forum_verified_at, case_study_completed_at: app.case_study_completed_at, cleared_at: app.cleared_at,
      matched_at: app.matched_at, trial_start: iso(app.trial_start), trial_end: iso(app.trial_end), trial_completed_at: app.trial_completed_at,
      placement_ended_at: app.placement_ended_at, petition_date: iso(app.petition_date), racco_office: app.racco_office, published_at: app.published_at,
      appearance_date: iso(app.appearance_date), endorsed_date: iso(app.endorsed_date), nacc_deadline: iso(app.nacc_deadline),
      order_number: app.order_number, order_date: iso(app.order_date), civil_registry_ref: app.civil_registry_ref, closed_at: app.closed_at, finalized_at: app.finalized_at,
    },
    matched_child: app.matched_child_id ? {
      child_id: app.matched_child_id, full_name: app.child_full_name, age: app.child_age, status: app.child_status,
      placement_status: app.child_placement, cdclaa_verified: !!app.child_cdclaa_verified,
    } : null,
    finality_uploaded: (await Adoption.documents(app.application_id)).some((d) => d.doc_type === 'certificate_of_finality' && d.status !== 'Replaced'),
    ...(await matchingData(req, app)),
  };
}

/** Matching (Regular) or link-and-verify (other categories) for the Matching and placement tab. */
async function matchingData(req, app) {
  const M = require('../services/matching');
  const env = require('../config/env');
  if (WF.trackOf(app.application_type) !== 'Regular') {
    const form = await Adoption.form(app.application_id);
    const { decField } = require('../utils/fieldCrypto');
    const [[v]] = await pool.query(`SELECT a.link_child_id, a.link_verified_at, a.link_note, u.full_name AS link_verified_by_name
      FROM tbl_adoption_applications a LEFT JOIN tbl_users u ON u.user_id = a.link_verified_by WHERE a.application_id = ?`, [app.application_id]);
    return { link: { adoptee_name: form.adoptee_name || null, adoptee_dob: form.adoptee_dob || null, adoptee_relationship: form.adoptee_relationship || null,
      child_id: v?.link_child_id || null, verified_at: v?.link_verified_at || null, verified_by_name: v?.link_verified_by_name || null, note: v?.link_note ? decField(v.link_note) : null } };
  }
  const blocks = await M.applicationBlocks(pool, app);
  const matches = await M.matchesFor(pool, app.application_id);
  const active = matches.find((m) => M.ACTIVE.includes(m.status));
  let children = [];
  if (!active) {
    const [rows] = await pool.query(
      `SELECT child_id, full_name, TIMESTAMPDIFF(YEAR, dob, CURDATE()) AS age FROM tbl_children
        WHERE status = 'Active' AND archived_at IS NULL AND available_for_adoption = TRUE AND TIMESTAMPDIFF(YEAR, dob, CURDATE()) < ? ORDER BY first_name, last_name`, [Number(env.transitionAge)]);
    for (const r of rows) {
      const { blocks: cb } = await M.childBlocks(pool, r.child_id);
      children.push({ child_id: r.child_id, full_name: r.full_name, age: r.age, ready: cb.length === 0, blocks: cb.map((b) => b.message) });
    }
  }
  return { matching: { blocks, matches, active_match_id: active?.match_id || null, children, can_approve: req.user.role === 'Admin' } };
}

/** Notes tab: messages to the applicant (from status updates) apart from internal notes (never shown to the donor). */
async function notesTab(req, app) {
  const [history, notes] = await Promise.all([Adoption.history(app.application_id), Adoption.notes(app.application_id)]);
  return {
    messages: history.filter((h) => h.remark_to_applicant).map((h) => ({ history_id: h.history_id, to_status: h.to_status, message: h.remark_to_applicant,
      created_at: h.created_at, by_name: h.changed_by_name, by_role: h.changed_by_role })).reverse(),
    internal_notes: notes.map((n) => ({ ...n, status: history.find((h) => h.history_id === n.history_id)?.to_status || null })).reverse(),
  };
}

/** Timeline tab: status history and key events, read-only. No internal notes here. */
async function timelineTab(req, app) {
  const [history, requests, interviews] = await Promise.all([Adoption.history(app.application_id), Adoption.requests(app.application_id), Adoption.interviews(app.application_id)]);
  const label = (t) => DOCUMENTS[t]?.label || STAGE_DOCUMENTS[t]?.label || 'Document';
  const ev = [];
  history.forEach((h) => ev.push({ at: h.created_at, kind: 'status', text: h.to_status ? (h.from_status ? `Status changed from ${h.from_status} to ${h.to_status}` : `Status set to ${h.to_status}`) : 'Message to the applicant (earlier form)',
    by: h.changed_by_name ? `${h.changed_by_name}${h.changed_by_role ? ` (${h.changed_by_role})` : ''}` : null, message: h.remark_to_applicant ? 'Message sent to the applicant' : null }));
  requests.forEach((r) => {
    ev.push({ at: r.requested_at, kind: 'request', text: `Document requested: ${label(r.doc_type)}`, by: r.requested_by_name });
    if (r.fulfilled_at) ev.push({ at: r.fulfilled_at, kind: 'request', text: `Requested document uploaded: ${label(r.doc_type)}` });
    if (r.closed_at) ev.push({ at: r.closed_at, kind: 'request', text: `Document request closed: ${label(r.doc_type)}` });
  });
  interviews.forEach((i) => ev.push({ at: i.created_at, kind: 'interview', text: `${i.kind} scheduled for ${new Date(i.scheduled_at).toLocaleString('en-PH')}`, by: i.created_by_name }));
  if (app.finalized_at) ev.push({ at: app.finalized_at, kind: 'milestone', text: 'Adoption finalized' });
  if (app.archived_at) ev.push({ at: app.archived_at, kind: 'milestone', text: 'Application archived' });
  ev.push(...(await require('../services/adoptionStages').timelineEvents(app.application_id)));
  return { events: ev.filter((e) => e.at).sort((a, b) => new Date(b.at) - new Date(a.at)) };
}

/** Workflow tab: the 17 stages, each stage's record and entries, the existing child, closure checklist. */
async function workflowTab(req, app) {
  const Stages = require('../services/adoptionStages');
  const ST = require('../config/adoptionStages');
  const [form, documents] = await Promise.all([Adoption.form(app.application_id), Adoption.documents(app.application_id)]);
  const comp = await completeness(app, form, documents);
  const pages = completedPages(form, app.application_type, documents);
  const info = await Stages.caseStages(pool, app, { docs: comp.summary, pagesComplete: !app.created_by_staff || pages.length === 8 });
  // Existing children to choose from (Regular, before a match): never a copy, always the child record itself.
  let children = [];
  if (WF.trackOf(app.application_type) === 'Regular' && !app.matched_child_id) {
    const [rows] = await pool.query(
      `SELECT c.child_id, c.full_name, TIMESTAMPDIFF(YEAR, c.dob, CURDATE()) AS age, c.available_for_adoption, e.status AS eligibility
         FROM tbl_children c LEFT JOIN tbl_child_adoption_eligibility e ON e.child_id = c.child_id
        WHERE c.status = 'Active' AND c.archived_at IS NULL AND TIMESTAMPDIFF(YEAR, c.dob, CURDATE()) < 18 ORDER BY c.full_name`).catch(() => [[]]);
    children = rows.map((r) => ({ child_id: r.child_id, full_name: r.full_name, age: r.age, available: !!r.available_for_adoption, eligibility: r.eligibility || null }));
  }
  return {
    ...info, config: { stages: ST.STAGES, eligibility_fields: ST.ELIGIBILITY_FIELDS }, children,
    status: app.status, track: WF.trackOf(app.application_type), created_by_staff: Boolean(app.created_by_staff), completed_pages: pages,
    allowed_statuses: app.archived_at ? [] : WF.allowedTargets(app.status, app.application_type, req.user.role), documents_summary: comp.summary,
  };
}

const BUILDERS = { workflow: workflowTab, overview: null, applicant: applicantTab, documents: documentsTab, idcheck: idCheckTab, assessment: assessmentTab, matching: matchingTab, notes: notesTab, timeline: timelineTab };

/** GET /api/adoptions/:id/tab/:tab (Admin, Staff) - one tab's data, after the same access checks. */
exports.tab = async (req, res) => {
  const tab = String(req.params.tab || '');
  if (!TABS.includes(tab) || !BUILDERS[tab]) throw new HttpError(404, 'Unknown tab.');
  const { loadById, requireSensitive } = C();
  const app = await loadById(req);
  const access = await requireSensitive(req, app, 'This part of the application');
  const data = await BUILDERS[tab](req, app);
  await U.logEvent(req, { recordType: 'adoption_application', recordId: app.application_id, event: 'view_sections',
    purpose: access.admin ? 'Admin full access' : access.purpose, detail: `tab: ${tab}` });
  res.json({ success: true, data });
};

module.exports.shell = shell;
module.exports.TABS = TABS;
module.exports.displayName = displayName;
module.exports.requestThreads = requestThreads;
module.exports.progressOf = progressOf;
module.exports.missingAnswers = missingAnswers;
