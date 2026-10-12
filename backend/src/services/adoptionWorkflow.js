/**
 * RA 11642 adoption workflow on the server: allowed transitions (config/adoptionWorkflow.js),
 * what each step requires, and its effects on the child's placement. Every step runs in
 * one transaction with the application row locked.
 */
const { withTransaction } = require('../config/db');
const env = require('../config/env');
const Adoption = require('../models/adoptionModel');
const HttpError = require('../utils/HttpError');
const WF = require('../config/adoptionWorkflow');
const { DOCUMENTS, STAGE_DOCUMENTS } = require('../config/adoptionForm');
const Notify = require('./notifications');

const str = (v) => (v === undefined || v === null ? '' : String(v).trim());
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const todayIso = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const AUTO_CLOSE_REMARK = 'This application was closed because the matched child\'s adoption has been finalized with another family. You are welcome to apply again.';

function validDate(v) {
  if (!DATE.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}
function requireDate(value, label, { notFuture = true, notOlderDays } = {}) {
  const v = str(value);
  if (!v) throw new HttpError(400, `${label} is required.`);
  if (!validDate(v)) throw new HttpError(400, `Enter a valid ${label.toLowerCase()}.`);
  if (notFuture && v > todayIso()) throw new HttpError(400, `${label} cannot be in the future.`);
  if (notOlderDays) {
    const min = new Date(Date.now() - notOlderDays * 86400000).toISOString().slice(0, 10);
    if (v < min) throw new HttpError(400, `${label} is too far in the past.`);
  }
  return v;
}
function requireText(value, label, max) {
  const v = str(value);
  if (!v) throw new HttpError(400, `${label} is required.`);
  if (v.length > max) throw new HttpError(400, `${label} can be up to ${max} characters.`);
  return v;
}
function addMonths(iso, months) {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1 + months, d));
  // Clamp to the month's last day (e.g. 31 Aug + 6 months = 28/29 Feb).
  if (dt.getUTCDate() !== d) dt.setUTCDate(0);
  return dt.toISOString().slice(0, 10);
}
const addDays = (iso, days) => new Date(new Date(`${iso}T00:00:00Z`).getTime() + days * 86400000).toISOString().slice(0, 10);

/** Child can be matched: Active, under 18, Available for adoption, verified CDCLAA, not placed (decision 3). */
async function assertMatchable(conn, childId, { lock = false } = {}) {
  const [[c]] = await conn.query(
    `SELECT child_id, status, available_for_adoption, placement_status, cdclaa_verified_at, TIMESTAMPDIFF(YEAR, dob, CURDATE()) AS age
       FROM tbl_children WHERE child_id = ? ${lock ? 'FOR UPDATE' : ''}`, [childId]);
  if (!c) throw new HttpError(404, 'Child record not found.');
  if (c.status !== 'Active') throw new HttpError(409, `This child is ${c.status.toLowerCase()} and cannot be matched.`);
  if (Number(c.age) >= Number(env.transitionAge)) throw new HttpError(409, 'Only children under 18 can be matched.');
  if (!c.cdclaa_verified_at) throw new HttpError(409, 'This child has no CDCLAA verified by an administrator, so matching is blocked.');
  if (!c.available_for_adoption) throw new HttpError(409, 'This child is not marked Available for adoption.');
  if (c.placement_status !== 'None') throw new HttpError(409, 'This child is already matched or in trial custody with another applicant.');
  return c;
}

/** Validates a status update request. Returns the cleaned payload (no database writes). */
function cleanStatusUpdate(app, body, role) {
  const target = str(body.status);
  if (!WF.STATUSES.includes(target) || target === 'Draft' || target === 'Withdrawn') throw new HttpError(400, 'Choose a status from the list.');
  if (app.archived_at) throw new HttpError(409, 'This application is archived and read-only.');
  if (WF.FINAL.includes(app.status)) throw new HttpError(409, `This application is ${app.status} and read-only.`);
  const t = WF.transition(app.status, app.application_type, target);
  if (!t) throw new HttpError(409, `An application at "${app.status}" cannot move to "${target}".`);
  if (t.via === 'matching') throw new HttpError(409, 'Matching is recorded in the Matching and placement tab: propose the match, then an administrator approves it.');
  if (!t.roles.includes(role)) throw new HttpError(403, `Only an administrator can record "${target}".`);

  if (str(body.remark).length > 3000) throw new HttpError(400, 'The remark to the applicant can be up to 3000 characters.');
  if (str(body.internal_note).length > 5000) throw new HttpError(400, 'The internal note can be up to 5000 characters.');
  const u = { target, remark: str(body.remark) || null, internalNote: str(body.internal_note) || null, documents: [], interview: null, fields: {} };

  switch (target) {
    case 'Documents requested': {
      const docs = Array.isArray(body.documents) ? body.documents : [];
      if (!docs.length) throw new HttpError(400, 'Choose at least one document to request.');
      if (docs.length > 20) throw new HttpError(400, 'Request up to 20 documents at a time.');
      const seen = new Set();
      for (const d of docs) {
        const type = str(d?.doc_type);
        if (!DOCUMENTS[type] && type !== 'forum_certificate') throw new HttpError(400, 'Choose documents from the document list.');
        if (seen.has(type)) continue;
        seen.add(type);
        if (str(d?.message).length > 500) throw new HttpError(400, 'Each document request message can be up to 500 characters.');
        u.documents.push({ doc_type: type, message: str(d?.message) || null });
      }
      break;
    }
    case 'Home study scheduled': {
      const i = body.interview || {};
      const when = str(i.scheduled_at).replace('T', ' ');
      if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}(:\d{2})?$/.test(when) || Number.isNaN(new Date(when.replace(' ', 'T')).getTime())) {
        throw new HttpError(400, 'Enter the date and time of the home study visit.');
      }
      if (new Date(when.replace(' ', 'T')) < new Date()) throw new HttpError(400, 'The home study visit must be in the future.');
      if (str(i.details).length > 500) throw new HttpError(400, 'Visit details can be up to 500 characters.');
      u.interview = { kind: 'Home study', scheduled_at: when.length === 16 ? `${when}:00` : when, details: str(i.details) || null };
      break;
    }
    case 'Child matched':
      if (!str(body.child_id)) throw new HttpError(400, 'Choose the child to match.');
      u.childId = str(body.child_id);
      break;
    case 'Trial custody': {
      const start = requireDate(body.trial_start, 'Trial custody start date', { notFuture: false, notOlderDays: 366 });
      if (start > addDays(todayIso(), 60)) throw new HttpError(400, 'The trial custody start date can be at most 60 days ahead.');
      u.fields = { trial_start: start, trial_end: addMonths(start, WF.TRIAL_MONTHS) };
      break;
    }
    case 'Placement ended':
      u.reason = requireText(body.reason || body.internal_note, 'The reason the placement ended', 2000);
      break;
    case 'Petition filed':
      u.fields = { petition_date: requireDate(body.petition_date, 'Petition filing date'), racco_office: requireText(body.racco_office, 'RACCO office', 150) };
      break;
    case 'Mandatory appearance done':
      u.fields = { appearance_date: requireDate(body.appearance_date, 'Appearance date') };
      break;
    case 'Endorsed to NACC': {
      const d = requireDate(body.endorsed_date, 'Endorsement date');
      u.fields = { endorsed_date: d, nacc_deadline: addDays(d, WF.NACC_DECISION_DAYS) };
      break;
    }
    case 'Order of Adoption issued':
      u.fields = { order_number: requireText(body.order_number, 'Order of Adoption number', 80), order_date: requireDate(body.order_date, 'Order date') };
      break;
    case 'Civil registry updated':
      u.fields = { civil_registry_ref: requireText(body.civil_registry_ref, 'LCR / PSA reference', 120) };
      break;
    case 'Declined':
      if (!u.remark) throw new HttpError(400, 'Give the applicant a reason in the remark when declining.');
      break;
    default:
  }
  return u;
}

async function hasDocument(conn, applicationId, docType) {
  const [[r]] = await conn.query(
    "SELECT COUNT(*) AS n FROM tbl_adoption_documents WHERE application_id = ? AND doc_type = ? AND status = 'Uploaded'", [applicationId, docType]);
  return Number(r.n) > 0;
}

/**
 * The gate: what keeps an application from moving to `target`. One list used both to refuse the move
 * (applyStatusUpdate) and to explain blocked stages on the detail page, so the two never disagree.
 * Returns [{ doc_type?, label, status?, message }]; empty = allowed. Reads only.
 */
async function blockersFor(conn, cur, target) {
  const id = cur.application_id;
  const out = [];
  const iso = (v) => (v ? String(v instanceof Date ? v.toISOString() : v).slice(0, 10) : null);
  if (WF.DOCUMENTS_COMPLETE_FOR.includes(target) && !cur.is_legacy) {
    const { documentChecklist } = require('./adoptionValidation');
    const c = documentChecklist(await Adoption.form(id), cur.application_type, await Adoption.documents(id, conn));
    const all = [...c.summary.blocking, ...(await require('./verification').blocking(id))];
    all.forEach((b) => out.push({ ...b, message: `${b.label} (${b.status})` }));
    // Submitted before the ID and clearance checks existed: those details must be collected first.
    const [[vc]] = await conn.query('SELECT COUNT(*) AS n FROM tbl_verifications WHERE application_id = ?', [id]);
    if (!Number(vc.n) && cur.submitted_at) {
      out.push({ doc_type: 'verification:missing', label: 'Government ID and clearance details', status: 'Pending submission',
        message: 'This application has no ID or clearance checks (it was submitted before they existed). Ask the applicant for the details, then record them.' });
    }
  }
  // Regular adoption: the home's documents for the matched child must be uploaded before the petition.
  if (target === 'Petition filed' && WF.trackOf(cur.application_type) === 'Regular' && cur.matched_child_id) {
    const [[child]] = await conn.query('SELECT TIMESTAMPDIFF(YEAR, dob, CURDATE()) AS age FROM tbl_children WHERE child_id = ?', [cur.matched_child_id]);
    const age = Number(child?.age ?? 0);
    for (const [key, def] of Object.entries(STAGE_DOCUMENTS)) {
      if (!def.petition) continue;
      if ((def.petition === 'age5' && age < 5) || (def.petition === 'age10' && age < 10)) continue;
      if (!(await hasDocument(conn, id, key))) out.push({ doc_type: key, label: def.label, status: 'Pending submission', message: `Upload the child's document first: ${def.label}.` });
    }
  }
  const needDoc = async (docType, message) => { if (!(await hasDocument(conn, id, docType))) out.push({ doc_type: docType, label: STAGE_DOCUMENTS[docType].label, status: 'Pending submission', message }); };
  switch (target) {
    case 'Forum attended': await needDoc('forum_certificate', 'Upload the applicant\'s forum certificate before recording Forum attended.'); break;
    case 'Case study completed': await needDoc('case_study_report', 'Upload the Social Case Study Report before recording Case study completed.'); break;
    case 'Cleared for matching':
      if (!cur.forum_verified_at) out.push({ label: 'Forum attended', message: 'Record Forum attended (with the verified certificate) first.' });
      if (!cur.case_study_completed_at) out.push({ label: 'Case study completed', message: 'Record Case study completed (with the report) first.' });
      break;
    case 'Trial custody':
      if (!cur.matched_child_id) out.push({ label: 'Matched child', message: 'Match a child first.' });
      else out.push(...(await require('./matching').trialBlockers(conn, cur)));
      break;
    case 'Trial custody completed': {
      const end = iso(cur.trial_end);
      if (!end) out.push({ label: 'Trial custody start date', message: 'Record the trial custody start date first.' });
      else if (end > todayIso()) out.push({ label: 'Trial custody period', message: `Trial custody runs until ${end} (6 months). It can be completed on or after that date.` });
      break;
    }
    case 'Published': await needDoc('publication_proof', 'Upload the proof of publication before recording Published.'); break;
    case 'Order of Adoption issued':
      // The Order comes first; the Certificate of Finality is recorded in its own stage afterwards.
      await needDoc('order_of_adoption', 'Upload the Order of Adoption before recording it.');
      if (cur.application_type === 'Regular' && !cur.matched_child_id) out.push({ label: 'Matched child', message: 'A regular adoption needs a matched child.' });
      break;
    case 'Civil registry updated': await needDoc('certificate_of_finality', 'Upload the Certificate of Finality before recording the civil registration.'); break;
    default:
  }
  // The stage records a status needs (assessment result, placement, RACCO, NACC decision, Order, finality, closure).
  out.push(...(await require('./adoptionStages').gateFor(conn, cur, target)));
  return out;
}

/** Turns gate blockers into the 409 the server returns (same wording as before). */
function gateError(blockers, target) {
  const docs = blockers.filter((b) => b.status);
  if (WF.DOCUMENTS_COMPLETE_FOR.includes(target) && docs.length && !docs.every((b) => b.doc_type === 'verification:missing')) {
    const list = docs.filter((b) => b.doc_type !== 'verification:missing').slice(0, 8).map((b) => b.message).join('; ');
    return new HttpError(409, `The application isn't complete yet. These still need verification: ${list}${docs.length > 8 ? '; and more' : ''}.`, { incomplete_documents: docs.map(({ message, ...b }) => b) });
  }
  if (target === 'Petition filed' && blockers.every((b) => b.doc_type && STAGE_DOCUMENTS[b.doc_type])) {
    return new HttpError(409, `Upload the child's documents before filing the petition: ${blockers.map((b) => b.label).join('; ')}.`, { incomplete_documents: docs.map(({ message, ...b }) => b) });
  }
  return new HttpError(409, blockers[0].message, docs.length ? { incomplete_documents: docs.map(({ message, ...b }) => b) } : undefined);
}

/** Releases the child's placement (Placement ended, Declined, Withdrawn). */
async function releasePlacement(conn, app) {
  if (!app.matched_child_id) return;
  await conn.query("UPDATE tbl_children SET placement_status = 'None' WHERE child_id = ? AND placement_status <> 'None'", [app.matched_child_id]);
}

/** Applies a validated status update in one transaction. Returns { historyId, closed }. */
async function applyStatusUpdate(app, u, userId) {
  return withTransaction(async (conn) => {
    const [[cur]] = await conn.query('SELECT * FROM tbl_adoption_applications WHERE application_id = ? FOR UPDATE', [app.application_id]);
    if (cur.status !== app.status) throw new HttpError(409, 'This application was just updated by someone else. Refresh and try again.');
    const id = app.application_id;
    const set = { status: u.target, ...u.fields };
    const notes = [];
    let closed = [];

    // The gate (documents, ID and clearance checks, the child's documents, earlier steps): one list, see blockersFor.
    const blockers = await blockersFor(conn, cur, u.target);
    if (blockers.length) throw gateError(blockers, u.target);

    switch (u.target) {
      case 'Forum attended':
        set.forum_verified_at = new Date();
        break;
      case 'Case study completed':
        set.case_study_completed_at = new Date();
        break;
      case 'Cleared for matching':
        set.cleared_at = new Date();
        set.decided_at = new Date();
        break;
      case 'Child matched': {
        await assertMatchable(conn, u.childId, { lock: true });
        await conn.query("UPDATE tbl_children SET placement_status = 'Matched' WHERE child_id = ?", [u.childId]);
        set.matched_child_id = u.childId;
        set.matched_at = new Date();
        set.placement_ended_at = null;
        break;
      }
      case 'Trial custody':
        if (cur.matched_at && u.fields.trial_start < String(new Date(cur.matched_at).toISOString()).slice(0, 10)) {
          throw new HttpError(400, 'Trial custody cannot start before the match date.');
        }
        await conn.query("UPDATE tbl_children SET placement_status = 'Trial custody' WHERE child_id = ?", [cur.matched_child_id]);
        break;
      case 'Trial custody completed':
        set.trial_completed_at = new Date();
        break;
      case 'Placement ended':
        await releasePlacement(conn, cur);
        notes.push(`Placement ended${cur.matched_child_id ? ` with child ${cur.matched_child_id}` : ''}. Reason: ${u.reason}`);
        set.matched_child_id = null;
        set.placement_ended_at = new Date();
        set.trial_start = null;
        set.trial_end = null;
        break;
      case 'Published':
        set.published_at = new Date();
        break;
      case 'Order of Adoption issued': {
        set.finalized_at = new Date();
        set.finalized_by = userId;
        set.decided_at = new Date();
        if (cur.matched_child_id) {
          const [[child]] = await conn.query('SELECT status FROM tbl_children WHERE child_id = ? FOR UPDATE', [cur.matched_child_id]);
          if (!child) throw new HttpError(404, 'The matched child record no longer exists.');
          if (child.status !== 'Active') throw new HttpError(409, `The matched child is already ${child.status.toLowerCase()}.`);
          await conn.query("UPDATE tbl_children SET status = 'Adopted', available_for_adoption = FALSE, placement_status = 'None' WHERE child_id = ?", [cur.matched_child_id]);
          // Close every other open application for this child.
          const [others] = await conn.query(
            'SELECT application_id, status, matched_child_id FROM tbl_adoption_applications WHERE matched_child_id = ? AND application_id <> ? AND status IN (?) FOR UPDATE',
            [cur.matched_child_id, id, WF.ACTIVE]);
          for (const o of others) {
            await conn.query("UPDATE tbl_adoption_applications SET status = 'Declined', decided_at = NOW(), matched_child_id = NULL WHERE application_id = ?", [o.application_id]);
            await Adoption.addHistory(conn, { application_id: o.application_id, from_status: o.status, to_status: 'Declined', changed_by: userId, remark: AUTO_CLOSE_REMARK });
            await conn.query("UPDATE tbl_application_document_requests SET status = 'Closed', closed_at = NOW() WHERE application_id = ? AND status = 'Open'", [o.application_id]);
            const [[oa]] = await conn.query('SELECT applicant_id, reference_no FROM tbl_adoption_applications WHERE application_id = ?', [o.application_id]);
            await Notify.adoptionStatus(conn, { applicantId: oa.applicant_id, applicationId: o.application_id, reference: oa.reference_no, status: 'Declined' });
          }
          closed = others.map((o) => o.application_id);
        }
        break;
      }
      case 'Closed':
        set.closed_at = new Date();
        break;
      case 'Declined':
        if (WF.PLACED.includes(cur.status)) await releasePlacement(conn, cur);
        set.decided_at = new Date();
        break;
      default:
    }

    const keys = Object.keys(set);
    await conn.query(`UPDATE tbl_adoption_applications SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE application_id = ?`, [...keys.map((k) => set[k]), id]);
    const historyId = await Adoption.addHistory(conn, { application_id: id, from_status: cur.status, to_status: u.target, changed_by: userId, remark: u.remark });
    // The application's match follows the status (Trial custody: placed; declined or placement ended: withdrawn).
    if (!u.keepMatches) await require('./matching').onStatusChange(conn, cur, u.target, userId);
    if (u.afterInTx) await u.afterInTx(conn, historyId);
    if (u.internalNote) notes.push(u.internalNote);
    for (const n of notes) await Adoption.addNote(conn, { application_id: id, history_id: historyId, author_id: userId, note: n });
    for (const d of u.documents) {
      await conn.query('INSERT INTO tbl_application_document_requests (application_id, history_id, doc_type, message, requested_by) VALUES (?, ?, ?, ?, ?)',
        [id, historyId, d.doc_type, d.message, userId]);
    }
    if (u.interview) {
      await conn.query('INSERT INTO tbl_application_interviews (application_id, history_id, kind, scheduled_at, details, created_by) VALUES (?, ?, ?, ?, ?, ?)',
        [id, historyId, u.interview.kind, u.interview.scheduled_at, u.interview.details, userId]);
    }
    // Notifications in this same transaction (reference and stage only, never remarks or notes).
    await Notify.adoptionStatus(conn, {
      applicantId: cur.applicant_id, applicationId: id, reference: cur.reference_no, status: u.target, documentsRequested: u.documents.length > 0, historyId,
    });
    if (u.remark && !['Declined'].includes(u.target)) {
      await Notify.emit(conn, 'application_remark', { userId: cur.applicant_id, applicationId: id, entityType: 'application', entityId: id,
        params: { id, ref: cur.reference_no }, groupKey: `application_remark:history:${historyId}` });
    }
    if (u.target === 'Case study completed') {
      await Notify.toAdmins(conn, 'admin_decision_needed', { entityType: 'application', entityId: id, params: { id, ref: cur.reference_no },
        groupKey: `admin_decision_needed:history:${historyId}` });
    }
    if (['Declined', 'Order of Adoption issued', 'Closed'].includes(u.target)) {
      await conn.query("UPDATE tbl_application_document_requests SET status = 'Closed', closed_at = NOW() WHERE application_id = ? AND status = 'Open'", [id]);
    }
    return { historyId, closed };
  });
}

/** Donor withdraws (decision 4): any stage before the Order of Adoption. The child's placement is released. */
async function withdraw(app, userId) {
  return withTransaction(async (conn) => {
    const [[cur]] = await conn.query('SELECT * FROM tbl_adoption_applications WHERE application_id = ? FOR UPDATE', [app.application_id]);
    if (!WF.WITHDRAWABLE.includes(cur.status)) throw new HttpError(409, `An application at "${cur.status}" can no longer be withdrawn.`);
    if (WF.PLACED.includes(cur.status)) await releasePlacement(conn, cur);
    await conn.query("UPDATE tbl_adoption_applications SET status = 'Withdrawn', withdrawn_at = NOW() WHERE application_id = ?", [cur.application_id]);
    await conn.query("UPDATE tbl_application_document_requests SET status = 'Closed', closed_at = NOW() WHERE application_id = ? AND status = 'Open'", [cur.application_id]);
    const historyId = await Adoption.addHistory(conn, { application_id: cur.application_id, from_status: cur.status, to_status: 'Withdrawn', changed_by: userId });
    await require('./matching').onStatusChange(conn, cur, 'Withdrawn', userId);
    const params = { id: cur.application_id, ref: cur.reference_no };
    await Notify.adoptionStatus(conn, { applicantId: cur.applicant_id, applicationId: cur.application_id, reference: cur.reference_no, status: 'Withdrawn', historyId });
    await Notify.toAdmins(conn, 'admin_application_withdrawn', { entityType: 'application', entityId: cur.application_id, params, groupKey: `admin_withdrawn:${cur.application_id}` });
    return cur.status;
  });
}

/** Deadlines for the staff page and the dashboard. */
function deadlines(app) {
  const iso = (v) => (v ? String(v instanceof Date ? v.toISOString() : v).slice(0, 10) : null);
  const daysLeft = (d) => (d ? Math.ceil((new Date(`${d}T00:00:00`).getTime() - new Date(`${todayIso()}T00:00:00`).getTime()) / 86400000) : null);
  const out = {};
  if (['Trial custody'].includes(app.status) && app.trial_end) out.trial_end = { date: iso(app.trial_end), days_left: daysLeft(iso(app.trial_end)) };
  if (['Endorsed to NACC', 'Awaiting NACC decision'].includes(app.status) && app.nacc_deadline) {
    out.nacc_deadline = { date: iso(app.nacc_deadline), days_left: daysLeft(iso(app.nacc_deadline)) };
  }
  return out;
}

module.exports = {
  cleanStatusUpdate, applyStatusUpdate, withdraw, assertMatchable, deadlines, addMonths, addDays, blockersFor,
  STAGE_DOC_TYPES: Object.keys(STAGE_DOCUMENTS),
};
