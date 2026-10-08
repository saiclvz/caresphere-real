const { pool } = require('../config/db');

/**
 * Shifts with their area, note and "ends next day" flag. Flags for the week view: the staff account is
 * deactivated, the account isn't Staff (older shifts could be given to Admins), or the area text was
 * never matched to the area list.
 */
const SELECT = `SELECT s.schedule_id, s.user_id, u.full_name, s.shift_date, s.start_time, s.end_time, s.ends_next_day,
                       s.assignment, s.area_id, a.name AS area_name, s.note, s.batch_id, s.created_at,
                       (u.is_active = FALSE) AS staff_inactive, (r.role_name <> 'Staff') AS not_staff, (s.area_id IS NULL) AS area_unmapped
                  FROM tbl_staff_schedules s JOIN tbl_users u ON u.user_id = s.user_id JOIN tbl_roles r ON r.role_id = u.role_id
                  LEFT JOIN tbl_schedule_areas a ON a.area_id = s.area_id`;
const shape = (r) => ({ ...r, ends_next_day: !!r.ends_next_day, staff_inactive: !!r.staff_inactive, not_staff: !!r.not_staff, area_unmapped: !!r.area_unmapped,
  area_label: r.area_name || r.assignment });

module.exports = {
  async list({ from, to, userId }) {
    const params = [from, to];
    let sql = `${SELECT} WHERE s.shift_date BETWEEN ? AND ?`;
    if (userId) { sql += ' AND s.user_id = ?'; params.push(userId); }
    sql += ' ORDER BY s.shift_date, s.start_time, u.full_name';
    const [rows] = await pool.query(sql, params);
    return rows.map(shape);
  },
  async findById(id) {
    const [rows] = await pool.query(`${SELECT} WHERE s.schedule_id = ?`, [id]);
    return rows[0] ? shape(rows[0]) : null;
  },
  /** Which kinds of records each staff member is assigned (for small icons on shift cards; counts only). */
  async assignedAreas(userIds) {
    if (!userIds.length) return {};
    const [rows] = await pool.query(
      `SELECT user_id, SUM(kind = 'health') AS health, SUM(kind = 'adoption') AS adoption, SUM(kind = 'transition') AS transition FROM (
         SELECT assigned_staff_id AS user_id, 'health' AS kind FROM tbl_children WHERE assigned_staff_id IN (?) AND status = 'Active'
         UNION ALL SELECT assigned_staff_id, 'adoption' FROM tbl_adoption_applications WHERE assigned_staff_id IN (?) AND status NOT IN ('Draft', 'Closed', 'Declined', 'Withdrawn')
         UNION ALL SELECT assigned_staff_id, 'transition' FROM tbl_transition_reviews WHERE assigned_staff_id IN (?) AND review_status <> 'Completed'
       ) x GROUP BY user_id`, [userIds, userIds, userIds]);
    return Object.fromEntries(rows.map((r) => [r.user_id, { health: Number(r.health) > 0, adoption: Number(r.adoption) > 0, transition: Number(r.transition) > 0 }]));
  },
};
