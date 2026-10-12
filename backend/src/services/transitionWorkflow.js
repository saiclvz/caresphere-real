/**
 * Transition Review (18+) workflow: what each stage holds, when it is complete, and the rules that guard
 * every save. Each save runs in one transaction: validate -> save -> version -> timeline event -> audit
 * -> status -> notification. Nothing here deletes a child or a record; history is append-only.
 *
 * Who may do what (existing roles): Admin everything; the review's assigned Staff (with the Transition
 * duty, during an unlock) everything except the decision, the discharge and closing; after closing, only
 * an Admin can change anything (logged as an edit to a closed review).
 */
const { pool, withTransaction } = require('../config/db');
const HttpError = require('../utils/HttpError');
const { encField, decField } = require('../utils/fieldCrypto');
const { logActivityWith } = require('../utils/audit');
const T = require('../config/transitionWorkflow');

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const ymd = (v) => (v ? (v instanceof Date ? `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, '0')}-${String(v.getDate()).padStart(2, '0')}` : String(v).slice(0, 10)) : null);
const addDays = (d, n) => { const x = new Date(`${d}T00:00:00`); x.setDate(x.getDate() + n); return ymd(x); };
const json = (v) => { try { return JSON.parse(decField(v) || '{}'); } catch { return {}; } };
const enc = (o) => encField(JSON.stringify(o));
const text = (v, max = 3000) => { const s = v === undefined || v === null ? '' : String(v).trim(); return s.slice(0, max); };

/** Field errors as one 422 (the page shows each message beside its field). */
function fail(errors, message = 'Some answers need attention.') {
  if (Object.keys(errors).length) throw new HttpError(422, message, { errors });
}
function date(v, label, errors, key, { past = false, future = false, required = true } = {}) {
  const s = text(v, 10);
  if (!s) { if (required) errors[key] = `Enter the ${label}.`; return null; }
  if (!DATE.test(s) || Number.isNaN(new Date(`${s}T00:00:00`).getTime())) { errors[key] = `Enter a valid ${label}.`; return null; }
  if (past && s > today()) errors[key] = `The ${label} can't be in the future.`;
  if (future && s < today()) errors[key] = `The ${label} can't be in the past.`;
  return s;
}

// ---------------------------------------------------------------- reading

async function loadAll(conn, review) {
  const id = review.review_id;
  const q = async (sql, args = [id]) => (await conn.query(sql, args))[0];
  const [assessment] = await q(`SELECT a.*, u.full_name AS updated_by_name FROM tbl_transition_assessments a JOIN tbl_users u ON u.user_id = a.updated_by WHERE a.review_id = ?`);
  const items = assessment ? await q('SELECT item_key, category_key, rating FROM tbl_transition_assessment_items WHERE assessment_id = ?', [assessment.assessment_id]) : [];
  const [voice] = await q(`SELECT v.*, u.full_name AS recorded_by_name FROM tbl_transition_child_voice v JOIN tbl_users u ON u.user_id = v.recorded_by WHERE v.review_id = ?`);
  const conferences = await q(`SELECT c.*, u.full_name AS created_by_name FROM tbl_transition_conferences c JOIN tbl_users u ON u.user_id = c.created_by WHERE c.review_id = ? ORDER BY c.conference_date DESC, c.conference_id DESC`);
  const parts = conferences.length ? await q(`SELECT * FROM tbl_transition_conference_participants WHERE conference_id IN (?) AND superseded_at IS NULL ORDER BY participant_id`, [conferences.map((c) => c.conference_id)]) : [];
  const decisions = await q(`SELECT d.*, u.full_name AS decision_maker_name FROM tbl_transition_decisions d JOIN tbl_users u ON u.user_id = d.decision_maker WHERE d.review_id = ? ORDER BY d.decision_id DESC`);
  const [plan] = await q('SELECT * FROM tbl_transition_plans WHERE review_id = ?');
  const tasks = plan ? await q(`SELECT t.*, a.full_name AS assigned_to_name, u.full_name AS updated_by_name FROM tbl_transition_tasks t
      LEFT JOIN tbl_users a ON a.user_id = t.assigned_to LEFT JOIN tbl_users u ON u.user_id = t.updated_by WHERE t.plan_id = ? ORDER BY t.task_id`, [plan.plan_id]) : [];
  const prep = await q(`SELECT p.*, u.full_name AS done_by_name FROM tbl_transition_preparation p JOIN tbl_users u ON u.user_id = p.done_by WHERE p.review_id = ?`);
  const [discharge] = await q(`SELECT d.*, u.full_name AS recorded_by_name FROM tbl_transition_discharges d JOIN tbl_users u ON u.user_id = d.recorded_by WHERE d.review_id = ?`);
  const [aftercare] = await q('SELECT * FROM tbl_aftercare_plans WHERE review_id = ?');
  const visits = aftercare ? await q(`SELECT v.*, u.full_name AS recorded_by_name FROM tbl_aftercare_visits v LEFT JOIN tbl_users u ON u.user_id = v.recorded_by
      WHERE v.aftercare_id = ? ORDER BY COALESCE(v.scheduled_date, v.visit_date), v.visit_id`, [aftercare.aftercare_id]) : [];
  const documents = await q(`SELECT d.document_id, d.stage_key, d.conference_id, d.visit_id, d.label, d.original_name, d.mime_type, d.size_bytes, d.uploaded_at, u.full_name AS uploaded_by_name
      FROM tbl_transition_documents d JOIN tbl_users u ON u.user_id = d.uploaded_by WHERE d.review_id = ? ORDER BY d.uploaded_at DESC`);
  return {
    assessment: assessment ? {
      overall_readiness: assessment.overall_readiness, completed_at: assessment.completed_at, updated_at: assessment.updated_at, updated_by_name: assessment.updated_by_name,
      ratings: Object.fromEntries(items.map((i) => [i.item_key, i.rating])), notes: json(assessment.category_notes_enc),
    } : null,
    voice: voice ? { answers: json(voice.answers_enc), declined: !!voice.declined, recorded_at: voice.recorded_at, recorded_by_name: voice.recorded_by_name } : null,
    conferences: conferences.map((c) => ({
      conference_id: c.conference_id, status: c.status, conference_date: ymd(c.conference_date), location: c.location, meeting_type: c.meeting_type,
      facilitator: c.facilitator, recommendation: c.recommendation, follow_up_of: c.follow_up_of, created_by_name: c.created_by_name, created_at: c.created_at, ...json(c.data_enc),
      participants: parts.filter((p) => p.conference_id === c.conference_id).map((p) => ({ role: p.role, name: decField(p.name_enc), user_id: p.user_id })),
    })),
    decisions: decisions.map((d) => ({
      decision_id: d.decision_id, pathway: d.pathway, decision: d.decision, decision_date: ymd(d.decision_date), decision_maker_name: d.decision_maker_name,
      conditions: decField(d.conditions_enc), justification: decField(d.justification_enc), next_review_date: ymd(d.next_review_date), created_at: d.created_at,
    })),
    plan: plan ? { plan_id: plan.plan_id, created_at: plan.created_at } : null,
    tasks: tasks.map((t) => ({
      task_id: t.task_id, task_key: t.task_key, name: t.name, description: t.description, assigned_to: t.assigned_to, assigned_to_name: t.assigned_to_name,
      assigned_name: t.assigned_name, due_date: ymd(t.due_date), priority: t.priority, status: t.status, notes: decField(t.notes_enc), updated_by_name: t.updated_by_name, updated_at: t.updated_at,
    })),
    preparation: Object.fromEntries(prep.filter((p) => p.status !== 'Not Done').map((p) => [p.item_key, { status: p.status, note: decField(p.note_enc), done_by_name: p.done_by_name, done_at: p.done_at }])),
    discharge: discharge ? { transition_date: ymd(discharge.transition_date), destination_type: discharge.destination_type, ...json(discharge.data_enc), recorded_by_name: discharge.recorded_by_name, recorded_at: discharge.recorded_at } : null,
    aftercare: aftercare ? { aftercare_id: aftercare.aftercare_id, status: aftercare.status, created_at: aftercare.created_at } : null,
    visits: visits.map((v) => ({
      visit_id: v.visit_id, round: v.round_label, scheduled_date: ymd(v.scheduled_date), visit_date: ymd(v.visit_date), contact_type: v.contact_type,
      recorded_by_name: v.recorded_by_name, recorded_at: v.recorded_at, ...json(v.data_enc),
    })),
    documents,
  };
}

// ---------------------------------------------------------------- state

const latestDecision = (d) => d.decisions[0] || null;
const isApproved = (d) => T.APPROVED.includes(latestDecision(d)?.decision);
const tasksDone = (d) => d.tasks.length > 0 && d.tasks.every((t) => ['Completed', 'Not Applicable'].includes(t.status));
const prepDone = (d) => T.PREPARATION.every(([k]) => d.preparation[k]);
const roundsDone = (d) => T.FOLLOWUPS.every(([r]) => d.visits.some((v) => v.round === r && v.visit_date));
const heldConference = (d) => d.conferences.some((c) => c.status === 'Held' && c.recommendation);

/** What is missing for an assessment to count as complete. */
function assessmentGaps(d) {
  const gaps = [];
  if (!d.assessment) return ['Record the assessment.'];
  const unrated = T.ITEM_KEYS.filter((k) => !d.assessment.ratings[k] || d.assessment.ratings[k] === 'Not Assessed');
  if (unrated.length) gaps.push(`${unrated.length} item${unrated.length === 1 ? '' : 's'} not assessed yet.`);
  if (!d.assessment.overall_readiness) gaps.push('Choose the overall readiness.');
  if (!d.voice) gaps.push("Record the young person's own views (Child's Voice).");
  return gaps;
}

function closureChecklist(review, d) {
  const docTasks = d.tasks.filter((t) => ['ids', 'birth_records'].includes(t.task_key));
  return [
    { key: 'transition', label: 'Transition completed', done: Boolean(d.discharge) },
    { key: 'documents', label: 'Required documents completed', done: docTasks.length > 0 && docTasks.every((t) => ['Completed', 'Not Applicable'].includes(t.status)) && Boolean(d.preparation.documents) },
    { key: 'aftercare', label: 'Aftercare completed', done: roundsDone(d) },
    { key: 'outcome', label: 'Final outcome recorded', done: Boolean(review.final_outcome) },
    { key: 'final_assessment', label: 'Final assessment completed', done: Boolean(review.final_assessment_enc) },
    { key: 'retained', label: 'Records retained', done: Boolean(review.closed_at) },
    { key: 'approved', label: 'Closure approved', done: Boolean(review.closed_at) },
  ];
}

/** The 9 stages: completed / current / pending, what is outstanding, and whether the user may open it. */
function stageStates(review, d) {
  const dec = latestDecision(d);
  const done = {
    identify: Boolean(review.assessment_started_at),
    assessment: Boolean(d.assessment?.completed_at) && Boolean(d.voice),
    conference: heldConference(d),
    decision: isApproved(d),
    plan: isApproved(d) && tasksDone(d),
    preparation: isApproved(d) && prepDone(d),
    discharge: Boolean(d.discharge),
    aftercare: roundsDone(d),
    closure: Boolean(review.closed_at),
  };
  const outstanding = {
    identify: ['Check the details, then Begin assessment.'],
    assessment: assessmentGaps(d).concat(d.assessment && !d.assessment.completed_at && !assessmentGaps(d).length ? ['Save the assessment and continue.'] : []),
    conference: [d.conferences.some((c) => c.status === 'Scheduled') ? 'Record the scheduled conference once it is held.' : 'Record the case conference.'],
    decision: [dec && !T.APPROVED.includes(dec.decision) ? `Latest decision: ${dec.decision}${dec.next_review_date ? `, next review ${dec.next_review_date}` : ''}. Record a new decision after the review.` : 'An administrator records the transition decision.'],
    plan: d.plan ? [`${d.tasks.filter((t) => !['Completed', 'Not Applicable'].includes(t.status)).length} task(s) still open.`] : ['Created automatically when the transition is approved.'],
    preparation: [`${T.PREPARATION.filter(([k]) => !d.preparation[k]).length} checklist item(s) left.`],
    discharge: ['An administrator records the transition / placement after the plan and preparation are complete.'],
    aftercare: T.FOLLOWUPS.filter(([r]) => !d.visits.some((v) => v.round === r && v.visit_date)).map(([r]) => `${r} follow-up not recorded.`),
    closure: closureChecklist(review, d).filter((c) => !c.done && !['retained', 'approved'].includes(c.key)).map((c) => c.label),
  };
  const current = review.closed_at ? -1 : T.STAGES.findIndex((s) => !done[s.key]);
  return T.STAGES.map((s, i) => {
    const state = done[s.key] ? 'completed' : i === current ? 'current' : 'pending';
    return { key: s.key, label: s.label, state, outstanding: state === 'completed' ? [] : outstanding[s.key] || [], deferred: s.key === 'decision' && dec && !T.APPROVED.includes(dec.decision) ? dec.decision : null };
  });
}

/** Statuses: For Review until the assessment begins; In Progress; Completed once closed (or closed before this workflow). */
function deriveStatus(review) {
  if (review.closed_at) return 'Completed';
  if (review.assessment_started_at) return 'In Progress';
  return review.review_status === 'Completed' ? 'Completed' : 'For Review';
}

// ---------------------------------------------------------------- writing helpers

async function lockReview(conn, reviewId) {
  const [[r]] = await conn.query('SELECT * FROM tbl_transition_reviews WHERE review_id = ? FOR UPDATE', [reviewId]);
  if (!r) throw new HttpError(404, 'Transition review not found.');
  return r;
}

/** Who may write this stage. `admin` is Admin; Staff reached here only when assigned and unlocked. */
function canWrite(req, review, stageKey) {
  const isAdmin = req.user.role === 'Admin';
  const def = T.STAGES.find((s) => s.key === stageKey);
  if (review.closed_at && !isAdmin) throw new HttpError(409, 'This review is closed. Only an administrator can change it.');
  if (def?.admin && !isAdmin) throw new HttpError(403, `Only an administrator records the ${def.label.toLowerCase()}.`);
}

async function event(conn, req, review, stageKey, action, summary, from = null, to = null) {
  await conn.query('INSERT INTO tbl_transition_events (review_id, stage_key, action, summary, from_value, to_value, actor_id) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [review.review_id, stageKey, action, String(summary).slice(0, 255), from ? String(from).slice(0, 100) : null, to ? String(to).slice(0, 100) : null, req.user.user_id]);
  // Audit: who, when, what, case number, previous and new value (labels only, never case content).
  const inner = [from || to ? `${from || '-'} -> ${to || '-'}` : null, review.closed_at ? 'edited after closing' : null].filter(Boolean).join(', ');
  await logActivityWith(conn, req, `TRANSITION_${action.toUpperCase()}${inner ? ` (${inner})` : ''}`.slice(0, 255), `Child ${review.child_id}`);
}

async function version(conn, req, review, kind, ref, snapshot) {
  await conn.query('INSERT INTO tbl_transition_record_versions (review_id, record_kind, record_ref, data_enc, saved_by) VALUES (?, ?, ?, ?, ?)',
    [review.review_id, kind, ref, enc(snapshot), req.user.user_id]);
}

/** Recomputes the review status after a change and records it when it changed. */
async function syncStatus(conn, req, reviewId) {
  const [[r]] = await conn.query('SELECT * FROM tbl_transition_reviews WHERE review_id = ?', [reviewId]);
  const next = deriveStatus(r);
  if (next !== r.review_status) {
    await conn.query('UPDATE tbl_transition_reviews SET review_status = ?, updated_by = ? WHERE review_id = ?', [next, req.user.user_id, reviewId]);
    await event(conn, req, r, 'identify', 'status', `Status changed to ${next}`, r.review_status, next);
  } else {
    await conn.query('UPDATE tbl_transition_reviews SET updated_by = ? WHERE review_id = ?', [req.user.user_id, reviewId]);
  }
}

/** Notifies the assigned staff and the admins (reference only: case number and event). */
async function notify(conn, req, review, type, params = {}, groupKey = null) {
  const Notify = require('./notifications');
  const p = { id: review.review_id, ref: review.child_id, ...params };
  if (review.assigned_staff_id && review.assigned_staff_id !== req?.user?.user_id) {
    await Notify.emit(conn, `staff_${type}`, { userId: review.assigned_staff_id, entityType: 'transition_review', entityId: review.review_id, params: p, groupKey: groupKey && `${groupKey}:s` });
  }
  await Notify.toAdmins(conn, `admin_${type}`, { entityType: 'transition_review', entityId: review.review_id, params: p, groupKey, exceptUserId: req?.user?.user_id });
}

async function freshState(conn, reviewId) {
  const [[r]] = await conn.query('SELECT * FROM tbl_transition_reviews WHERE review_id = ?', [reviewId]);
  return { review: r, d: await loadAll(conn, r) };
}

// ---------------------------------------------------------------- stage 1: identify

/** PUT identify { proposed_pathway, target_transition_date, housing_goal, vocational_goal, education_goal, informed_at, informed_by } */
async function saveIdentify(req, reviewId, body = {}) {
  return withTransaction(async (conn) => {
    const r = await lockReview(conn, reviewId);
    canWrite(req, r, 'identify');
    const errors = {};
    const pathway = text(body.proposed_pathway, 60) || null;
    if (pathway && !T.PATHWAYS.includes(pathway)) errors.proposed_pathway = 'Choose a pathway from the list.';
    const target = date(body.target_transition_date, 'target transition date', errors, 'target_transition_date', { required: false });
    const informed = date(body.informed_at, 'date informed', errors, 'informed_at', { required: false, past: true });
    fail(errors);
    await conn.query(
      `UPDATE tbl_transition_reviews SET proposed_pathway = ?, target_transition_date = ?, housing_goal = ?, vocational_goal = ?, education_goal = ?,
              informed_at = ?, informed_by = ?, informed_recorded_by = IF(? IS NULL, informed_recorded_by, ?), updated_by = ? WHERE review_id = ?`,
      [pathway, target, text(body.housing_goal) || null, text(body.vocational_goal) || null, text(body.education_goal) || null,
        informed, text(body.informed_by, 150) || null, informed, req.user.user_id, req.user.user_id, reviewId]);
    if ((r.proposed_pathway || null) !== pathway) await event(conn, req, r, 'identify', 'pathway', 'Proposed pathway changed', r.proposed_pathway, pathway);
    if (ymd(r.target_transition_date) !== target) await event(conn, req, r, 'identify', 'target_date', 'Target transition date changed', ymd(r.target_transition_date), target);
    await event(conn, req, r, 'identify', 'details_saved', 'Review details and goals saved');
    await syncStatus(conn, req, reviewId);
  });
}

/** POST begin-assessment: moves the review to Assessment (status In Progress). */
async function beginAssessment(req, reviewId) {
  return withTransaction(async (conn) => {
    const r = await lockReview(conn, reviewId);
    canWrite(req, r, 'assessment');
    if (r.assessment_started_at) return;
    await conn.query('UPDATE tbl_transition_reviews SET assessment_started_at = NOW() WHERE review_id = ?', [reviewId]);
    await event(conn, req, r, 'assessment', 'assessment_started', 'Assessment begun');
    await syncStatus(conn, req, reviewId);
  });
}

// ---------------------------------------------------------------- stage 2: assessment + child's voice

/**
 * PUT assessment { ratings: {item: rating}, notes: {category: text}, overall_readiness, voice: {answers, declined}, complete }
 * Saving a draft never blocks; `complete: true` requires every item rated, the overall readiness and the
 * young person's views. The score shown on the page is a guide only; it never decides anything.
 */
async function saveAssessment(req, reviewId, body = {}) {
  return withTransaction(async (conn) => {
    const r = await lockReview(conn, reviewId);
    canWrite(req, r, 'assessment');
    if (!r.assessment_started_at) throw new HttpError(409, 'Begin the assessment first (Identify for review).');
    const errors = {};
    const ratings = {};
    for (const k of T.ITEM_KEYS) {
      const v = body.ratings?.[k] || 'Not Assessed';
      if (!T.RATINGS.includes(v)) errors[`rating_${k}`] = 'Choose a rating from the list.'; else ratings[k] = v;
    }
    const notes = Object.fromEntries(T.CATEGORIES.map((c) => [c.key, text(body.notes?.[c.key], 5000)]));
    const overall = text(body.overall_readiness, 40) || null;
    if (overall && !T.OVERALL.includes(overall)) errors.overall_readiness = 'Choose the overall readiness from the list.';
    const declined = Boolean(body.voice?.declined);
    const answers = Object.fromEntries(T.CHILD_VOICE.map(([k]) => [k, text(body.voice?.[k] ?? body.voice?.answers?.[k], 3000)]));
    if (declined) answers.declined_reason = text(body.voice?.declined_reason, 1000);
    const voiceGiven = declined ? Boolean(answers.declined_reason) : Object.values(answers).some(Boolean);
    if (body.complete) {
      T.ITEM_KEYS.filter((k) => ratings[k] === 'Not Assessed').forEach((k) => { errors[`rating_${k}`] = 'Rate this item.'; });
      if (!overall) errors.overall_readiness = 'Choose the overall readiness.';
      if (!voiceGiven) errors.voice = declined ? 'Say why the young person did not give their views.' : "Record at least one of the young person's answers, or that they chose not to answer (with the reason).";
    }
    if (declined && !answers.declined_reason && body.complete) errors.declined_reason = 'Enter the reason.';
    fail(errors, body.complete ? 'The assessment is not complete yet.' : undefined);

    let [[a]] = await conn.query('SELECT * FROM tbl_transition_assessments WHERE review_id = ?', [reviewId]);
    const wasComplete = Boolean(a?.completed_at);
    if (!a) {
      const [ins] = await conn.query('INSERT INTO tbl_transition_assessments (review_id, overall_readiness, category_notes_enc, updated_by) VALUES (?, ?, ?, ?)', [reviewId, overall, enc(notes), req.user.user_id]);
      a = { assessment_id: ins.insertId, overall_readiness: null };
    } else {
      await conn.query('UPDATE tbl_transition_assessments SET overall_readiness = ?, category_notes_enc = ?, updated_by = ? WHERE assessment_id = ?', [overall, enc(notes), req.user.user_id, a.assessment_id]);
    }
    for (const k of T.ITEM_KEYS) {
      await conn.query(`INSERT INTO tbl_transition_assessment_items (assessment_id, category_key, item_key, rating) VALUES (?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE rating = VALUES(rating)`, [a.assessment_id, T.CATEGORY_OF[k], k, ratings[k]]);
    }
    if (voiceGiven || declined) {
      await conn.query(`INSERT INTO tbl_transition_child_voice (review_id, answers_enc, declined, recorded_by) VALUES (?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE answers_enc = VALUES(answers_enc), declined = VALUES(declined), recorded_by = VALUES(recorded_by)`, [reviewId, enc(answers), declined, req.user.user_id]);
    }
    // A completed assessment stays complete when it is edited later only if it is still complete.
    const complete = body.complete || (wasComplete && overall && T.ITEM_KEYS.every((k) => ratings[k] !== 'Not Assessed') && (voiceGiven || declined));
    await conn.query('UPDATE tbl_transition_assessments SET completed_at = IF(?, COALESCE(completed_at, NOW()), NULL) WHERE assessment_id = ?', [complete ? 1 : 0, a.assessment_id]);
    await version(conn, req, r, 'assessment', a.assessment_id, { ratings, notes, overall_readiness: overall, voice: answers, declined });
    await event(conn, req, r, 'assessment', complete && !wasComplete ? 'assessment_completed' : 'assessment_updated',
      complete && !wasComplete ? 'Assessment completed' : 'Assessment updated', a.overall_readiness || null, overall);
    if (voiceGiven || declined) await event(conn, req, r, 'assessment', 'child_voice_recorded', declined ? "Young person chose not to give their views (reason recorded)" : "Young person's views recorded");
    await syncStatus(conn, req, reviewId);
  });
}

// ---------------------------------------------------------------- stage 3: case conference

function cleanParticipants(list, errors) {
  const out = [];
  (Array.isArray(list) ? list : []).slice(0, 30).forEach((p, i) => {
    const role = text(p?.role, 60); const name = text(p?.name, 150);
    if (!role && !name) return;
    if (!T.PARTICIPANT_ROLES.includes(role)) errors[`participant_${i}`] = 'Choose the role.';
    else if (!name) errors[`participant_${i}`] = 'Enter the name.';
    out.push({ role, name, user_id: Number.isInteger(Number(p?.user_id)) && Number(p.user_id) > 0 ? Number(p.user_id) : null });
  });
  return out;
}

/**
 * POST conference { conference_id?, status: Held|Scheduled, conference_date, location, meeting_type, facilitator,
 *   participants: [{role, name}], assessment_summary, strengths, concerns, recommendation, notes, follow_up_of? }
 * "Schedule follow-up" saves a Scheduled conference (future date); it is recorded as Held when it happens.
 */
async function saveConference(req, reviewId, body = {}) {
  return withTransaction(async (conn) => {
    const r = await lockReview(conn, reviewId);
    canWrite(req, r, 'conference');
    const d = await loadAll(conn, r);
    if (!d.assessment?.completed_at) throw new HttpError(409, 'Complete the transition assessment before the case conference.');
    let id = Number(body.conference_id) || null;
    if (id) {
      const [[cur]] = await conn.query('SELECT * FROM tbl_transition_conferences WHERE conference_id = ? AND review_id = ?', [id, reviewId]);
      if (!cur) throw new HttpError(404, 'Conference not found.');
      if (cur.status === 'Held' && req.user.role !== 'Admin') throw new HttpError(409, 'A conference record is kept as held. Add a follow-up conference instead, or ask an administrator.');
    }
    const errors = {};
    const status = body.status === 'Scheduled' ? 'Scheduled' : 'Held';
    const confDate = date(body.conference_date, 'conference date', errors, 'conference_date', status === 'Held' ? { past: true } : { future: true });
    const meeting = text(body.meeting_type, 30) || null;
    if (meeting && !T.MEETING_TYPES.includes(meeting)) errors.meeting_type = 'Choose the meeting type from the list.';
    const participants = cleanParticipants(body.participants, errors);
    const data = { assessment_summary: text(body.assessment_summary, 5000), strengths: text(body.strengths, 5000), concerns: text(body.concerns, 5000), notes: text(body.notes, 10000) };
    let rec = null;
    if (status === 'Held') {
      if (!text(body.facilitator)) errors.facilitator = 'Enter the facilitator.';
      if (participants.length < 2) errors.participants = 'Add everyone who took part (at least two people).';
      if (!participants.some((p) => p.role === 'Young Person') && !text(body.notes)) errors.participants = errors.participants || "Add the young person, or say in the notes why they didn't take part.";
      if (!data.assessment_summary) errors.assessment_summary = 'Summarize the assessment.';
      rec = text(body.recommendation, 60);
      if (!T.RECOMMENDATIONS.includes(rec)) errors.recommendation = 'Choose the recommendation.';
    }
    fail(errors);
    if (id) {
      await conn.query(`UPDATE tbl_transition_conferences SET status = ?, conference_date = ?, location = ?, meeting_type = ?, facilitator = ?, recommendation = ?, data_enc = ? WHERE conference_id = ?`,
        [status, confDate, text(body.location, 150) || null, meeting, text(body.facilitator, 150) || null, rec, enc(data), id]);
      // Participants: the saved list replaces the earlier one; earlier rows are kept, marked as superseded.
      await conn.query('UPDATE tbl_transition_conference_participants SET superseded_at = NOW() WHERE conference_id = ? AND superseded_at IS NULL', [id]);
    } else {
      const followOf = Number(body.follow_up_of) || null;
      const [ins] = await conn.query(`INSERT INTO tbl_transition_conferences (review_id, status, conference_date, location, meeting_type, facilitator, recommendation, data_enc, follow_up_of, created_by)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [reviewId, status, confDate, text(body.location, 150) || null, meeting, text(body.facilitator, 150) || null, rec, enc(data), followOf, req.user.user_id]);
      id = ins.insertId;
    }
    for (const p of participants) {
      await conn.query('INSERT INTO tbl_transition_conference_participants (conference_id, role, name_enc, user_id) VALUES (?, ?, ?, ?)', [id, p.role, encField(p.name), p.user_id]);
    }
    await version(conn, req, r, 'conference', id, { status, conference_date: confDate, participants, recommendation: rec, ...data });
    if (status === 'Scheduled') {
      await event(conn, req, r, 'conference', 'conference_scheduled', `Case conference scheduled for ${confDate}`, null, confDate);
      await notify(conn, req, r, 'transition_conference', { date: confDate }, `tconf:${id}`);
    } else {
      await event(conn, req, r, 'conference', 'conference_recorded', 'Case conference recorded', null, rec);
    }
    await syncStatus(conn, req, reviewId);
    return id;
  });
}

// ---------------------------------------------------------------- stage 4: decision (Admin)

/**
 * POST decision { pathway, decision, decision_date, conditions, justification, next_review_date }
 * Needs a completed assessment and a held conference. Approval creates the transition plan with the
 * standard tasks; Deferred / Continue Residential Care keep the review active with a new review date.
 */
async function saveDecision(req, reviewId, body = {}) {
  return withTransaction(async (conn) => {
    const r = await lockReview(conn, reviewId);
    canWrite(req, r, 'decision');
    const d = await loadAll(conn, r);
    if (!d.assessment?.completed_at || !d.voice) throw new HttpError(409, 'A completed transition assessment (with the young person\'s views) is needed before a decision.');
    if (!heldConference(d)) throw new HttpError(409, 'Record the case conference before the decision.');
    if (d.discharge) throw new HttpError(409, 'The transition has been recorded. The decision can no longer change.');
    const errors = {};
    const pathway = text(body.pathway, 60);
    if (!T.PATHWAYS.includes(pathway)) errors.pathway = 'Choose the pathway.';
    const decision = text(body.decision, 40);
    if (!T.DECISIONS.includes(decision)) errors.decision = 'Choose the decision.';
    const dDate = date(body.decision_date, 'decision date', errors, 'decision_date', { past: true });
    const justification = text(body.justification, 5000);
    if (justification.length < 10) errors.justification = 'Give the reason or justification (at least 10 characters).';
    const conditions = text(body.conditions, 5000);
    if (decision === 'Approved with Conditions' && !conditions) errors.conditions = 'List the conditions.';
    let next = null;
    if (['Deferred', 'Continue Residential Care'].includes(decision)) next = date(body.next_review_date, 'next review date', errors, 'next_review_date', { future: true });
    if (pathway === 'Continue Residential Care' && T.APPROVED.includes(decision)) errors.decision = 'For Continue Residential Care, choose the decision "Continue Residential Care" (the review stays active).';
    fail(errors);
    const prev = latestDecision(d);
    const [ins] = await conn.query(`INSERT INTO tbl_transition_decisions (review_id, pathway, decision, decision_date, decision_maker, conditions_enc, justification_enc, next_review_date)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, [reviewId, pathway, decision, dDate, req.user.user_id, conditions ? encField(conditions) : null, encField(justification), next]);
    await conn.query('UPDATE tbl_transition_reviews SET proposed_pathway = ?, next_review_date = ? WHERE review_id = ?', [pathway, next, reviewId]);
    await event(conn, req, r, 'decision', T.APPROVED.includes(decision) ? 'decision_approved' : 'decision_recorded', `Transition decision: ${decision} (${pathway})`, prev?.decision || null, decision);
    if (T.APPROVED.includes(decision) && !d.plan) {
      const [p] = await conn.query('INSERT INTO tbl_transition_plans (review_id, decision_id, created_by) VALUES (?, ?, ?)', [reviewId, ins.insertId, req.user.user_id]);
      for (const [key, name, desc, priority] of T.STANDARD_TASKS) {
        await conn.query('INSERT INTO tbl_transition_tasks (plan_id, task_key, name, description, priority, assigned_to) VALUES (?, ?, ?, ?, ?, ?)',
          [p.insertId, key, name, desc, priority, r.assigned_staff_id || null]);
      }
      await event(conn, req, r, 'plan', 'plan_created', `Transition plan created with ${T.STANDARD_TASKS.length} tasks`);
    }
    await notify(conn, req, r, 'transition_decision', { decision }, null);
    await syncStatus(conn, req, reviewId);
  });
}

// ---------------------------------------------------------------- stage 5: plan tasks

function cleanTask(body, errors, { custom }) {
  const out = {};
  if (custom) {
    out.name = text(body.name, 150);
    if (!out.name) errors.name = 'Enter the task name.';
    out.description = text(body.description, 500) || null;
  }
  out.status = text(body.status, 20) || 'Pending';
  if (!T.TASK_STATUSES.includes(out.status)) errors.status = 'Choose the status.';
  out.priority = text(body.priority, 10) || 'Medium';
  if (!T.PRIORITIES.includes(out.priority)) errors.priority = 'Choose the priority.';
  out.due_date = date(body.due_date, 'due date', errors, 'due_date', { required: false });
  out.assigned_to = Number(body.assigned_to) > 0 ? Number(body.assigned_to) : null;
  out.assigned_name = out.assigned_to ? null : (text(body.assigned_name, 150) || null);
  out.notes = text(body.notes, 3000);
  if (out.status === 'Not Applicable' && !out.notes) errors.notes = 'Say why this task is not applicable.';
  return out;
}

async function assigneeCheck(conn, id, errors) {
  if (!id) return;
  const [[u]] = await conn.query("SELECT u.user_id FROM tbl_users u JOIN tbl_roles r ON r.role_id = u.role_id WHERE u.user_id = ? AND u.is_active = TRUE AND r.role_name IN ('Admin', 'Staff')", [id]);
  if (!u) errors.assigned_to = 'Choose an active staff member.';
}

/** POST tasks { name, description, ... } (custom task) / PUT tasks/:taskId { status, priority, due_date, assigned_to, assigned_name, notes } */
async function saveTask(req, reviewId, taskId, body = {}) {
  return withTransaction(async (conn) => {
    const r = await lockReview(conn, reviewId);
    canWrite(req, r, 'plan');
    const [[plan]] = await conn.query('SELECT * FROM tbl_transition_plans WHERE review_id = ?', [reviewId]);
    if (!plan) throw new HttpError(409, 'The transition plan is created when the transition is approved.');
    const errors = {};
    const t = cleanTask(body, errors, { custom: !taskId });
    await assigneeCheck(conn, t.assigned_to, errors);
    fail(errors);
    if (!taskId) {
      const [ins] = await conn.query(`INSERT INTO tbl_transition_tasks (plan_id, name, description, assigned_to, assigned_name, due_date, priority, status, notes_enc, updated_by)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [plan.plan_id, t.name, t.description, t.assigned_to, t.assigned_name, t.due_date, t.priority, t.status, encField(t.notes), req.user.user_id]);
      await event(conn, req, r, 'plan', 'task_added', `Task added: ${t.name.slice(0, 80)}`, null, t.status);
      await syncStatus(conn, req, reviewId);
      return ins.insertId;
    }
    const [[cur]] = await conn.query('SELECT * FROM tbl_transition_tasks WHERE task_id = ? AND plan_id = ?', [taskId, plan.plan_id]);
    if (!cur) throw new HttpError(404, 'Task not found.');
    await conn.query(`UPDATE tbl_transition_tasks SET assigned_to = ?, assigned_name = ?, due_date = ?, priority = ?, status = ?, notes_enc = ?, updated_by = ? WHERE task_id = ?`,
      [t.assigned_to, t.assigned_name, t.due_date, t.priority, t.status, encField(t.notes), req.user.user_id, taskId]);
    await version(conn, req, r, 'task', taskId, { ...t, name: cur.name });
    if (cur.status !== t.status) {
      await event(conn, req, r, 'plan', t.status === 'Completed' ? 'task_completed' : 'task_status', `Task "${cur.name.slice(0, 80)}": ${t.status}`, cur.status, t.status);
    } else await event(conn, req, r, 'plan', 'task_updated', `Task "${cur.name.slice(0, 80)}" updated`);
    await syncStatus(conn, req, reviewId);
    return taskId;
  });
}

// ---------------------------------------------------------------- stage 6: preparation

/** PUT preparation { item_key, status: Done | Not Applicable | '' (undo), note } */
async function savePreparation(req, reviewId, body = {}) {
  return withTransaction(async (conn) => {
    const r = await lockReview(conn, reviewId);
    canWrite(req, r, 'preparation');
    const d = await loadAll(conn, r);
    if (!isApproved(d)) throw new HttpError(409, 'Preparation starts after the transition is approved.');
    if (d.discharge && req.user.role !== 'Admin') throw new HttpError(409, 'The transition has been recorded. The checklist is kept as it was.');
    const item = T.PREPARATION.find(([k]) => k === body.item_key);
    if (!item) throw new HttpError(400, 'Choose a checklist item.');
    const status = text(body.status, 20);
    const note = text(body.note, 1000);
    const errors = {};
    if (status && !['Done', 'Not Applicable'].includes(status)) errors.status = 'Choose Done or Not applicable.';
    if (status === 'Not Applicable' && !note) errors.note = 'Say why this item does not apply.';
    fail(errors);
    const prev = d.preparation[item[0]]?.status || 'Not done';
    // Undo keeps the row (status Not Done); the previous state is in the record history and the timeline.
    await version(conn, req, r, 'preparation', null, { item: item[0], from: prev, to: status || 'Not Done', note });
    await conn.query(`INSERT INTO tbl_transition_preparation (review_id, item_key, status, note_enc, done_by) VALUES (?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE status = VALUES(status), note_enc = VALUES(note_enc), done_by = VALUES(done_by)`, [reviewId, item[0], status || 'Not Done', note ? encField(note) : null, req.user.user_id]);
    await event(conn, req, r, 'preparation', 'preparation_item', `${item[1]}: ${status || 'Not done'}`, prev, status || 'Not done');
    await syncStatus(conn, req, reviewId);
  });
}

// ---------------------------------------------------------------- stage 7: discharge / placement (Admin)

/**
 * POST discharge { transition_date, destination_type, destination_name, destination_address, receiving, contact,
 *   reason, notes, confirm }
 * Needs the approved decision, every plan task done or not applicable, and the whole preparation checklist.
 * The child is NOT deleted: their status becomes Discharged with a discharge-history entry (as for any
 * discharge), and the aftercare plan with the four follow-ups is created.
 */
async function recordDischarge(req, reviewId, body = {}) {
  return withTransaction(async (conn) => {
    const r = await lockReview(conn, reviewId);
    canWrite(req, r, 'discharge');
    const d = await loadAll(conn, r);
    if (d.discharge) throw new HttpError(409, 'The transition has already been recorded.');
    const dec = latestDecision(d);
    if (!T.APPROVED.includes(dec?.decision)) throw new HttpError(409, 'An approved transition decision is needed first.');
    if (!tasksDone(d)) throw new HttpError(409, 'Complete every transition plan task (or mark it not applicable) first.');
    if (!prepDone(d)) throw new HttpError(409, `Complete the pre-transition checklist first (${T.PREPARATION.filter(([k]) => !d.preparation[k]).length} item(s) left).`);
    const [[child]] = await conn.query('SELECT child_id, status FROM tbl_children WHERE child_id = ? FOR UPDATE', [r.child_id]);
    if (child.status !== 'Active') throw new HttpError(409, `The child's record is already ${child.status}. Ask an administrator to check the child's record first.`);
    const errors = {};
    const tDate = date(body.transition_date, 'transition date', errors, 'transition_date', { past: true });
    if (tDate && dec.decision_date && tDate < dec.decision_date) errors.transition_date = 'The transition date is before the decision date.';
    const dest = text(body.destination_type, 40);
    if (!T.DESTINATIONS.includes(dest)) errors.destination_type = 'Choose the destination type.';
    const data = {
      destination_name: text(body.destination_name, 200), destination_address: text(body.destination_address, 500), receiving: text(body.receiving, 200),
      contact: text(body.contact, 200), reason: text(body.reason, 3000), notes: text(body.notes, 10000),
    };
    if (!data.destination_name) errors.destination_name = 'Enter the destination name.';
    if (!data.destination_address) errors.destination_address = 'Enter the destination address.';
    if (!data.receiving) errors.receiving = 'Enter the receiving person or organization.';
    if (!data.contact) errors.contact = 'Enter the contact information.';
    if (data.reason.length < 10) errors.reason = 'Give the reason for the transition (at least 10 characters).';
    if (body.confirm !== true) errors.confirm = 'Confirm that the transition / placement details have been reviewed.';
    fail(errors);
    // The existing discharge history (the same record any discharge writes).
    const [h] = await conn.query(`INSERT INTO tbl_child_discharge_history (child_id, discharge_reason, report_of_what_happened, discharge_date, reported_by, previous_status)
      VALUES (?, ?, ?, ?, ?, ?)`, [r.child_id, `Transition (18+): ${dest}. ${data.reason}`, data.notes || `Transition recorded in Transition Review (${dec.pathway}).`, tDate, req.user.user_id, child.status]);
    await conn.query("UPDATE tbl_children SET status = 'Discharged', available_for_adoption = 0 WHERE child_id = ?", [r.child_id]);
    await conn.query('INSERT INTO tbl_transition_discharges (review_id, transition_date, destination_type, data_enc, discharge_history_id, recorded_by) VALUES (?, ?, ?, ?, ?, ?)',
      [reviewId, tDate, dest, enc(data), h.insertId, req.user.user_id]);
    const [a] = await conn.query('INSERT INTO tbl_aftercare_plans (review_id, created_by) VALUES (?, ?)', [reviewId, req.user.user_id]);
    for (const [round, days] of T.FOLLOWUPS) await conn.query('INSERT INTO tbl_aftercare_visits (aftercare_id, round_label, scheduled_date) VALUES (?, ?, ?)', [a.insertId, round, addDays(tDate, days)]);
    await event(conn, req, r, 'discharge', 'placement_recorded', `Transition recorded: ${dest}`, 'Residential care', dest);
    await event(conn, req, r, 'aftercare', 'aftercare_created', 'Aftercare plan created (week 1, month 1, month 3, month 6)');
    await logActivityWith(conn, req, `DISCHARGE_CHILD (transition review, ${child.status} -> Discharged)`, `Child ${r.child_id}`);
    await notify(conn, req, r, 'transition_placement', {}, null);
    await syncStatus(conn, req, reviewId);
  });
}

// ---------------------------------------------------------------- stage 8: aftercare

/** POST aftercare { visit_id? (a scheduled follow-up) | round: 'Custom', visit_date, contact_type, ...VISIT_FIELDS } */
async function recordVisit(req, reviewId, body = {}) {
  return withTransaction(async (conn) => {
    const r = await lockReview(conn, reviewId);
    canWrite(req, r, 'aftercare');
    const [[plan]] = await conn.query('SELECT * FROM tbl_aftercare_plans WHERE review_id = ?', [reviewId]);
    if (!plan) throw new HttpError(409, 'Aftercare starts when the transition is recorded.');
    const errors = {};
    const vDate = date(body.visit_date, 'follow-up date', errors, 'visit_date', { past: true });
    const contact = text(body.contact_type, 30);
    if (!T.CONTACT_TYPES.includes(contact)) errors.contact_type = 'Choose the contact type.';
    const data = Object.fromEntries(T.VISIT_FIELDS.map(([k]) => [k, text(body[k], 3000)]));
    if (!data.person_contacted) errors.person_contacted = 'Enter who was contacted.';
    if (!data.progress) errors.progress = 'Describe the progress.';
    if (!data.next_steps) errors.next_steps = 'Enter the next steps.';
    fail(errors);
    let id = Number(body.visit_id) || null;
    let round = 'Custom';
    if (id) {
      const [[v]] = await conn.query('SELECT * FROM tbl_aftercare_visits WHERE visit_id = ? AND aftercare_id = ? FOR UPDATE', [id, plan.aftercare_id]);
      if (!v) throw new HttpError(404, 'Follow-up not found.');
      if (v.visit_date && req.user.role !== 'Admin') throw new HttpError(409, 'This follow-up is already recorded. Add another follow-up instead.');
      round = v.round_label;
      await conn.query('UPDATE tbl_aftercare_visits SET visit_date = ?, contact_type = ?, data_enc = ?, recorded_by = ?, recorded_at = NOW() WHERE visit_id = ?', [vDate, contact, enc(data), req.user.user_id, id]);
    } else {
      const [ins] = await conn.query(`INSERT INTO tbl_aftercare_visits (aftercare_id, round_label, visit_date, contact_type, data_enc, recorded_by, recorded_at) VALUES (?, 'Custom', ?, ?, ?, ?, NOW())`,
        [plan.aftercare_id, vDate, contact, enc(data), req.user.user_id]);
      id = ins.insertId;
    }
    await version(conn, req, r, 'aftercare_visit', id, { round, visit_date: vDate, contact_type: contact, ...data });
    await event(conn, req, r, 'aftercare', 'aftercare_visit', `Aftercare follow-up recorded (${round}, ${contact})`, null, round);
    const d = await loadAll(conn, r);
    if (roundsDone(d)) await notify(conn, { user: req.user }, r, 'transition_ready_close', {}, `tclose:${reviewId}`);
    await syncStatus(conn, req, reviewId);
    return id;
  });
}

// ---------------------------------------------------------------- stage 9: closure (Admin)

/** POST close { final_outcome, final_assessment, closure_date, closure_notes, retained: true, approved: true } */
async function closeReview(req, reviewId, body = {}) {
  return withTransaction(async (conn) => {
    const r = await lockReview(conn, reviewId);
    canWrite(req, r, 'closure');
    if (r.closed_at) throw new HttpError(409, 'This review is already closed.');
    const d = await loadAll(conn, r);
    const errors = {};
    const outcome = text(body.final_outcome, 80);
    if (!T.OUTCOMES.includes(outcome)) errors.final_outcome = 'Choose the final outcome.';
    const finalAssessment = text(body.final_assessment, 5000);
    if (finalAssessment.length < 10) errors.final_assessment = 'Record the final assessment (at least 10 characters).';
    const cDate = date(body.closure_date, 'closure date', errors, 'closure_date', { past: true });
    if (body.retained !== true) errors.retained = 'Confirm the records are retained.';
    if (body.approved !== true) errors.approved = 'Confirm the closure is approved.';
    fail(errors);
    const pending = closureChecklist({ ...r, final_outcome: outcome, final_assessment_enc: finalAssessment, closed_at: 'now' }, d).filter((c) => !c.done);
    if (pending.length) throw new HttpError(409, `The review can't be closed yet: ${pending.map((p) => p.label.toLowerCase()).join(', ')}.`);
    await conn.query(`UPDATE tbl_transition_reviews SET final_outcome = ?, final_assessment_enc = ?, closure_date = ?, closure_notes_enc = ?, closed_at = NOW(), closed_by = ? WHERE review_id = ?`,
      [outcome, encField(finalAssessment), cDate, encField(text(body.closure_notes, 5000)), req.user.user_id, reviewId]);
    await conn.query("UPDATE tbl_aftercare_plans SET status = 'Completed' WHERE review_id = ?", [reviewId]);
    await event(conn, req, r, 'closure', 'case_closed', `Transition case closed: ${outcome}`, 'In Progress', 'Completed');
    await syncStatus(conn, req, reviewId);
  });
}

// ---------------------------------------------------------------- reminders (every 6 hours with the 18+ flag)

/**
 * Time-based notifications, each sent once (group keys): assessment overdue, task due soon, plan incomplete or
 * transition date approaching, aftercare follow-up due / overdue. Reference numbers only.
 */
async function sweepReminders() {
  const R = T.REMIND;
  const sys = { user: { user_id: null } };
  await withTransaction(async (conn) => {
    const [open] = await conn.query('SELECT * FROM tbl_transition_reviews WHERE closed_at IS NULL');
    for (const r of open) {
      if (r.review_status === 'For Review' && !r.assessment_started_at && new Date(r.flagged_at) < new Date(Date.now() - R.assessmentOverdueDays * 864e5)) {
        await notify(conn, sys, r, 'transition_assessment_overdue', {}, `tassess:${r.review_id}`);
      }
      const d = await loadAll(conn, r);
      for (const t of d.tasks) {
        if (t.due_date && !['Completed', 'Not Applicable'].includes(t.status) && t.due_date <= addDays(today(), R.taskDueSoonDays)) {
          const Notify = require('./notifications');
          const to = t.assigned_to || r.assigned_staff_id;
          const [[u]] = to ? await conn.query('SELECT r.role_name FROM tbl_users u JOIN tbl_roles r ON r.role_id = u.role_id WHERE u.user_id = ?', [to]) : [[null]];
          if (to && u) await Notify.emit(conn, u.role_name === 'Admin' ? 'admin_transition_task_due' : 'staff_transition_task_due', { userId: to, entityType: 'transition_review', entityId: r.review_id, params: { id: r.review_id, ref: r.child_id, due: t.due_date }, groupKey: `ttask:${t.task_id}:${t.due_date}` });
        }
      }
      const target = ymd(r.target_transition_date);
      if (target && !d.discharge) {
        if (target <= addDays(today(), R.dischargeSoonDays)) await notify(conn, sys, r, 'transition_date_soon', { date: target }, `tdate:${r.review_id}:${target}`);
        if (d.plan && !tasksDone(d) && target <= addDays(today(), R.planIncompleteDays)) await notify(conn, sys, r, 'transition_plan_incomplete', { date: target }, `tplan:${r.review_id}:${target}`);
      }
      for (const v of d.visits.filter((x) => !x.visit_date && x.scheduled_date)) {
        if (v.scheduled_date < today()) await notify(conn, sys, r, 'aftercare_overdue', { round: v.round }, `tafter_late:${v.visit_id}`);
        else if (v.scheduled_date <= addDays(today(), R.followUpDueDays)) await notify(conn, sys, r, 'aftercare_due', { round: v.round, date: v.scheduled_date }, `tafter_due:${v.visit_id}`);
      }
    }
  });
}

module.exports = {
  loadAll, stageStates, closureChecklist, deriveStatus, assessmentGaps, latestDecision, isApproved,
  saveIdentify, beginAssessment, saveAssessment, saveConference, saveDecision, saveTask, savePreparation, recordDischarge, recordVisit, closeReview,
  sweepReminders, freshState, canWrite, event, today, ymd,
};
