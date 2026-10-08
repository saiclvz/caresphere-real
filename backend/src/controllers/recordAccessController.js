/**
 * Staff schedules > Record access (Admin only): who is assigned to which health (child case worker),
 * adoption and transition records, unassigned records, and bulk assignment through the same shared
 * assignment logic as the record pages. Reference and case numbers only; no names of children or
 * applicants. This page gives Staff no extra access: unlocking still needs the purpose step and QR token.
 */
const { pool, withTransaction } = require('../config/db');
const HttpError = require('../utils/HttpError');
const { logActivity } = require('../utils/audit');
const { assignWith } = require('../services/assignment');

const OPEN_ADOPTION = "a.status NOT IN ('Draft', 'Closed', 'Declined', 'Withdrawn') AND a.archived_at IS NULL";
const AREAS = {
  health: { type: 'child', sql: `SELECT c.child_id AS id, c.child_id AS ref, c.assigned_staff_id, u.is_active, u.full_name AS staff FROM tbl_children c LEFT JOIN tbl_users u ON u.user_id = c.assigned_staff_id WHERE c.status = 'Active'`,
    link: (id) => `/children/${encodeURIComponent(id)}` },
  adoption: { type: 'adoption_application', sql: `SELECT a.application_id AS id, a.reference_no AS ref, a.assigned_staff_id, u.is_active, u.full_name AS staff, a.status FROM tbl_adoption_applications a LEFT JOIN tbl_users u ON u.user_id = a.assigned_staff_id WHERE ${OPEN_ADOPTION}`,
    link: (id) => `/adoptions/${id}` },
  transition: { type: 'transition_review', sql: `SELECT tr.review_id AS id, tr.child_id AS ref, tr.assigned_staff_id, u.is_active, u.full_name AS staff, tr.review_status AS status FROM tbl_transition_reviews tr LEFT JOIN tbl_users u ON u.user_id = tr.assigned_staff_id WHERE tr.review_status <> 'Completed'`,
    link: (id) => `/transition-reviews/${id}` },
};
const cleanArea = (a) => { if (a && !AREAS[a]) throw new HttpError(400, 'Choose Health, Adoption or Transition.'); return a || null; };

async function load(area) {
  const out = {};
  for (const key of Object.keys(AREAS)) {
    if (area && key !== area) continue;
    const [rows] = await pool.query(AREAS[key].sql);
    out[key] = rows.map((r) => ({ area: key, id: r.id, ref: r.ref, status: r.status || null, assigned_staff_id: r.assigned_staff_id, staff_active: !!r.is_active, link: AREAS[key].link(r.id) }));
  }
  return out;
}

/** GET /api/record-access?area=&user_id= (Admin) - active Staff with counts, their records, and unassigned records. */
exports.overview = async (req, res) => {
  const area = cleanArea(req.query.area);
  const userFilter = req.query.user_id ? Number(req.query.user_id) : null;
  const [staff] = await pool.query("SELECT u.user_id, u.full_name FROM tbl_users u JOIN tbl_roles r ON r.role_id = u.role_id WHERE r.role_name = 'Staff' AND u.is_active = TRUE ORDER BY u.full_name");
  const [sessions] = await pool.query('SELECT user_id, COUNT(*) AS n FROM tbl_unlock_sessions WHERE ended_at IS NULL AND expires_at > NOW() GROUP BY user_id');
  const active = Object.fromEntries(sessions.map((s) => [s.user_id, Number(s.n)]));
  const records = await load(area);
  const all = Object.values(records).flat();
  const rows = staff.filter((s) => !userFilter || s.user_id === userFilter).map((s) => {
    const mine = all.filter((r) => r.assigned_staff_id === s.user_id);
    return {
      user_id: s.user_id, full_name: s.full_name, active_sessions: active[s.user_id] || 0,
      counts: { health: mine.filter((r) => r.area === 'health').length, adoption: mine.filter((r) => r.area === 'adoption').length, transition: mine.filter((r) => r.area === 'transition').length },
      records: mine.map(({ area: a, id, ref, status, link }) => ({ area: a, id, ref, status, link })),
    };
  });
  // Unassigned, or assigned to a deactivated account ("needs reassignment").
  const unassigned = Object.fromEntries(Object.entries(records).map(([k, list]) => [k, list.filter((r) => !r.assigned_staff_id || !r.staff_active)
    .map(({ id, ref, status, link, assigned_staff_id }) => ({ id, ref, status, link, needs_reassignment: Boolean(assigned_staff_id) }))]));
  await logActivity(req, `VIEW_RECORD_ACCESS (${area || 'all areas'})`, 'Staff schedules');
  res.json({ success: true, data: { staff: rows, unassigned, all_staff: staff } });
};

/**
 * POST /api/record-access/assign (Admin) { area, ids: [...], staff_user_id | null }
 * Assigns, reassigns or unassigns several records at once, in one transaction, through the shared
 * assignment logic (same rules, notifications and audit entries as the record pages).
 */
exports.assign = async (req, res) => {
  const area = cleanArea(String(req.body?.area || ''));
  if (!area) throw new HttpError(400, 'Choose Health, Adoption or Transition.');
  const ids = [...new Set((Array.isArray(req.body?.ids) ? req.body.ids : []).map(String).filter(Boolean))];
  if (!ids.length || ids.length > 100) throw new HttpError(400, 'Choose 1 to 100 records.');
  const { type } = AREAS[area];
  const refs = await load(area);
  const known = new Map(refs[area].map((r) => [String(r.id), r.ref]));
  const missing = ids.filter((id) => !known.has(id));
  if (missing.length) throw new HttpError(400, 'Some records are no longer open for assignment. Reload the list.');
  await withTransaction(async (conn) => {
    for (const id of ids) await assignWith(conn, req, type, area === 'health' ? id : Number(id), req.body?.staff_user_id, known.get(id));
  });
  res.json({ success: true, data: { changed: ids.length } });
};
