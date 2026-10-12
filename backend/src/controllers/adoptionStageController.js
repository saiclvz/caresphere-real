/**
 * The adoption case stages (services/adoptionStages.js), the walk-in case opened by staff, and the PAP
 * answers staff enter for it. Same access rules as the rest of the case: Admin always (logged); Staff only
 * when assigned and unlocked. Admin-only stages are checked in the service.
 */
const { pool, withTransaction } = require('../config/db');
const HttpError = require('../utils/HttpError');
const Adoption = require('../models/adoptionModel');
const { logActivity, logActivityWith } = require('../utils/audit');
const { APPLICATION_TYPES } = require('../config/adoptionForm');
const { clean, completedPages } = require('../services/adoptionValidation');
const Stages = require('../services/adoptionStages');
const Notify = require('../services/notifications');

const C = () => require('./adoptionController')._detail;
const S = require('../config/adoptionSensitive');

/** The case, with the same checks as every sensitive action (assigned + unlocked, or Admin). */
async function load(req) {
  const { loadById, requireSensitive } = C();
  const app = await loadById(req);
  await requireSensitive(req, app, 'This part of the case');
  return app;
}
const ok = (res, extra = {}) => res.json({ success: true, data: { ok: true, ...extra } });

/** POST /api/adoptions/:id/stages/:key/record { data } */
exports.saveRecord = async (req, res) => { const app = await load(req); await Stages.saveRecord(req, app, String(req.params.key), req.body?.data); ok(res); };
/** POST /api/adoptions/:id/stages/:key/entries { data } */
exports.addEntry = async (req, res) => { const app = await load(req); await Stages.addEntry(req, app, String(req.params.key), req.body?.data); ok(res); };
/** POST /api/adoptions/:id/stages/:key/proceed { status } - validated by the workflow gate. */
exports.proceed = async (req, res) => {
  const app = await load(req);
  const target = String(req.body?.status || '');
  const r = await Stages.proceed(req, app, String(req.params.key), target);
  await logActivity(req, `ADOPTION_STATUS (${app.status} -> ${target})`, `Application #${app.application_id}`);
  ok(res, { status: target, last_history_id: r.historyId });
};
/** PUT /api/adoptions/:id/case-child { child_id } - the existing child a Regular case is for. */
exports.setChild = async (req, res) => { const app = await load(req); await Stages.setChild(req, app, req.body?.child_id); ok(res); };
/** PUT /api/adoptions/:id/eligibility { data } - the case child's adoption eligibility. */
exports.saveEligibility = async (req, res) => { const app = await load(req); await Stages.saveEligibility(req, app, req.body?.data); ok(res); };

/**
 * PUT /api/adoptions/:id/pap-answers { data } - the application answers for a case opened by staff (walk-in).
 * Same definitions and cleaning as the applicant's own form. Donor-submitted answers are never edited here.
 */
exports.papAnswers = async (req, res) => {
  const app = await load(req);
  if (!app.created_by_staff) throw new HttpError(409, "The applicant submitted these answers. Ask the applicant to correct them (Request correction).");
  if (app.archived_at || ['Declined', 'Withdrawn', 'Closed'].includes(app.status)) throw new HttpError(409, 'This case is read-only.');
  const data = clean(req.body?.data);
  let done = [];
  await withTransaction(async (conn) => {
    await conn.query('SELECT application_id FROM tbl_adoption_applications WHERE application_id = ? FOR UPDATE', [app.application_id]);
    await Adoption.saveForm(conn, app.application_id, data);
    const form = await Adoption.form(app.application_id);
    done = completedPages(form, app.application_type, await Adoption.documents(app.application_id, conn));
    await conn.query('UPDATE tbl_adoption_applications SET completed_pages = ? WHERE application_id = ?', [done.join(','), app.application_id]);
    await logActivityWith(conn, req, 'PAP_ANSWERS_SAVED (walk-in case)', `Application #${app.application_id}`);
    // The government ID and clearance checks follow the answers, as for an applicant's own submission.
    await require('../services/verification').syncFromForm(conn, app, form, req.user.user_id);
  });
  ok(res, { completed_pages: done });
};

/** GET /api/adoption-applicants?q= (Admin, Staff) - existing applicant accounts for a walk-in case (no new person is created). */
exports.applicants = async (req, res) => {
  const q = String(req.query.q || '').trim();
  if (q.length < 2) { res.json({ success: true, data: [] }); return; }
  const [rows] = await pool.query(
    `SELECT u.user_id, u.full_name, u.email,
            (SELECT a.reference_no FROM tbl_adoption_applications a WHERE a.applicant_id = u.user_id AND a.status NOT IN ('Declined', 'Withdrawn', 'Closed') LIMIT 1) AS active_reference
       FROM tbl_users u JOIN tbl_roles r ON r.role_id = u.role_id
      WHERE r.role_name = 'Donor' AND u.is_active = TRUE AND (u.full_name LIKE ? OR u.email LIKE ?) ORDER BY u.full_name LIMIT 15`, [`%${q}%`, `%${q}%`]);
  const isAdmin = req.user.role === 'Admin';
  // Staff see a masked name and email (they are not yet assigned to anything for this person).
  res.json({ success: true, data: rows.map((r) => ({ user_id: r.user_id, name: isAdmin ? r.full_name : S.maskName(r.full_name), email: isAdmin ? r.email : r.email.replace(/^(.).*(@.*)$/, '$1***$2'), active_reference: r.active_reference })) });
};

/**
 * POST /api/adoptions/staff-case (Admin, Staff with the adoption duty) { applicant_user_id, application_type, child_id? }
 * Opens a case for a walk-in applicant who already has an account. One active case per applicant (as for the
 * applicant's own). The child, if given, is the existing child record. The case starts at Inquiry (Submitted);
 * staff enter the PAP answers in the PAP application stage, and the applicant's signed consent is recorded there.
 * A Staff member who opens a case is assigned to it.
 */
exports.createStaffCase = async (req, res) => {
  const applicantId = Number(req.body?.applicant_user_id);
  const type = String(req.body?.application_type || 'Regular');
  const childId = req.body?.child_id ? String(req.body.child_id).trim() : null;
  if (!Number.isInteger(applicantId) || applicantId < 1) throw new HttpError(400, "Choose the applicant's account.");
  if (!APPLICATION_TYPES[type]) throw new HttpError(400, 'Choose an adoption type from the list.');
  const result = await withTransaction(async (conn) => {
    const [[u]] = await conn.query(
      "SELECT u.user_id, u.full_name, u.email FROM tbl_users u JOIN tbl_roles r ON r.role_id = u.role_id WHERE u.user_id = ? AND r.role_name = 'Donor' AND u.is_active = TRUE", [applicantId]);
    if (!u) throw new HttpError(404, 'Applicant account not found. The applicant needs an active account first.');
    const active = await Adoption.activeFor(conn, applicantId);
    if (active) throw new HttpError(409, `This applicant already has an active case (${active.reference_no || 'draft'}, ${active.status}).`, { existing_application_id: active.application_id });
    if (childId) {
      const [[c]] = await conn.query("SELECT child_id, status, TIMESTAMPDIFF(YEAR, dob, CURDATE()) AS age FROM tbl_children WHERE child_id = ?", [childId]);
      if (!c) throw new HttpError(404, 'Child record not found. Choose a child from Children Management.');
      if (c.status !== 'Active' || Number(c.age) >= 18) throw new HttpError(409, 'Choose an active child under 18.');
    }
    const id = await Adoption.createDraft(conn, u, type);
    const ref = await Adoption.nextReference(conn);
    const staffId = req.user.role === 'Staff' ? req.user.user_id : null;
    const regular = APPLICATION_TYPES[type].track === 'Regular';
    await conn.query(
      `UPDATE tbl_adoption_applications SET status = 'Submitted', reference_no = ?, submitted_at = NOW(), created_by_staff = ?,
              target_child_id = ?, link_child_id = ?, current_page = 9 WHERE application_id = ?`,
      [ref, req.user.user_id, regular ? childId : null, regular ? null : childId, id]);
    if (staffId) await conn.query('UPDATE tbl_adoption_applications SET assigned_staff_id = ?, assigned_by = ?, assigned_at = NOW() WHERE application_id = ?', [staffId, staffId, id]);
    await Adoption.addHistory(conn, { application_id: id, from_status: 'Draft', to_status: 'Submitted', changed_by: req.user.user_id });
    await conn.query("INSERT INTO tbl_adoption_stage_events (application_id, stage_key, action, summary, actor_id) VALUES (?, 'inquiry', 'case_opened', 'Case opened by staff for a walk-in applicant', ?)", [id, req.user.user_id]);
    await Notify.toAdmins(conn, 'admin_application_submitted', { entityType: 'application', entityId: id, params: { id, ref }, groupKey: `admin_submitted:${id}`, exceptUserId: req.user.user_id });
    return { id, ref };
  });
  await logActivity(req, `ADOPTION_CASE_OPENED_BY_STAFF (${result.ref}, ${type})`, `Application #${result.id}`);
  res.status(201).json({ success: true, data: { application_id: result.id, reference_no: result.ref } });
};
