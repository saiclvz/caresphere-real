const { pool } = require('../config/db');
const { likeParam } = require('../utils/validate');

const COLS = `v.visitor_id, v.visitor_name, v.contact_number, v.purpose, v.check_in_time, v.check_out_time,
  u.full_name AS logged_by_name`;

module.exports = {
  async list({ date, openOnly, search } = {}) {
    const where = [];
    const params = [];
    if (date) { where.push('DATE(v.check_in_time) = ?'); params.push(date); }
    if (openOnly) where.push('v.check_out_time IS NULL');
    if (search) {
      where.push('(v.visitor_name LIKE ? OR v.purpose LIKE ? OR v.contact_number LIKE ?)');
      const p = likeParam(search);
      params.push(p, p, p);
    }
    const [rows] = await pool.query(
      `SELECT ${COLS} FROM tbl_visitors v LEFT JOIN tbl_users u ON u.user_id = v.logged_by
        ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
        ORDER BY v.check_out_time IS NULL DESC, v.check_in_time DESC LIMIT 500`, params);
    return rows;
  },
  async findById(id) {
    const [rows] = await pool.query(`SELECT ${COLS} FROM tbl_visitors v LEFT JOIN tbl_users u ON u.user_id = v.logged_by
      WHERE v.visitor_id = ?`, [id]);
    return rows[0] || null;
  },
  async create(v) {
    const [res] = await pool.query(
      `INSERT INTO tbl_visitors (visitor_name, contact_number, purpose, check_in_time, logged_by)
       VALUES (?, ?, ?, COALESCE(?, NOW()), ?)`,
      [v.visitor_name, v.contact_number, v.purpose, v.check_in_time, v.logged_by]);
    return res.insertId;
  },
  async update(id, fields) {
    const keys = Object.keys(fields);
    if (!keys.length) return;
    await pool.query(`UPDATE tbl_visitors SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE visitor_id = ?`,
      [...keys.map((k) => fields[k]), id]);
  },
  async checkOut(id, time) {
    await pool.query('UPDATE tbl_visitors SET check_out_time = COALESCE(?, NOW()) WHERE visitor_id = ?', [time, id]);
  },
  async remove(id) {
    await pool.query('DELETE FROM tbl_visitors WHERE visitor_id = ?', [id]);
  },
};
