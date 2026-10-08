const { pool } = require('../config/db');
const HttpError = require('../utils/HttpError');
const { oneOf, toInt, trimOrNull, likeParam } = require('../utils/validate');
const { logActivity } = require('../utils/audit');
const { syncFlags } = require('./childController');
const U = require('../services/unlockService');
const { maskName } = require('../config/adoptionSensitive');
const { LOCKED_TRANSITION } = require('../config/transitionSensitive');

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
    TIMESTAMPDIFF(YEAR, c.dob, CURDATE()) AS age
  FROM tbl_transition_reviews tr
  JOIN tbl_children c ON c.child_id = tr.child_id
  LEFT JOIN tbl_users u ON u.user_id = tr.updated_by
  LEFT JOIN tbl_users asu ON asu.user_id = tr.assigned_staff_id
  LEFT JOIN tbl_users aby ON aby.user_id = tr.assigned_by`;

/** Admin: always open. Staff: only the review's assigned staff (active account), during an unlock session. */
async function access(req, row) {
  if (req.user.role === 'Admin') return { unlocked: true, assigned: true, admin: true };
  const assigned = row.assigned_staff_id === req.user.user_id && !!row.assigned_staff_active;
  if (!assigned) return { unlocked: false, assigned: false };
  const s = await U.sessionFor(req, REC, row.review_id);
  return { unlocked: Boolean(s), assigned: true, expires_at: s?.expires_at || null, purpose: s?.purpose || null };
}

/** What everyone may see: case number, age, flagged date, status, masked name. */
function basic(row) {
  return {
    review_id: row.review_id, case_number: row.child_id, age: row.age, flagged_at: row.flagged_at, review_status: row.review_status,
    masked_name: maskName(row.full_name),
    // A deactivated staff account shows as unassigned (Admin sees a flag).
    assigned_staff: row.assigned_staff_id && row.assigned_staff_active ? { user_id: row.assigned_staff_id, name: row.assigned_staff_name } : null,
    assigned_staff_name: row.assigned_staff_active ? row.assigned_staff_name : null,
    assigned_by_name: row.assigned_by_name || null, assigned_at: row.assigned_at || null,
  };
}

function full(row) {
  return {
    ...basic(row), child_id: row.child_id, full_name: row.full_name, gender: row.gender, dob: row.dob, child_status: row.child_status,
    notes: row.notes, housing_goal: row.housing_goal, vocational_goal: row.vocational_goal, education_goal: row.education_goal,
    updated_at: row.updated_at, updated_by_name: row.updated_by_name, informed_at: row.informed_at, informed_by: row.informed_by,
    documents: [],
    assignment_flag: row.assigned_staff_id && !row.assigned_staff_active ? `Assigned to ${row.assigned_staff_name}, whose account is deactivated` : null,
  };
}

async function loadRow(id) {
  const [[row]] = await pool.query(`${SELECT} WHERE tr.review_id = ?`, [id]);
  if (!row) throw new HttpError(404, 'Transition review not found.');
  return row;
}

/**
 * GET /api/transition-reviews?status=&q= - children flagged at 18+ (never discharged automatically).
 * Admin: everything (search by name or case number). Staff: case number, age, flagged date, status
 * and a masked name only; search by case number only, so a name search can't reveal anyone.
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
  if (req.query.q) {
    const p = likeParam(req.query.q);
    if (isAdmin) { where.push('(c.full_name LIKE ? OR c.child_id LIKE ? OR tr.review_status LIKE ?)'); params.push(p, p, p); }
    else { where.push('c.child_id LIKE ?'); params.push(p); }
  }
  const [rows] = await pool.query(`${SELECT} ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
    ORDER BY ${TRANSITION_SORTS[req.query.sort] || TRANSITION_SORTS.recent}`, params);
  if (isAdmin) await logActivity(req, 'VIEW_TRANSITION_REVIEWS (Admin full access)', 'Transition reviews');
  res.json({
    success: true,
    data: rows.map((r) => (isAdmin ? { ...full(r), masked: false } : { ...basic(r), masked: true, assigned_to_me: r.assigned_staff_id === req.user.user_id && !!r.assigned_staff_active })),
  });
};

/** GET /api/transition-reviews/:id - full review only for Admin or the unlocked assigned case worker. */
exports.getOne = async (req, res) => {
  const row = await loadRow(toInt(req.params.id, 'id', { min: 1 }));
  const a = await access(req, row);
  if (!a.unlocked) {
    return res.json({ success: true, data: { ...basic(row), locked: true, sensitive: { unlocked: false, assigned: a.assigned, sections: LOCKED_TRANSITION.map(({ key, label }) => ({ key, label })) } } });
  }
  await logActivity(req, `VIEW_TRANSITION_REVIEW (${a.admin ? 'Admin full access' : 'unlocked'})`, `Child ${row.child_id}`);
  await U.logEvent(req, { recordType: REC, recordId: row.review_id, event: 'view_sections', purpose: a.admin ? 'Admin full access' : a.purpose });
  res.json({ success: true, data: { ...full(row), locked: false, sensitive: { unlocked: true, admin: !!a.admin, expires_at: a.expires_at, purpose: a.purpose } } });
};

/**
 * PUT /api/transition-reviews/:id { review_status, notes, housing_goal, vocational_goal, education_goal, informed_at?, informed_by? }
 * Staff: only the assigned case worker with an active unlock. This never discharges or deletes a record.
 */
exports.update = async (req, res) => {
  const id = toInt(req.params.id, 'id', { min: 1 });
  const row = await loadRow(id);
  const a = await access(req, row);
  if (!a.assigned) throw new HttpError(403, U.NOT_ASSIGNED, { not_assigned: true });
  if (!a.unlocked) throw new HttpError(403, 'Your unlock has ended. Unlock the review again to save. Your changes are still in the form.', { locked: true });
  const b = req.body || {};
  const status = b.review_status ? oneOf(b.review_status, STATUSES, 'review_status') : row.review_status;
  const informedAt = b.informed_at ? String(b.informed_at) : null;
  if (informedAt && !DATE.test(informedAt)) throw new HttpError(400, 'Enter the date the young person was informed.');
  const informedBy = trimOrNull(b.informed_by, 150);
  await pool.query(
    `UPDATE tbl_transition_reviews SET review_status = ?, notes = ?, housing_goal = ?, vocational_goal = ?, education_goal = ?,
            informed_at = ?, informed_by = ?, informed_recorded_by = IF(? IS NULL AND ? IS NULL, informed_recorded_by, ?), updated_by = ?
      WHERE review_id = ?`,
    [status, trimOrNull(b.notes, 10000), trimOrNull(b.housing_goal, 3000), trimOrNull(b.vocational_goal, 3000), trimOrNull(b.education_goal, 3000),
      informedAt, informedBy, informedAt, informedBy, req.user.user_id, req.user.user_id, id]);
  await logActivity(req, status !== row.review_status ? `TRANSITION_${status.toUpperCase().replace(/\s+/g, '_')}` : 'UPDATE_TRANSITION_REVIEW', `Child ${row.child_id}`);
  await U.logEvent(req, { recordType: REC, recordId: id, event: 'edit_saved', purpose: a.admin ? 'Admin full access' : a.purpose, detail: status !== row.review_status ? `status ${row.review_status} -> ${status}` : null });
  const fresh = await loadRow(id);
  res.json({ success: true, data: { ...full(fresh), locked: false, sensitive: { unlocked: true, admin: !!a.admin, expires_at: a.expires_at, purpose: a.purpose } } });
};

/** PUT /api/transition-reviews/:id/assign (Admin) { staff_user_id | null } - shared assignment (services/assignment.js). */
exports.assign = async (req, res) => {
  const id = toInt(req.params.id, 'id', { min: 1 });
  const row = await loadRow(id);
  await require('../services/assignment').assign(req, REC, id, req.body?.staff_user_id, row.child_id);
  const fresh = await loadRow(id);
  res.json({ success: true, data: { ...full(fresh), locked: false, sensitive: { unlocked: true, admin: true } } });
};
