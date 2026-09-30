const { pool } = require('../config/db');

const SELECT = `SELECT s.schedule_id, s.user_id, u.full_name, s.shift_date, s.start_time, s.end_time,
                       s.assignment, s.created_at
                  FROM tbl_staff_schedules s JOIN tbl_users u ON u.user_id = s.user_id`;

module.exports = {
  async list({ from, to, userId }) {
    const params = [from, to];
    let sql = `${SELECT} WHERE s.shift_date BETWEEN ? AND ?`;
    if (userId) { sql += ' AND s.user_id = ?'; params.push(userId); }
    sql += ' ORDER BY s.shift_date, s.start_time, u.full_name';
    const [rows] = await pool.query(sql, params);
    return rows;
  },
  async findById(id) {
    const [rows] = await pool.query(`${SELECT} WHERE s.schedule_id = ?`, [id]);
    return rows[0] || null;
  },
  async hasOverlap({ user_id, shift_date, start_time, end_time, excludeId }) {
    const [rows] = await pool.query(
      `SELECT 1 FROM tbl_staff_schedules
        WHERE user_id = ? AND shift_date = ? AND start_time < ? AND end_time > ?
          ${excludeId ? 'AND schedule_id <> ?' : ''} LIMIT 1`,
      excludeId ? [user_id, shift_date, end_time, start_time, excludeId] : [user_id, shift_date, end_time, start_time]);
    return rows.length > 0;
  },
  async create(s) {
    const [res] = await pool.query(
      `INSERT INTO tbl_staff_schedules (user_id, shift_date, start_time, end_time, assignment, created_by)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [s.user_id, s.shift_date, s.start_time, s.end_time, s.assignment, s.created_by]);
    return res.insertId;
  },
  async update(id, s) {
    await pool.query(
      `UPDATE tbl_staff_schedules SET user_id = ?, shift_date = ?, start_time = ?, end_time = ?, assignment = ?
        WHERE schedule_id = ?`,
      [s.user_id, s.shift_date, s.start_time, s.end_time, s.assignment, id]);
  },
  async remove(id) {
    await pool.query('DELETE FROM tbl_staff_schedules WHERE schedule_id = ?', [id]);
  },
};
