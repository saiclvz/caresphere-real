/**
 * Matching a child to an applicant (Regular adoption only), as CareSphere records it. CareSphere records
 * NACC's decisions; it doesn't make them.
 *
 * Flow: Proposed (assigned Staff or Admin, with a best-interest recommendation) -> Under review ->
 * Approved (Admin only; the application moves to "Child matched") -> NACC confirmed (date and reference)
 * -> Trial custody (through Update status; the match becomes "Placed"). Withdraw at any active step
 * (reason required): the child returns to Available and the history is kept.
 *
 * Hard blocks (eligibility) stop a proposal or an approval. The compatibility review never rejects: each
 * mismatch is a warning, and continuing needs a written reason, which is recorded.
 * One active match per child and per applicant is enforced by unique keys in tbl_adoption_matches.
 */
const { pool, withTransaction } = require('../config/db');
const env = require('../config/env');
const HttpError = require('../utils/HttpError');
const Adoption = require('../models/adoptionModel');
const WF = require('../config/adoptionWorkflow');
const { encField, decField } = require('../utils/fieldCrypto');
const Notify = require('./notifications');
const { logActivityWith } = require('../utils/audit');

const ACTIVE = ['Proposed', 'Under review', 'Approved', 'NACC confirmed'];

/** The child's documents needed before matching (verified by Admin on the child's page). */
const CHILD_DOCS = [
  { key: 'birth_certificate', label: "PSA/SECPA birth certificate or foundling certificate" },
  { key: 'case_study_report', label: "Child Case Study Report" },
  { key: 'medical_evaluation', label: 'Medical evaluation and history' },
  { key: 'psychological_evaluation', label: 'Psychological evaluation', minAge: 5 },
  { key: 'photos', label: 'Recent photos' },
];

/** Answer options (config/adoptionForm.js uses the same lists). */
const AGE_RANGES = { '0 to 2 years': [0, 2], '3 to 5 years': [3, 5], '6 to 9 years': [6, 9], '10 to 13 years': [10, 13], '14 to 17 years': [14, 17], 'Any age': [0, 17] };
const NEEDS_OK = { No: [], 'Yes, mild or manageable needs': ['Some'], 'Yes, including significant needs': ['Some', 'Significant'] };
const SIBLINGS_OK = { No: 0, 'Yes, two siblings': 1, 'Yes, three or more siblings': 99 };

// ---------------------------------------------------------------- eligibility

/** What keeps this application from being matched now (hard blocks, with the reason). */
async function applicationBlocks(conn, app) {
  const out = [];
  if (WF.trackOf(app.application_type) !== 'Regular') out.push({ key: 'category', message: 'Matching applies to Regular adoption only. For this category, link and verify the child and the relationship instead.' });
  if (app.archived_at || WF.FINAL.includes(app.status)) out.push({ key: 'status', message: `This application is ${app.archived_at ? 'archived' : app.status} and read-only.` });
  else if (!['Cleared for matching', 'Placement ended', 'Child matched'].includes(app.status)) out.push({ key: 'status', message: `The application must be "Cleared for matching" first (it is at "${app.status}").` });
  // a. Every required document and the ID and clearance checks verified (the completion gate).
  const { documentChecklist } = require('./adoptionValidation');
  const c = documentChecklist(await Adoption.form(app.application_id), app.application_type, await Adoption.documents(app.application_id, conn), { isLegacy: !!app.is_legacy });
  const vb = await require('./verification').blocking(app.application_id);
  const pending = [...c.summary.blocking, ...vb];
  if (pending.length) out.push({ key: 'documents', message: `${pending.length} required item${pending.length === 1 ? ' is' : 's are'} not verified yet: ${pending.slice(0, 4).map((b) => b.label).join('; ')}${pending.length > 4 ? '; and more' : ''}.` });
  // b. Home study completed and approved (Case study completed, then Cleared for matching by Admin).
  if (!app.case_study_completed_at) out.push({ key: 'home_study', message: 'The home study (case study) is not recorded as completed.' });
  else if (!app.cleared_at) out.push({ key: 'home_study', message: 'The home study is not approved yet (Cleared for matching by an administrator).' });
  // c. Pre-adoption forum.
  if (!app.forum_verified_at) out.push({ key: 'forum', message: 'The pre-adoption forum is not recorded (Forum attended, with the certificate).' });
  return out;
}

async function childProfile(conn, childId) {
  const [[c]] = await conn.query(
    `SELECT child_id, status, available_for_adoption, placement_status, cdclaa_verified_at, special_needs, sibling_group_size, needs_own_room,
            TIMESTAMPDIFF(YEAR, dob, CURDATE()) AS age FROM tbl_children WHERE child_id = ?`, [childId]);
  if (!c) return null;
  const [docs] = await conn.query(
    `SELECT m.doc_key, m.verified_at, m.reference, u.full_name AS verified_by_name FROM tbl_child_match_documents m
       LEFT JOIN tbl_users u ON u.user_id = m.verified_by WHERE m.child_id = ?`, [childId]);
  c.documents = CHILD_DOCS.filter((d) => !d.minAge || Number(c.age) >= d.minAge).map((d) => {
    const r = docs.find((x) => x.doc_key === d.key);
    return { key: d.key, label: d.label, verified_at: r?.verified_at || null, verified_by_name: r?.verified_by_name || null, reference: r?.reference || null };
  });
  return c;
}

/** What keeps this child from being matched (d and e), ignoring `exceptMatchId` (the match being approved). */
async function childBlocks(conn, childId, { exceptMatchId = null } = {}) {
  const c = await childProfile(conn, childId);
  if (!c) return { child: null, blocks: [{ key: 'child', message: 'Child record not found.' }] };
  const out = [];
  if (c.status !== 'Active') out.push({ key: 'child', message: `The child is ${String(c.status).toLowerCase()}.` });
  if (Number(c.age) >= Number(env.transitionAge)) out.push({ key: 'child', message: 'Only children under 18 can be matched.' });
  if (!c.available_for_adoption) out.push({ key: 'available', message: 'The child is not marked Available for adoption.' });
  if (!c.cdclaa_verified_at) out.push({ key: 'cdclaa', message: 'The child has no CDCLAA verified by an administrator.' });
  // The child's adoption eligibility (Child eligibility stage), recorded by a person.
  const [[el]] = await conn.query('SELECT status FROM tbl_child_adoption_eligibility WHERE child_id = ?', [childId]).catch(() => [[null]]);
  if (!el || !['Eligible', 'Eligible with conditions'].includes(el.status)) out.push({ key: 'eligibility', message: el ? `The child's adoption eligibility is "${el.status}".` : "The child's adoption eligibility is not recorded (Child eligibility stage)." });
  const unverified = c.documents.filter((d) => !d.verified_at);
  if (unverified.length) out.push({ key: 'child_documents', message: `The child's documents are not all verified: ${unverified.map((d) => d.label).join('; ')}.` });
  const [[other]] = await conn.query(`SELECT match_id FROM tbl_adoption_matches WHERE child_id = ? AND status IN (?) ${exceptMatchId ? 'AND match_id <> ?' : ''} LIMIT 1`,
    exceptMatchId ? [childId, ACTIVE, exceptMatchId] : [childId, ACTIVE]);
  if (other) out.push({ key: 'other_match', message: 'The child already has another active match.' });
  if (c.placement_status !== 'None' && !exceptMatchId) out.push({ key: 'placed', message: 'The child is already matched or in trial custody.' });
  return { child: c, blocks: out };
}

// ---------------------------------------------------------------- compatibility

/** Matches and mismatches between the applicant's answers and the child's profile. Warnings only. */
function compatibility(form, child) {
  const out = [];
  const add = (key, label, result, detail) => out.push({ key, label, result, detail });
  const age = Number(child.age);
  const range = AGE_RANGES[form.pref_age_range];
  if (!range) add('age', 'Age', 'not_stated', `The child is ${age}. The applicant gave no preferred age range.`);
  else add('age', 'Age', age >= range[0] && age <= range[1] ? 'match' : 'mismatch', `The child is ${age}; preferred: ${form.pref_age_range.toLowerCase()}.`);

  const needs = child.special_needs;
  if (!needs) add('needs', 'Health or special needs', 'not_stated', "The child's needs are not recorded on the child's page.");
  else if (needs === 'None') add('needs', 'Health or special needs', 'match', 'The child has no recorded special needs.');
  else if (!form.pref_special_needs) add('needs', 'Health or special needs', 'not_stated', `The child has ${needs.toLowerCase()} needs. The applicant did not say.`);
  else add('needs', 'Health or special needs', (NEEDS_OK[form.pref_special_needs] || []).includes(needs) ? 'match' : 'mismatch', `The child has ${needs.toLowerCase()} needs; the applicant: "${form.pref_special_needs}".`);

  const sibs = child.sibling_group_size;
  if (sibs === null || sibs === undefined) add('siblings', 'Siblings', 'not_stated', 'Whether the child has siblings to be placed together is not recorded.');
  else if (Number(sibs) === 0) add('siblings', 'Siblings', 'match', 'No siblings to be placed together.');
  else if (!form.pref_siblings) add('siblings', 'Siblings', 'not_stated', `The child has ${sibs} sibling(s) to be placed together. The applicant did not say.`);
  else add('siblings', 'Siblings', Number(sibs) <= (SIBLINGS_OK[form.pref_siblings] ?? 0) ? 'match' : 'mismatch', `${sibs} sibling(s) to be placed together; the applicant: "${form.pref_siblings}".`);

  if (child.needs_own_room === null || child.needs_own_room === undefined) add('space', 'Household and room', 'not_stated', "Whether the child needs a room of their own is not recorded.");
  else if (!child.needs_own_room) add('space', 'Household and room', 'match', 'The child can share a room.');
  else if (!form.pref_space) add('space', 'Household and room', 'not_stated', 'The child needs a room of their own. The applicant did not say.');
  else add('space', 'Household and room', form.pref_space === 'A room of their own' ? 'match' : 'mismatch', `The child needs a room of their own; the applicant offers: ${form.pref_space.toLowerCase()}.`);

  const cz = form.citizenship;
  if (!cz) add('citizenship', 'Citizenship and residence', 'not_stated', 'Citizenship not given.');
  else if (cz === 'Foreign national') add('citizenship', 'Citizenship and residence', 'mismatch', 'Foreign national applying for a domestic (Regular) adoption: check the residency certificate and the NACC rules for this category.');
  else add('citizenship', 'Citizenship and residence', 'match', `${cz}: fits a domestic (Regular) adoption.`);
  return out;
}

// ---------------------------------------------------------------- records

const showMatch = (m, events = []) => ({
  match_id: m.match_id, child_id: m.child_id, status: m.status, recommendation_type: m.recommendation_type || null, recommendation: decField(m.recommendation), compatibility: typeof m.compatibility === 'string' ? JSON.parse(m.compatibility) : (m.compatibility || []),
  mismatch_reason: m.mismatch_reason ? decField(m.mismatch_reason) : null, proposed_by_name: m.proposed_by_name, proposed_at: m.proposed_at,
  approved_by_name: m.approved_by_name, approved_at: m.approved_at, nacc_date: m.nacc_date ? String(m.nacc_date instanceof Date ? m.nacc_date.toISOString() : m.nacc_date).slice(0, 10) : null, nacc_reference: m.nacc_reference,
  ended_at: m.ended_at, end_reason: m.end_reason ? decField(m.end_reason) : null,
  child: { full_name: m.child_full_name, age: m.child_age },
  events: events.filter((e) => e.match_id === m.match_id).map((e) => ({ event: e.event, from_status: e.from_status, to_status: e.to_status, by: e.actor_name, at: e.created_at, detail: e.detail ? decField(e.detail) : null })),
});

async function matchesFor(conn, applicationId) {
  const [rows] = await conn.query(
    `SELECT m.*, pu.full_name AS proposed_by_name, au.full_name AS approved_by_name, c.full_name AS child_full_name, TIMESTAMPDIFF(YEAR, c.dob, CURDATE()) AS child_age
       FROM tbl_adoption_matches m JOIN tbl_children c ON c.child_id = m.child_id
       LEFT JOIN tbl_users pu ON pu.user_id = m.proposed_by LEFT JOIN tbl_users au ON au.user_id = m.approved_by
      WHERE m.application_id = ? ORDER BY m.match_id DESC`, [applicationId]);
  if (!rows.length) return [];
  const [events] = await conn.query(
    `SELECT e.*, u.full_name AS actor_name FROM tbl_adoption_match_events e LEFT JOIN tbl_users u ON u.user_id = e.actor_id
      WHERE e.match_id IN (?) ORDER BY e.created_at DESC, e.event_id DESC`, [rows.map((r) => r.match_id)]);
  return rows.map((r) => showMatch(r, events));
}

async function addEvent(conn, matchId, event, from, to, actorId, detail = null) {
  await conn.query('INSERT INTO tbl_adoption_match_events (match_id, event, from_status, to_status, actor_id, detail) VALUES (?, ?, ?, ?, ?, ?)',
    [matchId, event, from, to, actorId || null, detail ? encField(String(detail).slice(0, 2000)) : null]);
}

/** Admins and the assigned staff member: reference number and the step only. */
async function notifyTeam(conn, app, step, actorId) {
  const params = { id: app.application_id, ref: app.reference_no, step };
  const common = { entityType: 'application', entityId: app.application_id, params, groupKey: `match:${app.application_id}:${step}:${Date.now()}` };
  await Notify.toAdmins(conn, 'admin_match_update', { ...common, exceptUserId: actorId });
  if (app.assigned_staff_id && app.assigned_staff_active && app.assigned_staff_id !== actorId) await Notify.emit(conn, 'staff_match_update', { ...common, userId: app.assigned_staff_id });
}

const str = (v) => (v === undefined || v === null ? '' : String(v).trim());
const sqlDup = (err) => err && (err.code === 'ER_DUP_ENTRY' || err.errno === 1062);

async function lockApp(conn, id) {
  const [[a]] = await conn.query('SELECT application_id FROM tbl_adoption_applications WHERE application_id = ? FOR UPDATE', [id]);
  if (!a) throw new HttpError(404, 'Application not found.');
  return Adoption.findById(id, conn);
}
async function lockMatch(conn, app, matchId) {
  const [[m]] = await conn.query('SELECT * FROM tbl_adoption_matches WHERE match_id = ? AND application_id = ? FOR UPDATE', [matchId, app.application_id]);
  if (!m) throw new HttpError(404, 'Match not found.');
  return m;
}

// ---------------------------------------------------------------- actions

/** Eligibility, the matchable children and (with child_id) the compatibility review, for the Propose dialog. */
async function preview(app, childId) {
  const blocks = await applicationBlocks(pool, app);
  const form = await Adoption.form(app.application_id);
  const out = { blocks };
  if (childId) {
    const { child, blocks: cb } = await childBlocks(pool, childId);
    out.child_blocks = cb;
    out.compatibility = child ? compatibility(form, child) : [];
  }
  return out;
}

/** POST /adoptions/:id/matches { child_id, recommendation, mismatch_reason? } (assigned Staff, Admin) */
async function propose(req, app0, body) {
  const childId = str(body.child_id);
  const recommendation = str(body.recommendation);
  const recType = str(body.recommendation_type) || 'Potential match';
  if (!['Potential match', 'Not recommended', 'Further assessment'].includes(recType)) throw new HttpError(400, 'Choose the matching recommendation: Potential match, Not recommended or Further assessment.');
  if (!childId) throw new HttpError(400, 'Choose the child.');
  if (recommendation.length < 20) throw new HttpError(400, "Write the recommendation about the child's best interest (at least 20 characters).");
  if (recommendation.length > 5000) throw new HttpError(400, 'The recommendation can be up to 5000 characters.');
  try {
    return await withTransaction(async (conn) => {
      const app = await lockApp(conn, app0.application_id);
      const blocks = await applicationBlocks(conn, app);
      if (app.status === 'Child matched') blocks.push({ key: 'status', message: 'This application already has an approved match.' });
      if (blocks.length) throw new HttpError(409, `Matching is blocked: ${blocks.map((b) => b.message).join(' ')}`, { blocks });
      await conn.query('SELECT child_id FROM tbl_children WHERE child_id = ? FOR UPDATE', [childId]);
      const { child, blocks: cb } = await childBlocks(conn, childId);
      if (cb.length) throw new HttpError(409, `This child can't be matched: ${cb.map((b) => b.message).join(' ')}`, { child_blocks: cb });
      const compat = compatibility(await Adoption.form(app.application_id), child);
      const mismatches = compat.filter((c) => c.result === 'mismatch');
      const reason = str(body.mismatch_reason);
      if (mismatches.length && reason.length < 10) throw new HttpError(400, `There ${mismatches.length === 1 ? 'is 1 mismatch' : `are ${mismatches.length} mismatches`} (${mismatches.map((m) => m.label).join(', ')}). Write the reason to continue (at least 10 characters).`, { mismatches });
      const [r] = await conn.query(
        `INSERT INTO tbl_adoption_matches (application_id, applicant_id, child_id, status, recommendation_type, recommendation, compatibility, mismatch_reason, proposed_by)
         VALUES (?, ?, ?, 'Proposed', ?, ?, ?, ?, ?)`,
        [app.application_id, app.applicant_id, childId, recType, encField(recommendation), JSON.stringify(compat), mismatches.length ? encField(reason.slice(0, 2000)) : null, req.user.user_id]);
      await addEvent(conn, r.insertId, 'proposed', null, 'Proposed', req.user.user_id, `Recommendation recorded: ${recType}.`);
      await logActivityWith(conn, req, `MATCH_PROPOSED (match #${r.insertId}${mismatches.length ? `, ${mismatches.length} mismatch(es)` : ''})`, `Application #${app.application_id}`);
      if (mismatches.length) {
        await addEvent(conn, r.insertId, 'mismatch_acknowledged', null, null, req.user.user_id, `${mismatches.map((m) => m.label).join(', ')}: ${reason}`);
        await logActivityWith(conn, req, `MATCH_MISMATCH_ACKNOWLEDGED (match #${r.insertId}: ${mismatches.map((m) => m.key).join(', ')})`, `Application #${app.application_id}`);
      }
      await notifyTeam(conn, app, 'proposed', req.user.user_id);
      await Notify.emit(conn, 'application_match_review', { userId: app.applicant_id, applicationId: app.application_id, entityType: 'application', entityId: app.application_id,
        params: { id: app.application_id, ref: app.reference_no }, groupKey: `match_review:${app.application_id}` });
      return r.insertId;
    });
  } catch (err) {
    // The unique keys: one active match per child and per applicant (a race the checks above didn't see).
    if (sqlDup(err)) throw new HttpError(409, /active_child/.test(err.message) ? 'The child already has another active match.' : 'This applicant already has an active match.');
    throw err;
  }
}

/** Proposed -> Under review (assigned Staff, Admin). */
async function startReview(req, app0, matchId) {
  await withTransaction(async (conn) => {
    const app = await lockApp(conn, app0.application_id);
    const m = await lockMatch(conn, app, matchId);
    if (m.status !== 'Proposed') throw new HttpError(409, `This match is ${m.status}.`);
    await conn.query("UPDATE tbl_adoption_matches SET status = 'Under review' WHERE match_id = ?", [m.match_id]);
    await addEvent(conn, m.match_id, 'review_started', 'Proposed', 'Under review', req.user.user_id);
    await logActivityWith(conn, req, `MATCH_REVIEW_STARTED (match #${m.match_id})`, `Application #${app.application_id}`);
    await notifyTeam(conn, app, 'under review', req.user.user_id);
  });
}

/** Under review -> Approved (Admin only). The application moves to "Child matched" (child placement: Matched). */
async function approve(req, app0, matchId, body) {
  if (req.user.role !== 'Admin') throw new HttpError(403, 'Only an administrator can approve a match.');
  const note = str(body?.note).slice(0, 2000);
  const workflow = require('./adoptionWorkflow');
  const [[m0]] = await pool.query('SELECT * FROM tbl_adoption_matches WHERE match_id = ? AND application_id = ?', [matchId, app0.application_id]);
  if (!m0) throw new HttpError(404, 'Match not found.');
  if (m0.status !== 'Under review') throw new HttpError(409, m0.status === 'Proposed' ? 'Start the review first.' : `This match is ${m0.status}.`);
  // The system never decides: only a match the social worker recommended as a potential match can be approved.
  if (m0.recommendation_type && m0.recommendation_type !== 'Potential match') throw new HttpError(409, `The recommendation is "${m0.recommendation_type}". Withdraw it and propose again after further assessment.`);
  const appBlocks = (await applicationBlocks(pool, app0)).filter((b) => b.key !== 'status' || app0.status !== 'Child matched');
  const { blocks: cb } = await childBlocks(pool, m0.child_id, { exceptMatchId: m0.match_id });
  const all = [...appBlocks, ...cb];
  if (all.length) throw new HttpError(409, `The match can't be approved: ${all.map((b) => b.message).join(' ')}`, { blocks: all });
  // Same transaction as the status change: the match is approved only if "Child matched" is recorded.
  await workflow.applyStatusUpdate(app0, {
    target: 'Child matched', childId: m0.child_id, remark: null, internalNote: null, documents: [], interview: null, fields: {},
    viaMatch: true,
    async afterInTx(conn, historyId) {
      const m = await lockMatch(conn, app0, matchId);
      if (m.status !== 'Under review') throw new HttpError(409, 'This match was just changed by someone else. Refresh and try again.');
      await conn.query("UPDATE tbl_adoption_matches SET status = 'Approved', approved_by = ?, approved_at = NOW() WHERE match_id = ?", [req.user.user_id, m.match_id]);
      await addEvent(conn, m.match_id, 'approved', 'Under review', 'Approved', req.user.user_id, note || null);
      await logActivityWith(conn, req, `MATCH_APPROVED (match #${m.match_id})`, `Application #${app0.application_id}`);
      await notifyTeam(conn, app0, 'approved', req.user.user_id);
      return historyId;
    },
  }, req.user.user_id);
}

/** Approved -> NACC confirmed: the date and reference of NACC's referral or confirmation (Admin). */
async function recordNacc(req, app0, matchId, body) {
  if (req.user.role !== 'Admin') throw new HttpError(403, "Only an administrator can record NACC's decision.");
  const date = str(body?.nacc_date);
  const ref = str(body?.nacc_reference);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(new Date(`${date}T00:00:00Z`).getTime())) throw new HttpError(400, 'Enter the date of the NACC referral or confirmation.');
  if (date > new Date().toISOString().slice(0, 10)) throw new HttpError(400, 'The NACC date cannot be in the future.');
  if (!ref || ref.length > 120) throw new HttpError(400, 'Enter the NACC reference number (up to 120 characters).');
  await withTransaction(async (conn) => {
    const app = await lockApp(conn, app0.application_id);
    const m = await lockMatch(conn, app, matchId);
    if (m.status !== 'Approved') throw new HttpError(409, m.status === 'NACC confirmed' ? 'NACC confirmation is already recorded.' : 'Approve the match first.');
    await conn.query("UPDATE tbl_adoption_matches SET status = 'NACC confirmed', nacc_date = ?, nacc_reference = ? WHERE match_id = ?", [date, ref, m.match_id]);
    await addEvent(conn, m.match_id, 'nacc_recorded', 'Approved', 'NACC confirmed', req.user.user_id, `NACC ${date}, ref ${ref}`);
    await logActivityWith(conn, req, `MATCH_NACC_RECORDED (match #${m.match_id})`, `Application #${app.application_id}`);
    await notifyTeam(conn, app, 'confirmed with NACC', req.user.user_id);
  });
}

/**
 * Withdraw or unmatch (reason required). Before approval: assigned Staff or Admin. After approval: Admin only,
 * and the application records "Placement ended" (the child's placement is released). History is kept.
 */
async function withdraw(req, app0, matchId, body) {
  const reason = str(body?.reason);
  if (reason.length < 10) throw new HttpError(400, 'Give the reason (at least 10 characters).');
  const [[m0]] = await pool.query('SELECT * FROM tbl_adoption_matches WHERE match_id = ? AND application_id = ?', [matchId, app0.application_id]);
  if (!m0) throw new HttpError(404, 'Match not found.');
  if (!ACTIVE.includes(m0.status)) throw new HttpError(409, `This match is already ${m0.status}.`);
  const approved = ['Approved', 'NACC confirmed'].includes(m0.status);
  if (approved && req.user.role !== 'Admin') throw new HttpError(403, 'Only an administrator can unmatch an approved match.');
  const end = async (conn) => {
    const m = await lockMatch(conn, app0, matchId);
    if (!ACTIVE.includes(m.status)) throw new HttpError(409, `This match is already ${m.status}.`);
    await conn.query("UPDATE tbl_adoption_matches SET status = 'Withdrawn', ended_by = ?, ended_at = NOW(), end_reason = ? WHERE match_id = ?", [req.user.user_id, encField(reason.slice(0, 2000)), m.match_id]);
    await addEvent(conn, m.match_id, 'withdrawn', m.status, 'Withdrawn', req.user.user_id, reason);
    await logActivityWith(conn, req, `MATCH_WITHDRAWN (match #${m.match_id}, was ${m.status})`, `Application #${app0.application_id}`);
    await notifyTeam(conn, app0, 'withdrawn', req.user.user_id);
  };
  if (approved && app0.status === 'Child matched') {
    await require('./adoptionWorkflow').applyStatusUpdate(app0, {
      target: 'Placement ended', reason, remark: null, internalNote: null, documents: [], interview: null, fields: {}, keepMatches: true,
      afterInTx: (conn) => end(conn),
    }, req.user.user_id);
  } else {
    await withTransaction(async (conn) => { await lockApp(conn, app0.application_id); await end(conn); });
  }
}

/** Called inside status changes: ends or advances the application's active match. */
async function onStatusChange(conn, app, target, userId) {
  const [[m]] = await conn.query(`SELECT * FROM tbl_adoption_matches WHERE application_id = ? AND status IN (?) FOR UPDATE`, [app.application_id, ACTIVE]);
  if (!m) return;
  if (target === 'Trial custody') {
    await conn.query("UPDATE tbl_adoption_matches SET status = 'Placed' WHERE match_id = ?", [m.match_id]);
    await addEvent(conn, m.match_id, 'placed', m.status, 'Placed', userId, 'Trial custody started.');
  } else if (['Declined', 'Withdrawn', 'Placement ended'].includes(target)) {
    await conn.query("UPDATE tbl_adoption_matches SET status = 'Withdrawn', ended_by = ?, ended_at = NOW(), end_reason = ? WHERE match_id = ?",
      [userId || null, encField(`Application ${target.toLowerCase()}.`), m.match_id]);
    await addEvent(conn, m.match_id, 'withdrawn', m.status, 'Withdrawn', userId, `Application ${target.toLowerCase()}.`);
  }
}

/** Gate for "Trial custody": the approved match must be confirmed with NACC first. */
async function trialBlockers(conn, app) {
  const [[m]] = await conn.query("SELECT status FROM tbl_adoption_matches WHERE application_id = ? AND status IN (?) LIMIT 1", [app.application_id, ACTIVE]);
  if (WF.trackOf(app.application_type) !== 'Regular') return [];
  if (!m) return [{ label: 'Approved match', message: 'There is no approved match for this application.' }];
  if (m.status !== 'NACC confirmed') return [{ label: 'NACC confirmation', message: "Record NACC's referral or confirmation of the match (date and reference) first." }];
  return [];
}

/** The donor sees only that a possible match is being reviewed (never the child's details). */
async function donorNotice(applicationId) {
  const [[m]] = await pool.query('SELECT status FROM tbl_adoption_matches WHERE application_id = ? AND status IN (?) LIMIT 1', [applicationId, ACTIVE]).catch(() => [[null]]);
  return m ? 'A possible match is being reviewed. The home will contact you about the next steps.' : null;
}

// ---------------------------------------------------------------- non-Regular: link and verify

/** POST /adoptions/:id/link { child_id?, note } - the home verified the child and the relationship (assigned Staff, Admin). */
async function verifyLink(req, app0, body) {
  if (WF.trackOf(app0.application_type) === 'Regular') throw new HttpError(400, 'Regular adoptions use matching.');
  const note = str(body?.note);
  if (note.length < 10) throw new HttpError(400, 'Describe how the child and the relationship were verified (at least 10 characters).');
  const childId = str(body?.child_id) || null;
  await withTransaction(async (conn) => {
    const app = await lockApp(conn, app0.application_id);
    if (childId) {
      const [[c]] = await conn.query('SELECT child_id FROM tbl_children WHERE child_id = ?', [childId]);
      if (!c) throw new HttpError(404, 'Child record not found.');
    }
    await conn.query('UPDATE tbl_adoption_applications SET link_child_id = ?, link_verified_at = NOW(), link_verified_by = ?, link_note = ? WHERE application_id = ?',
      [childId, req.user.user_id, encField(note.slice(0, 2000)), app.application_id]);
    await logActivityWith(conn, req, `CHILD_LINK_VERIFIED${childId ? ' (registry child linked)' : ''}`, `Application #${app.application_id}`);
  });
}

module.exports = {
  ACTIVE, CHILD_DOCS, AGE_RANGES, NEEDS_OK, SIBLINGS_OK,
  applicationBlocks, childBlocks, childProfile, compatibility, matchesFor, preview, propose, startReview, approve, recordNacc, withdraw,
  onStatusChange, trialBlockers, donorNotice, verifyLink,
};
