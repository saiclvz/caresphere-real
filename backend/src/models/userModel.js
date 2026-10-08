const { pool } = require('../config/db');

const BASE = `SELECT u.user_id, u.full_name, u.email, u.is_active, u.created_at, u.mfa_enabled, r.role_name AS role
                FROM tbl_users u JOIN tbl_roles r ON r.role_id = u.role_id`;

/** Adds each Staff account's duties (the areas they may use). */
async function withDuties(rows) {
  const staff = rows.filter((r) => r.role === 'Staff').map((r) => r.user_id);
  if (!staff.length) return rows;
  const [d] = await pool.query('SELECT user_id, duty FROM tbl_staff_duties WHERE user_id IN (?)', [staff]);
  return rows.map((r) => (r.role === 'Staff' ? { ...r, duties: d.filter((x) => x.user_id === r.user_id).map((x) => x.duty) } : r));
}

module.exports = {
  async findByEmailWithHash(email) {
    const [rows] = await pool.query(
      `SELECT u.user_id, u.full_name, u.email, u.password_hash, u.is_active, u.mfa_enabled, r.role_name AS role
         FROM tbl_users u JOIN tbl_roles r ON r.role_id = u.role_id WHERE u.email = ?`, [email]);
    return rows[0] || null;
  },
  async findById(id) {
    const [rows] = await pool.query(`${BASE} WHERE u.user_id = ?`, [id]);
    return rows[0] ? (await withDuties(rows))[0] : null;
  },
  /** Replaces a Staff account's duties (in the caller's transaction). */
  async setDuties(conn, userId, duties, grantedBy) {
    await conn.query('DELETE FROM tbl_staff_duties WHERE user_id = ?', [userId]);
    for (const d of duties) await conn.query('INSERT INTO tbl_staff_duties (user_id, duty, granted_by) VALUES (?, ?, ?)', [userId, d, grantedBy || null]);
  },
  async list({ role } = {}) {
    const params = [];
    let sql = BASE;
    if (role) { sql += ' WHERE r.role_name = ?'; params.push(role); }
    sql += ' ORDER BY u.full_name';
    const [rows] = await pool.query(sql, params);
    return withDuties(rows);
  },
  async roleId(roleName) {
    const [rows] = await pool.query('SELECT role_id FROM tbl_roles WHERE role_name = ?', [roleName]);
    return rows[0]?.role_id || null;
  },
  async create({ full_name, email, password_hash, role_id }, conn = pool) {
    const [res] = await conn.query(
      'INSERT INTO tbl_users (full_name, email, password_hash, role_id) VALUES (?, ?, ?, ?)',
      [full_name, email, password_hash, role_id]);
    return res.insertId;
  },
  async update(id, fields) {
    const keys = Object.keys(fields);
    if (!keys.length) return;
    await pool.query(`UPDATE tbl_users SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE user_id = ?`,
      [...keys.map((k) => fields[k]), id]);
  },
  /**
   * Activates or deactivates an account. Deactivating also ends every existing session
   * (tokens issued before now stop working) and cancels any pending MFA sign-in.
   * Data and history are kept.
   */
  async setActive(id, active, conn = pool) {
    if (active) {
      await conn.query('UPDATE tbl_users SET is_active = TRUE WHERE user_id = ?', [id]);
      return;
    }
    await conn.query('UPDATE tbl_users SET is_active = FALSE, tokens_valid_after = NOW() WHERE user_id = ?', [id]);
    await conn.query('UPDATE tbl_mfa_challenges SET consumed_at = NOW() WHERE user_id = ? AND consumed_at IS NULL', [id]);
  },
  async countActiveAdmins() {
    const [rows] = await pool.query(
      `SELECT COUNT(*) AS n FROM tbl_users u JOIN tbl_roles r ON r.role_id = u.role_id
        WHERE r.role_name = 'Admin' AND u.is_active = TRUE`);
    return Number(rows[0].n);
  },
};
