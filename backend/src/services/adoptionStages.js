/**
 * The adoption case in 17 stages (config/adoptionStages.js): each stage's state (Completed, Current,
 * Blocked, Pending, or Not part of this category), its record and repeated entries, Save and Proceed.
 *
 * Every action: Save -> Validate -> Audit -> Timeline -> Status -> Notify. Proceed records the stage's
 * status through the same workflow and gate as Update status (services/adoptionWorkflow.js), so nothing
 * can be bypassed from here. The child is always the existing child record (tbl_children); nothing here
 * creates or copies a child.
 */
const { pool, withTransaction } = require('../config/db');
const HttpError = require('../utils/HttpError');
const Adoption = require('../models/adoptionModel');
const WF = require('../config/adoptionWorkflow');
const ST = require('../config/adoptionStages');
const { encField, decField } = require('../utils/fieldCrypto');
const { logActivityWith } = require('../utils/audit');
const Notify = require('./notifications');

const byKey = Object.fromEntries(ST.STAGES.map((s) => [s.key, s]));
const str = (v) => (v === undefined || v === null ? '' : String(v).trim());
const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const validDate = (v) => /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(new Date(`${v}T00:00:00Z`).getTime()) && new Date(`${v}T00:00:00Z`).toISOString().slice(0, 10) === v;
const dec = (v) => { if (!v) return null; try { return JSON.parse(decField(v)); } catch { return null; } };
const appliesTo = (stage, app) => !stage.tracks || stage.tracks.includes(WF.trackOf(app.application_type));

// ---------------------------------------------------------------- validation (one rule set for every form)

/** Validates answers against a field list. Returns { data, errors }; unknown keys are dropped. */
function validate(fields, input) {
  const data = {}; const errors = {};
  const src = input && typeof input === 'object' ? input : {};
  for (const f of fields) {
    if (!f.key) continue;
    let v = str(src[f.key]);
    const req = f.required || (f.requiredWhen && f.requiredWhen.in.includes(str(src[f.requiredWhen.field])));
    if (!v) { if (req) errors[f.key] = `${f.label} is required.`; continue; }
    switch (f.type) {
      case 'date':
        if (!validDate(v)) { errors[f.key] = `Enter a valid ${f.label.toLowerCase()}.`; continue; }
        if (f.past && v > today()) { errors[f.key] = `${f.label} cannot be in the future.`; continue; }
        break;
      case 'select': if (!f.options.includes(v)) { errors[f.key] = `Choose ${f.label.toLowerCase()} from the list.`; continue; } break;
      case 'yesno': if (!['Yes', 'No'].includes(v)) { errors[f.key] = `Answer Yes or No: ${f.label}.`; continue; } break;
      case 'number': if (!/^\d{1,6}$/.test(v)) { errors[f.key] = `${f.label} must be a whole number.`; continue; } break;
      default:
        if (f.max && v.length > f.max) { errors[f.key] = `${f.label} can be up to ${f.max} characters.`; continue; }
        if (f.min && v.length < f.min) { errors[f.key] = `${f.label} needs at least ${f.min} characters.`; continue; }
    }
    if (f.must && v !== f.must) { errors[f.key] = `${f.label}: must be "${f.must}" to save.`; continue; }
    data[f.key] = v;
  }
  return { data, errors };
}
const resultOf = (stageKey, data) => data.result || data.recommendation || data.decision || data.reg_status || data.eligibility_status || null;

// ---------------------------------------------------------------- loading

async function records(conn, applicationId) {
  const [rows] = await conn.query(
    `SELECT r.stage_key, r.data_enc, r.result, r.updated_at, u.full_name AS updated_by_name, ro.role_name AS updated_by_role
       FROM tbl_adoption_stage_records r JOIN tbl_users u ON u.user_id = r.updated_by LEFT JOIN tbl_roles ro ON ro.role_id = u.role_id
      WHERE r.application_id = ?`, [applicationId]).catch(() => [[]]);
  return Object.fromEntries(rows.map((r) => [r.stage_key, { data: dec(r.data_enc) || {}, result: r.result, updated_at: r.updated_at, updated_by_name: r.updated_by_name, updated_by_role: r.updated_by_role }]));
}
async function entries(conn, applicationId) {
  const [rows] = await conn.query(
    `SELECT e.entry_id, e.stage_key, e.kind, e.round_label, e.entry_date, e.data_enc, e.created_at, u.full_name AS created_by_name
       FROM tbl_adoption_stage_entries e JOIN tbl_users u ON u.user_id = e.created_by WHERE e.application_id = ? ORDER BY e.entry_date, e.entry_id`, [applicationId]).catch(() => [[]]);
  return rows.map((r) => ({ entry_id: r.entry_id, stage_key: r.stage_key, kind: r.kind, round: r.round_label, date: String(r.entry_date instanceof Date ? r.entry_date.toISOString() : r.entry_date).slice(0, 10),
    data: dec(r.data_enc) || {}, created_at: r.created_at, created_by_name: r.created_by_name }));
}
/** The existing child this case is about: the matched child, else the chosen child (Regular) or the linked child. */
const caseChildId = (app) => app.matched_child_id || app.target_child_id || app.link_child_id || null;

async function eligibility(conn, childId) {
  if (!childId) return null;
  const [[r]] = await conn.query(
    `SELECT e.status, e.data_enc, e.updated_at, u.full_name AS updated_by_name FROM tbl_child_adoption_eligibility e
       JOIN tbl_users u ON u.user_id = e.updated_by WHERE e.child_id = ?`, [childId]).catch(() => [[null]]);
  return r ? { status: r.status, data: dec(r.data_enc) || {}, updated_at: r.updated_at, updated_by_name: r.updated_by_name } : null;
}

/** The existing child's profile, read from Children Management (never copied). */
async function childSummary(conn, childId) {
  if (!childId) return null;
  const [[c]] = await conn.query(
    `SELECT child_id, full_name, sex, dob, TIMESTAMPDIFF(YEAR, dob, CURDATE()) AS age, status, available_for_adoption, placement_status,
            cdclaa_number, cdclaa_verified_at, special_needs, sibling_group_size, needs_own_room
       FROM tbl_children WHERE child_id = ?`, [childId]).catch(() => [[null]]);
  if (!c) return null;
  return { ...c, dob: c.dob ? String(c.dob instanceof Date ? c.dob.toISOString() : c.dob).slice(0, 10) : null, available_for_adoption: !!c.available_for_adoption, cdclaa_verified: !!c.cdclaa_verified_at };
}

// ---------------------------------------------------------------- states

/** Closing a case: every item must be true. */
function closureChecklist(app, recs, ents, docsComplete) {
  return [
    { key: 'order', label: 'Order of Adoption recorded', done: Boolean(recs.order && app.order_number) },
    { key: 'finality', label: 'Certificate of Finality recorded', done: Boolean(recs.finality) },
    { key: 'registration', label: 'Civil registration completed', done: Boolean(recs.registration && recs.registration.result === 'Registered' && ['Civil registry updated', 'Closed'].includes(app.status)) },
    { key: 'documents', label: 'Required documents filed and verified', done: Boolean(docsComplete) },
    { key: 'monitoring', label: 'Post-adoption monitoring completed', done: ents.some((e) => e.stage_key === 'monitoring' && e.round === 'Final monitoring') },
    { key: 'blocking', label: 'No unresolved blocking requirements', done: Boolean(docsComplete) },
  ];
}

/**
 * Builds the stepper. ctx = { app, recs, ents, docs (documents summary), elig, pagesComplete }.
 * Each stage: state completed | current | blocked | pending | skipped, and `outstanding` (what is left).
 */
function stageStates(ctx) {
  const { app, recs, ents, docs, elig, pagesComplete } = ctx;
  const has = (k) => Boolean(recs[k]);
  const ended = ['Declined', 'Withdrawn'].includes(app.status);
  const done = {
    inquiry: app.status !== 'Submitted',
    forum: Boolean(app.forum_verified_at),
    pap: has('pap') && pagesComplete,
    documents: Boolean(docs?.complete),
    assessment: Boolean(app.cleared_at),
    eligibility: Boolean(elig && ST.ELIGIBLE.includes(elig.status)),
    link: Boolean(app.link_verified_at),
    matching: Boolean(app.matched_child_id && app.matched_at),
    placement: Boolean(app.trial_completed_at),
    petition: Boolean(app.appearance_date),
    racco: Boolean(recs.racco?.result === 'Recommended for NACC decision' && app.endorsed_date),
    nacc: recs.nacc?.result === 'Approved',
    order: Boolean(recs.order && app.order_number && app.finalized_at),
    finality: has('finality'),
    identity: has('identity'),
    registration: Boolean(recs.registration && ['Civil registry updated', 'Closed'].includes(app.status)),
    monitoring: ents.some((e) => e.stage_key === 'monitoring' && e.round === 'Final monitoring'),
    closure: app.status === 'Closed',
  };
  const outstanding = {
    inquiry: ['Review the application and assign staff.'],
    forum: [!has('forum') && 'Record the forum details.', 'Upload the forum certificate, then record Forum attended.'].filter(Boolean),
    pap: [!has('pap') && 'Record the motivation and family support, and confirm consent.', !pagesComplete && 'Some application answers or uploads are missing (Applicant tab).'].filter(Boolean),
    documents: (docs?.blocking || []).map((b) => `${b.label} (${b.status})`),
    assessment: [!has('assessment') && 'Record the assessment and home study.', has('assessment') && !['Recommended', 'Recommended with conditions'].includes(recs.assessment.result) && `Result is "${recs.assessment.result}".`,
      !app.case_study_completed_at && 'Upload the Social Case Study Report and record Case study completed.', !app.cleared_at && 'An administrator clears the applicant for matching.'].filter(Boolean),
    eligibility: [!caseChildId(app) && 'Choose the existing child this case is for.', caseChildId(app) && !elig && "Record the child's eligibility.", elig && !ST.ELIGIBLE.includes(elig.status) && `The child is "${elig.status}".`].filter(Boolean),
    link: ['Verify the child and the relationship (Matching and placement).'],
    matching: ['Propose, review and approve the match (Matching and placement).'],
    placement: [!has('placement') && 'Record the placement.', "Record NACC's confirmation of the match, then Trial custody.", 'Complete the 6-month trial custody.'].filter(Boolean),
    petition: [!has('petition') && 'Record the petition.', !app.petition_date && 'Record Petition filed.', !app.published_at && 'Upload the proof of publication and record Published.', !app.appearance_date && 'Record the mandatory appearance.'].filter(Boolean),
    racco: [!has('racco') && "Record the case package checklist and RACCO's recommendation.", has('racco') && recs.racco.result !== 'Recommended for NACC decision' && `RACCO: "${recs.racco.result}".`, !app.endorsed_date && 'Record the endorsement to the NACC.'].filter(Boolean),
    nacc: [!has('nacc') && "Record the NACC's decision.", has('nacc') && recs.nacc.result !== 'Approved' && `NACC: "${recs.nacc.result}".`].filter(Boolean),
    order: [!has('order') && 'Record the Order of Adoption.', !app.finalized_at && 'Upload the Order and record it.'].filter(Boolean),
    finality: ['Upload and record the Certificate of Finality.'],
    identity: ["Record the child's name under the Order."],
    registration: [!has('registration') && 'Record the civil registration.', !['Civil registry updated', 'Closed'].includes(app.status) && 'Record Civil registry updated.'].filter(Boolean),
    monitoring: ['Follow-up 1', 'Follow-up 2', 'Follow-up 3', 'Final monitoring'].filter((r) => !ents.some((e) => e.stage_key === 'monitoring' && e.round === r)).map((r) => `${r} not recorded.`),
    closure: closureChecklist(app, recs, ents, docs?.complete).filter((c) => !c.done).map((c) => c.label),
  };
  const list = ST.STAGES.map((s) => ({ s, applies: appliesTo(s, app) }));
  const currentIdx = ended || app.status === 'Closed' ? -1 : list.findIndex(({ s, applies }) => applies && !done[s.key]);
  let blockedNext = false;
  return list.map(({ s, applies }, i) => {
    let state;
    if (!applies) state = 'skipped';
    else if (done[s.key]) state = 'completed';
    else if (i === currentIdx) state = 'current';
    else if (i > currentIdx && currentIdx !== -1 && !blockedNext) { state = 'blocked'; blockedNext = true; }
    else state = 'pending';
    return {
      key: s.key, label: s.label, short: s.short, state, applies,
      outstanding: state === 'completed' || state === 'skipped' ? [] : outstanding[s.key] || [],
      blocked_by: state === 'blocked' ? list[currentIdx].s.label : null,
      blocked_count: state === 'blocked' ? (outstanding[list[currentIdx].s.key] || []).length : 0,
    };
  });
}

/** Everything the stage panel needs for one case. */
async function caseStages(conn, app, { docs, pagesComplete }) {
  const [recs, ents] = await Promise.all([records(conn, app.application_id), entries(conn, app.application_id)]);
  const childId = caseChildId(app);
  const elig = await eligibility(conn, childId);
  return {
    stages: stageStates({ app, recs, ents, docs, elig, pagesComplete }),
    records: recs, entries: ents, eligibility: elig, child: await childSummary(conn, childId),
    closure: closureChecklist(app, recs, ents, docs?.complete),
  };
}

// ---------------------------------------------------------------- gate (used by services/adoptionWorkflow.js)

/** Stage records a status needs. Returns blockers like the workflow gate: [{ label, message }]. */
async function gateFor(conn, cur, target) {
  const recs = await records(conn, cur.application_id);
  const out = [];
  const need = (cond, label, message) => { if (!cond) out.push({ label, message }); };
  switch (target) {
    case 'Case study completed': need(recs.assessment, 'Assessment and home study', 'Record the assessment and home study first.'); break;
    case 'Cleared for matching':
      need(recs.assessment && ['Recommended', 'Recommended with conditions'].includes(recs.assessment.result), 'Assessment result',
        recs.assessment ? `The assessment result is "${recs.assessment.result}". Only Recommended (or with conditions) can be cleared.` : 'Record the assessment and home study first.');
      break;
    case 'Trial custody': need(recs.placement, 'Placement record', 'Record the placement (date, location, type, monitoring schedule) first.'); break;
    case 'Endorsed to NACC':
      need(recs.racco?.result === 'Recommended for NACC decision', 'RACCO recommendation',
        recs.racco ? `RACCO's recommendation is "${recs.racco.result}".` : "Record the RACCO review and recommendation first.");
      break;
    case 'Order of Adoption issued':
      need(recs.nacc?.result === 'Approved', 'NACC decision', recs.nacc ? `The NACC decision is "${recs.nacc.result}".` : "Record the NACC's decision first.");
      need(recs.order, 'Order of Adoption record', 'Record the Order of Adoption (number, date, checked) first.');
      break;
    case 'Civil registry updated':
      need(recs.finality, 'Certificate of Finality', 'Record the Certificate of Finality first.');
      need(recs.registration, 'Civil registration', 'Record the civil registration first.');
      break;
    case 'Closed': {
      const { documentChecklist } = require('./adoptionValidation');
      const c = documentChecklist(await Adoption.form(cur.application_id), cur.application_type, await Adoption.documents(cur.application_id, conn), { isLegacy: !!cur.is_legacy });
      closureChecklist({ ...cur, status: cur.status }, recs, await entries(conn, cur.application_id), c.summary.complete)
        .filter((x) => !x.done && x.key !== 'registration').forEach((x) => out.push({ label: x.label, message: `Closure: ${x.label} is not done.` }));
      if (!recs.registration || recs.registration.result !== 'Registered') out.push({ label: 'Civil registration', message: 'Closure: the civil registration must be "Registered".' });
      break;
    }
    default:
  }
  return out;
}

// ---------------------------------------------------------------- actions

async function notifyTeam(conn, app, stage, what, actorId) {
  const params = { id: app.application_id, ref: app.reference_no, stage, what };
  const common = { entityType: 'application', entityId: app.application_id, params, groupKey: `stage:${app.application_id}:${stage}:${Date.now()}` };
  await Notify.toAdmins(conn, 'admin_stage_update', { ...common, exceptUserId: actorId });
  if (app.assigned_staff_id && app.assigned_staff_active && app.assigned_staff_id !== actorId) await Notify.emit(conn, 'staff_stage_update', { ...common, userId: app.assigned_staff_id });
}
async function event(conn, applicationId, stageKey, action, summary, actorId) {
  await conn.query('INSERT INTO tbl_adoption_stage_events (application_id, stage_key, action, summary, actor_id) VALUES (?, ?, ?, ?, ?)',
    [applicationId, stageKey, action, String(summary).slice(0, 255), actorId || null]);
}
function editable(req, app, stage) {
  if (!stage) throw new HttpError(404, 'Unknown stage.');
  if (!appliesTo(stage, app)) throw new HttpError(400, `"${stage.label}" is not part of this adoption category.`);
  if (app.archived_at || ['Declined', 'Withdrawn'].includes(app.status)) throw new HttpError(409, `This case is ${app.archived_at ? 'archived' : app.status} and read-only.`);
  if (app.status === 'Closed' && stage.key !== 'monitoring') throw new HttpError(409, 'This case is closed and read-only.');
  if (stage.admin && req.user.role !== 'Admin') throw new HttpError(403, `Only an administrator can record "${stage.label}".`);
}

/** Saves a stage's record (creates or updates it; every version is kept). */
async function saveRecord(req, app0, stageKey, input) {
  const stage = byKey[stageKey];
  editable(req, app0, stage);
  if (!stage?.record) throw new HttpError(400, 'This stage has no form to save.');
  const { data, errors } = validate(stage.record, input);
  if (Object.keys(errors).length) throw new HttpError(422, `${Object.keys(errors).length} item(s) need attention.`, { errors });
  // Documents a record refers to must be uploaded first (Documents tab).
  const needs = { order: 'order_of_adoption', finality: 'certificate_of_finality' }[stageKey];
  if (needs && !(await Adoption.documents(app0.application_id)).some((d) => d.doc_type === needs && d.status !== 'Replaced')) {
    throw new HttpError(409, `Upload the ${needs === 'order_of_adoption' ? 'Order of Adoption' : 'Certificate of Finality'} in Documents first.`);
  }
  if (stageKey === 'nacc' && !['Endorsed to NACC', 'Awaiting NACC decision'].includes(app0.status) && !app0.finalized_at) {
    throw new HttpError(409, 'Record the NACC decision after the case is endorsed to the NACC.');
  }
  const enc = encField(JSON.stringify(data));
  const result = resultOf(stageKey, data);
  await withTransaction(async (conn) => {
    const [[a]] = await conn.query('SELECT application_id, status FROM tbl_adoption_applications WHERE application_id = ? FOR UPDATE', [app0.application_id]);
    if (!a) throw new HttpError(404, 'Application not found.');
    const [[existing]] = await conn.query('SELECT record_id FROM tbl_adoption_stage_records WHERE application_id = ? AND stage_key = ?', [app0.application_id, stageKey]);
    await conn.query(
      `INSERT INTO tbl_adoption_stage_records (application_id, stage_key, data_enc, result, updated_by) VALUES (?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE data_enc = VALUES(data_enc), result = VALUES(result), updated_by = VALUES(updated_by)`,
      [app0.application_id, stageKey, enc, result, req.user.user_id]);
    await conn.query("INSERT INTO tbl_adoption_record_versions (scope, application_id, stage_key, data_enc, saved_by) VALUES ('stage', ?, ?, ?, ?)",
      [app0.application_id, stageKey, enc, req.user.user_id]);
    const what = `${stage.label} ${existing ? 'updated' : 'recorded'}${result ? `: ${result}` : ''}`;
    await event(conn, app0.application_id, stageKey, existing ? 'record_updated' : 'record_saved', what, req.user.user_id);
    await logActivityWith(conn, req, `STAGE_RECORD_SAVED (${stageKey}${result ? `: ${result}` : ''})`, `Application #${app0.application_id}`);
    await notifyTeam(conn, app0, stage.label, what, req.user.user_id);
  });
  // The NACC's decision is recorded: the case is waiting on it no longer (bookkeeping step, OPS).
  if (stageKey === 'nacc' && app0.status === 'Endorsed to NACC') {
    const workflow = require('./adoptionWorkflow');
    const u = workflow.cleanStatusUpdate(app0, { status: 'Awaiting NACC decision' }, req.user.role);
    await workflow.applyStatusUpdate(app0, u, req.user.user_id);
  }
}

/** Adds a repeated entry (a monitoring visit or a post-adoption follow-up). Entries are never edited. */
async function addEntry(req, app0, stageKey, input) {
  const stage = byKey[stageKey];
  editable(req, app0, stage);
  if (!stage?.entries) throw new HttpError(400, 'This stage has no entries.');
  if (stageKey === 'placement' && !['Trial custody', 'Trial custody completed'].includes(app0.status)) throw new HttpError(409, 'Monitoring visits are recorded during trial custody.');
  if (stageKey === 'monitoring' && !app0.finalized_at) throw new HttpError(409, 'Post-adoption follow-ups start after the Order of Adoption.');
  const { data, errors } = validate(stage.entries.fields, input);
  if (Object.keys(errors).length) throw new HttpError(422, `${Object.keys(errors).length} item(s) need attention.`, { errors });
  const dateKey = stage.entries.fields.find((f) => f.type === 'date').key;
  const round = stageKey === 'monitoring' ? data.f_round : null;
  try {
    await withTransaction(async (conn) => {
      await conn.query(
        'INSERT INTO tbl_adoption_stage_entries (application_id, stage_key, kind, round_label, entry_date, data_enc, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [app0.application_id, stageKey, stage.entries.kind, round, data[dateKey], encField(JSON.stringify(data)), req.user.user_id]);
      const what = `${round || stage.entries.label} recorded (${data[dateKey]})`;
      await event(conn, app0.application_id, stageKey, 'entry_added', what, req.user.user_id);
      await logActivityWith(conn, req, `STAGE_ENTRY_ADDED (${stageKey}${round ? `: ${round}` : ''})`, `Application #${app0.application_id}`);
      await notifyTeam(conn, app0, stage.label, what, req.user.user_id);
    });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY' || err.errno === 1062) throw new HttpError(409, `${round} is already recorded for this case.`);
    throw err;
  }
}

/** Builds the status update a stage's Proceed records, from its record. */
function proceedBody(target, recs) {
  const r = (k) => recs[k]?.data || {};
  switch (target) {
    case 'Trial custody': return { status: target, trial_start: r('placement').p_date };
    case 'Petition filed': return { status: target, petition_date: r('petition').pet_date, racco_office: r('petition').pet_location };
    case 'Mandatory appearance done':
      if (!r('petition').ap_date) throw new HttpError(422, 'Record the mandatory appearance date in the Petition form first.');
      return { status: target, appearance_date: r('petition').ap_date };
    case 'Endorsed to NACC': return { status: target, endorsed_date: r('racco').racco_date };
    case 'Order of Adoption issued': return { status: target, order_number: r('order').order_number, order_date: r('order').order_date };
    case 'Civil registry updated': {
      const g = r('registration');
      return { status: target, civil_registry_ref: g.psa_record || g.birth_record || `${g.lcr || 'LCR'} ${g.reg_date || ''}`.trim() };
    }
    default: return { status: target };
  }
}

/** Proceed: records the stage's next status through the workflow (same checks and gate as Update status). */
async function proceed(req, app0, stageKey, target) {
  const stage = byKey[stageKey];
  editable(req, app0, stage);
  const allowed = [].concat(stage.proceed || []);
  if (!allowed.includes(target)) throw new HttpError(400, `"${stage.label}" can't record "${target}".`);
  const recs = await records(pool, app0.application_id);
  if (stage.record && !recs[stageKey] && !['Forum attended', 'Published'].includes(target)) throw new HttpError(422, `Save the ${stage.label} form first.`);
  const workflow = require('./adoptionWorkflow');
  const u = workflow.cleanStatusUpdate(app0, proceedBody(target, recs), req.user.role);
  const { historyId } = await workflow.applyStatusUpdate(app0, u, req.user.user_id);
  await withTransaction(async (conn) => {
    await event(conn, app0.application_id, stageKey, 'proceeded', `${stage.label}: ${target} recorded`, req.user.user_id);
    await notifyTeam(conn, app0, stage.label, `${target} recorded`, req.user.user_id);
  });
  return { historyId, target, update: u };
}

/** Chooses the existing child a Regular case is for (before matching). Never creates a child. */
async function setChild(req, app0, childId) {
  if (WF.trackOf(app0.application_type) !== 'Regular') throw new HttpError(400, 'In this category the child is linked in Matching and placement.');
  if (app0.matched_child_id) throw new HttpError(409, 'A child is already matched to this case.');
  if (app0.archived_at || WF.FINAL.includes(app0.status)) throw new HttpError(409, 'This case is read-only.');
  const id = str(childId) || null;
  await withTransaction(async (conn) => {
    if (id) {
      const [[c]] = await conn.query("SELECT child_id, status, TIMESTAMPDIFF(YEAR, dob, CURDATE()) AS age FROM tbl_children WHERE child_id = ?", [id]);
      if (!c) throw new HttpError(404, 'Child record not found. Choose a child from Children Management.');
      if (c.status !== 'Active') throw new HttpError(409, `The child is ${String(c.status).toLowerCase()}.`);
      if (Number(c.age) >= 18) throw new HttpError(409, 'Only children under 18 can be adopted through this process.');
    }
    await conn.query('UPDATE tbl_adoption_applications SET target_child_id = ? WHERE application_id = ?', [id, app0.application_id]);
    await event(conn, app0.application_id, 'eligibility', 'child_selected', id ? 'Existing child selected for this case' : 'Child selection cleared', req.user.user_id);
    await logActivityWith(conn, req, `CASE_CHILD_SELECTED (${id || 'cleared'})`, `Application #${app0.application_id}`);
  });
}

/** Records the case child's adoption eligibility (kept on the child; every version is kept). */
async function saveEligibility(req, app0, input) {
  const childId = caseChildId(app0);
  if (!childId) throw new HttpError(409, 'Choose the existing child this case is for first.');
  if (app0.archived_at || WF.FINAL.includes(app0.status)) throw new HttpError(409, 'This case is read-only.');
  const { data, errors } = validate(ST.ELIGIBILITY_FIELDS, input);
  if (Object.keys(errors).length) throw new HttpError(422, `${Object.keys(errors).length} item(s) need attention.`, { errors });
  const enc = encField(JSON.stringify(data));
  await withTransaction(async (conn) => {
    await conn.query(
      `INSERT INTO tbl_child_adoption_eligibility (child_id, status, data_enc, updated_by) VALUES (?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE status = VALUES(status), data_enc = VALUES(data_enc), updated_by = VALUES(updated_by)`,
      [childId, data.eligibility_status, enc, req.user.user_id]);
    await conn.query("INSERT INTO tbl_adoption_record_versions (scope, child_id, data_enc, saved_by) VALUES ('eligibility', ?, ?, ?)", [childId, enc, req.user.user_id]);
    await event(conn, app0.application_id, 'eligibility', 'eligibility_saved', `Child eligibility: ${data.eligibility_status}`, req.user.user_id);
    await logActivityWith(conn, req, `CHILD_ELIGIBILITY_SAVED (${data.eligibility_status})`, `Child ${childId}`);
    await notifyTeam(conn, app0, 'Child eligibility', `Child eligibility: ${data.eligibility_status}`, req.user.user_id);
  });
}

/** Timeline events from the stages (merged into the Timeline tab). */
async function timelineEvents(applicationId) {
  const [rows] = await pool.query(
    `SELECT e.stage_key, e.action, e.summary, e.created_at, u.full_name AS actor, r.role_name AS actor_role
       FROM tbl_adoption_stage_events e LEFT JOIN tbl_users u ON u.user_id = e.actor_id LEFT JOIN tbl_roles r ON r.role_id = u.role_id
      WHERE e.application_id = ? ORDER BY e.created_at DESC, e.event_id DESC`, [applicationId]).catch(() => [[]]);
  return rows.map((r) => ({ at: r.created_at, kind: 'stage', text: r.summary, by: r.actor ? `${r.actor}${r.actor_role ? ` (${r.actor_role})` : ''}` : null }));
}

/** A short summary for the child's profile (Children > child > Adoption). */
async function childCaseSummary(app) {
  const recs = await records(pool, app.application_id);
  const ents = await entries(pool, app.application_id);
  const [[m]] = await pool.query(`SELECT status FROM tbl_adoption_matches WHERE application_id = ? ORDER BY match_id DESC LIMIT 1`, [app.application_id]).catch(() => [[null]]);
  const stages = stageStates({ app, recs, ents, docs: null, elig: await eligibility(pool, caseChildId(app)), pagesComplete: true });
  const cur = stages.find((s) => s.state === 'current');
  return {
    current_stage: app.status === 'Closed' ? 'Case closure (closed)' : cur ? cur.label : app.status,
    matching_status: m?.status || (app.matched_child_id ? 'Matched' : 'None'),
    placement_status: app.trial_completed_at ? 'Trial custody completed' : app.trial_start ? 'In trial custody' : 'Not placed',
    petition_status: recs.petition?.data?.pet_status || (app.petition_date ? 'Filed' : 'Not filed'),
    nacc_decision: recs.nacc?.result || 'Not recorded',
    order_of_adoption: app.order_number ? `Issued${app.order_date ? ` ${String(app.order_date instanceof Date ? app.order_date.toISOString() : app.order_date).slice(0, 10)}` : ''}` : 'Not issued',
    certificate_of_finality: recs.finality ? 'Recorded' : 'Not recorded',
    civil_registration: recs.registration?.result || 'Not recorded',
    post_adoption_monitoring: `${ents.filter((e) => e.stage_key === 'monitoring').length} of 4 follow-ups`,
  };
}

module.exports = {
  validate, records, entries, eligibility, childSummary, caseChildId, stageStates, caseStages, closureChecklist, gateFor,
  saveRecord, addEntry, proceed, setChild, saveEligibility, timelineEvents, childCaseSummary, byKey,
};
