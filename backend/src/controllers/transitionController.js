const { pool } = require('../config/db');
const HttpError = require('../utils/HttpError');
const { oneOf, toInt, likeParam } = require('../utils/validate');
const { logActivity } = require('../utils/audit');
const { syncFlags } = require('./childController');
const U = require('../services/unlockService');
const { maskName } = require('../config/adoptionSensitive');
const { LOCKED_TRANSITION } = require('../config/transitionSensitive');
const { decField } = require('../utils/fieldCrypto');
const { saveUpload, readUpload, deleteUpload, verifyUpload, MB } = require('../utils/files');
const W = require('../services/transitionWorkflow');
const TC = require('../config/transitionWorkflow');

const STATUSES = ['For Review', 'In Progress', 'Completed'];
/** List order. Default: most recent activity. Age is only a sort the user picks. */
const TRANSITION_SORTS = {
  recent: 'COALESCE(tr.updated_at, tr.flagged_at) DESC, tr.review_id DESC', flagged: 'tr.flagged_at DESC, tr.review_id DESC',
  status: "FIELD(tr.review_status, 'For Review', 'In Progress', 'Completed'), tr.flagged_at DESC", case: 'c.child_id ASC', age: 'c.dob DESC',
};
const REC = 'transition_review';
const DATE = /^\d{4}-\d{2}-\d{2}$/;

const SELECT = `SELECT tr.review_id, tr.child_id, tr.review_status, tr.notes, tr.housing_goal, tr.vocational_goal,
    tr.education_goal, tr.flagged_at, tr.updated_at, tr.informed_at, tr.informed_by, u.full_name AS updated_by_name,
    c.full_name, c.gender, c.dob, c.status AS child_status, tr.assigned_staff_id, asu.full_name AS assigned_staff_name,
    asu.is_active AS assigned_staff_active, tr.assigned_at, aby.full_name AS assigned_by_name,
    TIMESTAMPDIFF(YEAR, c.dob, CURDATE()) AS age, tr.proposed_pathway, tr.target_transition_date, tr.next_review_date,
    tr.assessment_started_at, tr.closed_at, tr.final_outcome, tr.closure_date, tr.final_assessment_enc, tr.closure_notes_enc, tr.closed_by,
    cb.full_name AS closed_by_name, c.assigned_staff_id AS child_case_worker_id
  FROM tbl_transition_reviews tr
  JOIN tbl_children c ON c.child_id = tr.child_id
  LEFT JOIN tbl_users u ON u.user_id = tr.updated_by
  LEFT JOIN tbl_users asu ON asu.user_id = tr.assigned_staff_id
  LEFT JOIN tbl_users aby ON aby.user_id = tr.assigned_by
  LEFT JOIN tbl_users cb ON cb.user_id = tr.closed_by`;

/** Admin: always open. Staff: only the review's assigned staff (active account), during an unlock session. */
async function access(req, row) {
  if (req.user.role === 'Admin') return { unlocked: true, assigned: true, admin: true };
  // The review's own assignment or the child's case worker assignment (one assignment service, shared policy).
  const assigned = await require('../services/childAccess').isAssigned(req, REC, row.review_id);
  if (!assigned) return { unlocked: false, assigned: false };
  const s = await U.sessionFor(req, REC, row.review_id);
  return { unlocked: Boolean(s), assigned: true, expires_at: s?.expires_at || null, purpose: s?.purpose || null };
}

/** What everyone may see: case number, age, flagged date, status, the current stage, masked name. */
function basic(row) {
  return {
    review_id: row.review_id, case_number: row.child_id, age: row.age, flagged_at: row.flagged_at, review_status: row.review_status,
    masked_name: maskName(row.full_name), closed: Boolean(row.closed_at), legacy_completed: row.review_status === 'Completed' && !row.closed_at,
    // A deactivated staff account shows as unassigned (Admin sees a flag).
    assigned_staff: row.assigned_staff_id && row.assigned_staff_active ? { user_id: row.assigned_staff_id, name: row.assigned_staff_name } : null,
    assigned_staff_name: row.assigned_staff_active ? row.assigned_staff_name : null,
    assigned_by_name: row.assigned_by_name || null, assigned_at: row.assigned_at || null,
  };
}

function goalsOf(row) {
  return [['Housing', row.housing_goal], ['Vocational', row.vocational_goal], ['Education', row.education_goal]].filter(([, v]) => v).map(([l]) => l);
}

function full(row) {
  return {
    ...basic(row), child_id: row.child_id, full_name: row.full_name, gender: row.gender, dob: row.dob, child_status: row.child_status,
    notes: row.notes, housing_goal: row.housing_goal, vocational_goal: row.vocational_goal, education_goal: row.education_goal, goals: goalsOf(row),
    updated_at: row.updated_at, updated_by_name: row.updated_by_name, informed_at: row.informed_at, informed_by: row.informed_by,
    proposed_pathway: row.proposed_pathway, target_transition_date: W.ymd(row.target_transition_date), next_review_date: W.ymd(row.next_review_date),
    assessment_started_at: row.assessment_started_at, closed_at: row.closed_at, closed_by_name: row.closed_by_name, final_outcome: row.final_outcome,
    closure_date: W.ymd(row.closure_date), final_assessment: decField(row.final_assessment_enc), closure_notes: decField(row.closure_notes_enc),
    assignment_flag: row.assigned_staff_id && !row.assigned_staff_active ? `Assigned to ${row.assigned_staff_name}, whose account is deactivated` : null,
  };
}

async function loadRow(id) {
  const [[row]] = await pool.query(`${SELECT} WHERE tr.review_id = ?`, [id]);
  if (!row) throw new HttpError(404, 'Transition review not found.');
  return row;
}

/** The current stage label for the list (cheap: from the review's own columns and counts). */
async function stagesFor(rows) {
  if (!rows.length) return {};
  const out = {};
  for (const r of rows) {
    const d = await W.loadAll(pool, r);
    const st = W.stageStates(r, d);
    const cur = st.find((x) => x.state === 'current');
    out[r.review_id] = { stage: r.closed_at ? 'Closed' : cur ? cur.label : 'Closed', stages: st.map(({ key, label, state }) => ({ key, label, state })) };
  }
  return out;
}

/**
 * GET /api/transition-reviews?status=&assigned=&from=&to=&q=&sort= - young people flagged at 18+ (never discharged automatically).
 * Admin: everything (search by name or case number). Staff: case number, age, flagged date, status, stage and a
 * masked name only; search by case number only, so a name search can't reveal anyone. from/to filter the date
 * flagged; activity=7|30|90 shows reviews with activity in the last N days.
 */
exports.list = async (req, res) => {
  await syncFlags(true);
  const isAdmin = req.user.role === 'Admin';
  const where = [];
  const params = [];
  if (req.query.status) { where.push('tr.review_status = ?'); params.push(oneOf(req.query.status, STATUSES, 'status')); }
  // Assigned staff filter: Admin "none" or a staff id; anyone "me".
  if (req.query.assigned === 'me') { where.push('tr.assigned_staff_id = ? AND asu.is_active = TRUE'); params.push(req.user.user_id); }
  else if (isAdmin && req.query.assigned === 'none') where.push('(tr.assigned_staff_id IS NULL OR asu.is_active = FALSE)');
  else if (isAdmin && req.query.assigned) { where.push('tr.assigned_staff_id = ? AND asu.is_active = TRUE'); params.push(toInt(req.query.assigned, 'assigned', { min: 1 })); }
  for (const [k, op] of [['from', '>='], ['to', '<=']]) {
    if (!req.query[k]) continue;
    if (!DATE.test(String(req.query[k]))) throw new HttpError(400, 'Choose a valid date.');
    where.push(`DATE(tr.flagged_at) ${op} ?`); params.push(String(req.query[k]));
  }
  if (req.query.activity) {
    const days = toInt(req.query.activity, 'activity', { min: 1, max: 366 });
    where.push('COALESCE(tr.updated_at, tr.flagged_at) >= NOW() - INTERVAL ? DAY'); params.push(days);
  }
  if (req.query.q) {
    const p = likeParam(req.query.q);
    if (isAdmin) { where.push('(c.full_name LIKE ? OR c.child_id LIKE ? OR tr.review_status LIKE ?)'); params.push(p, p, p); }
    else { where.push('c.child_id LIKE ?'); params.push(p); }
  }
  const [rows] = await pool.query(`${SELECT} ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
    ORDER BY ${TRANSITION_SORTS[req.query.sort] || TRANSITION_SORTS.recent}`, params);
  const stages = await stagesFor(rows);
  const [[counts]] = await pool.query(`SELECT COUNT(*) AS all_count, SUM(review_status = 'For Review') AS for_review, SUM(review_status = 'In Progress') AS in_progress,
    SUM(review_status = 'Completed') AS completed FROM tbl_transition_reviews`);
  if (isAdmin) await logActivity(req, 'VIEW_TRANSITION_REVIEWS (Admin full access)', 'Transition reviews');
  res.json({
    success: true,
    data: rows.map((r) => (isAdmin
      ? { ...full(r), masked: false, current_stage: stages[r.review_id]?.stage }
      : { ...basic(r), masked: true, current_stage: stages[r.review_id]?.stage, assigned_to_me: r.assigned_staff_id === req.user.user_id && !!r.assigned_staff_active })),
    meta: { counts: { all: Number(counts.all_count) || 0, 'For Review': Number(counts.for_review) || 0, 'In Progress': Number(counts.in_progress) || 0, Completed: Number(counts.completed) || 0 } },
  });
};

/** Active staff a task can be assigned to (names only, for the assignee list). */
async function staffList() {
  const [rows] = await pool.query(`SELECT u.user_id, u.full_name, r.role_name AS role FROM tbl_users u JOIN tbl_roles r ON r.role_id = u.role_id
    WHERE u.is_active = TRUE AND r.role_name IN ('Admin', 'Staff') ORDER BY u.full_name`);
  return rows;
}

async function timeline(id) {
  const [rows] = await pool.query(`SELECT e.event_id, e.stage_key, e.action, e.summary, e.from_value, e.to_value, e.created_at, u.full_name AS actor_name
    FROM tbl_transition_events e LEFT JOIN tbl_users u ON u.user_id = e.actor_id WHERE e.review_id = ? ORDER BY e.created_at DESC, e.event_id DESC LIMIT 300`, [id]);
  return rows;
}

/** The full review for Admin or the unlocked assigned case worker: details, the 9 stages and every stage's records. */
async function fullView(req, row, a) {
  const d = await W.loadAll(pool, row);
  const isAdmin = req.user.role === 'Admin';
  return {
    ...full(row), locked: false, sensitive: { unlocked: true, admin: !!a.admin, expires_at: a.expires_at, purpose: a.purpose },
    stages: W.stageStates(row, d), workflow: d, closure_checklist: W.closureChecklist(row, d), timeline: await timeline(row.review_id),
    current_placement: d.discharge ? d.discharge.destination_type : 'Residential care (this home)',
    permissions: { admin: isAdmin, can_edit: !row.closed_at || isAdmin, closed: Boolean(row.closed_at) },
    staff: await staffList(),
    config: {
      stages: TC.STAGES, ratings: TC.RATINGS, overall: TC.OVERALL, categories: TC.CATEGORIES, child_voice: TC.CHILD_VOICE, meeting_types: TC.MEETING_TYPES,
      participant_roles: TC.PARTICIPANT_ROLES, recommendations: TC.RECOMMENDATIONS, pathways: TC.PATHWAYS, decisions: TC.DECISIONS, task_statuses: TC.TASK_STATUSES,
      priorities: TC.PRIORITIES, preparation: TC.PREPARATION, destinations: TC.DESTINATIONS, contact_types: TC.CONTACT_TYPES, visit_fields: TC.VISIT_FIELDS, outcomes: TC.OUTCOMES,
    },
  };
}

/** GET /api/transition-reviews/:id - full review only for Admin or the unlocked assigned case worker. */
exports.getOne = async (req, res) => {
  const row = await loadRow(toInt(req.params.id, 'id', { min: 1 }));
  const a = await access(req, row);
  if (!a.unlocked) {
    const d = await W.loadAll(pool, row);
    return res.json({ success: true, data: { ...basic(row), locked: true, stages: W.stageStates(row, d).map(({ key, label, state }) => ({ key, label, state })),
      sensitive: { unlocked: false, assigned: a.assigned, sections: LOCKED_TRANSITION.map(({ key, label }) => ({ key, label })) } } });
  }
  await logActivity(req, `VIEW_TRANSITION_REVIEW (${a.admin ? 'Admin full access' : 'unlocked'})`, `Child ${row.child_id}`);
  await U.logEvent(req, { recordType: REC, recordId: row.review_id, event: 'view_sections', purpose: a.admin ? 'Admin full access' : a.purpose });
  res.json({ success: true, data: await fullView(req, row, a) });
};

/** Every change: Admin, or the assigned Staff during an unlock. Returns the review row and access. */
async function writable(req) {
  const id = toInt(req.params.id, 'id', { min: 1 });
  const row = await loadRow(id);
  const a = await access(req, row);
  if (!a.assigned) throw new HttpError(403, U.NOT_ASSIGNED, { not_assigned: true });
  if (!a.unlocked) throw new HttpError(403, 'Your unlock has ended. Unlock the review again to save. Your changes are still in the form.', { locked: true });
  return { id, row, a };
}
async function done(req, res, { id, a }, what) {
  await U.logEvent(req, { recordType: REC, recordId: id, event: 'edit_saved', purpose: a.admin ? 'Admin full access' : a.purpose, detail: what });
  const fresh = await loadRow(id);
  res.json({ success: true, data: await fullView(req, fresh, a) });
}

/** PUT /api/transition-reviews/:id - stage 1 details and goals (the status follows the workflow). */
exports.update = async (req, res) => {
  const ctx = await writable(req);
  if (req.body?.review_status && req.body.review_status !== ctx.row.review_status) {
    throw new HttpError(409, 'The status follows the workflow: For Review until the assessment begins, In Progress, and Completed when the case is closed.');
  }
  await W.saveIdentify(req, ctx.id, req.body || {});
  await done(req, res, ctx, 'identify');
};

const stageAction = (fn, what) => async (req, res) => {
  const ctx = await writable(req);
  await fn(req, ctx);
  await done(req, res, ctx, what);
};
exports.beginAssessment = stageAction((req, { id }) => W.beginAssessment(req, id), 'begin assessment');
exports.saveAssessment = stageAction((req, { id }) => W.saveAssessment(req, id, req.body || {}), 'assessment');
exports.saveConference = stageAction((req, { id }) => W.saveConference(req, id, { ...(req.body || {}), conference_id: req.params.cid || null }), 'conference');
exports.saveDecision = stageAction((req, { id }) => W.saveDecision(req, id, req.body || {}), 'decision');
exports.saveTask = stageAction((req, { id }) => W.saveTask(req, id, req.params.taskId ? toInt(req.params.taskId, 'task', { min: 1 }) : null, req.body || {}), 'task');
exports.savePreparation = stageAction((req, { id }) => W.savePreparation(req, id, req.body || {}), 'preparation');
exports.recordDischarge = stageAction((req, { id }) => W.recordDischarge(req, id, req.body || {}), 'discharge');
exports.recordVisit = stageAction((req, { id }) => W.recordVisit(req, id, req.body || {}), 'aftercare');
exports.close = stageAction((req, { id }) => W.closeReview(req, id, req.body || {}), 'closure');

/** POST /api/transition-reviews/:id/documents { stage_key, label, conference_id?, visit_id?, file } - PDF, JPG or PNG, 10 MB. */
exports.uploadDocument = async (req, res) => {
  const ctx = await writable(req);
  const b = req.body || {};
  const stage = TC.STAGES.find((x) => x.key === b.stage_key);
  if (!stage) throw new HttpError(400, 'Choose the stage this document belongs to.');
  W.canWrite(req, ctx.row, stage.key);
  const label = String(b.label || '').trim().slice(0, 150);
  if (!label) throw new HttpError(422, 'Describe the document.', { errors: { label: 'Describe the document.' } });
  const confId = b.conference_id ? toInt(b.conference_id, 'conference', { min: 1 }) : null;
  const visitId = b.visit_id ? toInt(b.visit_id, 'visit', { min: 1 }) : null;
  if (confId) { const [[c]] = await pool.query('SELECT 1 FROM tbl_transition_conferences WHERE conference_id = ? AND review_id = ?', [confId, ctx.id]); if (!c) throw new HttpError(404, 'Conference not found.'); }
  if (visitId) { const [[v]] = await pool.query('SELECT 1 FROM tbl_aftercare_visits v JOIN tbl_aftercare_plans p ON p.aftercare_id = v.aftercare_id WHERE v.visit_id = ? AND p.review_id = ?', [visitId, ctx.id]); if (!v) throw new HttpError(404, 'Follow-up not found.'); }
  const saved = saveUpload(b.file, { folder: 'transition', allowed: ['pdf', 'png', 'jpg'], maxBytes: 10 * MB, label });
  try {
    await require('../config/db').withTransaction(async (conn) => {
      await conn.query(`INSERT INTO tbl_transition_documents (review_id, stage_key, conference_id, visit_id, label, original_name, mime_type, size_bytes, storage_key, sha256, uploaded_by)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [ctx.id, stage.key, confId, visitId, label, saved.original_name, saved.mime_type, saved.size_bytes, saved.storage_key, saved.sha256, req.user.user_id]);
      await W.event(conn, req, ctx.row, stage.key, 'document_uploaded', `Document uploaded (${stage.label})`);
    });
  } catch (err) { deleteUpload(saved.storage_key); throw err; }
  await done(req, res, ctx, 'document uploaded');
};

/** GET /api/transition-reviews/:id/documents/:docId - inline view (Staff copies are watermarked); ?download=1 for Admin. */
exports.viewDocument = async (req, res) => {
  const { id, row, a } = await writable(req);
  const [[doc]] = await pool.query('SELECT * FROM tbl_transition_documents WHERE document_id = ? AND review_id = ?', [toInt(req.params.docId, 'document', { min: 1 }), id]);
  if (!doc) throw new HttpError(404, 'Document not found.');
  const download = req.query.download === '1';
  if (download && req.user.role !== 'Admin') throw new HttpError(403, 'Only an administrator can download transition documents. You can view them here.');
  const intact = verifyUpload(doc.storage_key, doc.sha256);
  let body = readUpload(doc.storage_key);
  let mime = doc.mime_type;
  if (req.user.role === 'Staff') { body = await require('../services/watermark').watermarkFile(body, doc.mime_type, req.user); mime = 'application/pdf'; }
  await logActivity(req, `${download ? 'DOWNLOAD' : 'VIEW'}_TRANSITION_DOCUMENT (${doc.stage_key}${intact === false ? ', integrity check failed' : ''})`, `Child ${row.child_id}`);
  await U.logEvent(req, { recordType: REC, recordId: id, event: download ? 'download_document' : 'view_document', purpose: a.admin ? 'Admin full access' : a.purpose, detail: `document #${doc.document_id}` });
  const name = doc.original_name.replace(/["\r\n]/g, '');
  res.setHeader('Content-Type', mime);
  res.setHeader('Content-Disposition', `${download ? 'attachment' : 'inline'}; filename="${mime === 'application/pdf' && req.user.role === 'Staff' ? name.replace(/\.[^.]+$/, '') + '-watermarked.pdf' : name}"`);
  res.setHeader('Cache-Control', 'no-store');
  res.send(body);
};

/**
 * GET /api/children/:id/transition-summary (Admin, Staff with the Transition duty) - the child profile card.
 * Status, stage, target date and assigned worker for everyone allowed; pathway and aftercare only for Admin
 * or the review's assigned staff.
 */
exports.childSummary = async (req, res) => {
  const [[row]] = await pool.query(`${SELECT} WHERE tr.child_id = ?`, [String(req.params.id)]);
  const [[child]] = await pool.query('SELECT child_id, TIMESTAMPDIFF(YEAR, dob, CURDATE()) AS age FROM tbl_children WHERE child_id = ?', [String(req.params.id)]);
  if (!child) throw new HttpError(404, 'Child record not found.');
  if (!row) return res.json({ success: true, data: { review: null, eligible: Number(child.age) >= 18 } });
  const d = await W.loadAll(pool, row);
  const st = W.stageStates(row, d);
  const cur = st.find((x) => x.state === 'current');
  // Level 3 summary: through the child record policy (Admin, or assigned to the review or the child).
  const mine = req.user.role === 'Admin' || await require('../services/childAccess').isAssigned(req, REC, row.review_id);
  const dec = W.latestDecision(d);
  const onHold = !row.closed_at && dec && !TC.APPROVED.includes(dec.decision);
  res.json({ success: true, data: { eligible: true, review: {
    review_id: row.review_id, review_status: row.review_status, display_status: onHold ? 'On Hold' : row.review_status,
    current_stage: row.closed_at ? 'Closed' : cur?.label || null, target_transition_date: W.ymd(row.target_transition_date),
    next_review_date: onHold ? W.ymd(row.next_review_date) : null, assigned_staff_name: mine && row.assigned_staff_active ? row.assigned_staff_name : null,
    ...(mine ? { pathway: row.proposed_pathway, aftercare_status: d.aftercare ? `${d.aftercare.status}: ${d.visits.filter((v) => v.visit_date).length} of ${d.visits.length} follow-ups recorded` : 'Not started' } : {}),
  } } });
};

/** PUT /api/transition-reviews/:id/assign (Admin) { staff_user_id | null } - shared assignment (services/assignment.js). */
exports.assign = async (req, res) => {
  const id = toInt(req.params.id, 'id', { min: 1 });
  const row = await loadRow(id);
  await require('../services/assignment').assign(req, REC, id, req.body?.staff_user_id, row.child_id);
  const fresh = await loadRow(id);
  res.json({ success: true, data: { ...full(fresh), locked: false, sensitive: { unlocked: true, admin: true } } });
};
