const { pool } = require('../config/db');
const { likeParam } = require('../utils/validate');

function buildWhere({ userId, entity, action, from, to, search }) {
  const where = [];
  const params = [];
  if (userId) { where.push('l.user_id = ?'); params.push(userId); }
  if (entity) { where.push('l.target_entity LIKE ?'); params.push(`${entity}%`); }
  if (action) { where.push('l.action_performed LIKE ?'); params.push(`%${action}%`); }
  if (from) { where.push('DATE(l.timestamp) >= ?'); params.push(from); }
  if (to) { where.push('DATE(l.timestamp) <= ?'); params.push(to); }
  if (search) {
    where.push('(l.action_performed LIKE ? OR l.target_entity LIKE ? OR u.full_name LIKE ?)');
    const p = likeParam(search);
    params.push(p, p, p);
  }
  return { sql: where.length ? `WHERE ${where.join(' AND ')}` : '', params };
}

const SELECT = `SELECT l.log_id, l.user_id, u.full_name, r.role_name AS role, l.action_performed,
                       l.target_entity, l.ip_address, l.timestamp
                  FROM tbl_activity_logs l
                  JOIN tbl_users u ON u.user_id = l.user_id
                  JOIN tbl_roles r ON r.role_id = u.role_id`;

module.exports = {
  async list(filters, { page = 1, pageSize = 50 } = {}) {
    const { sql, params } = buildWhere(filters);
    const [[{ total }]] = await pool.query(
      `SELECT COUNT(*) AS total FROM tbl_activity_logs l JOIN tbl_users u ON u.user_id = l.user_id ${sql}`, params);
    const offset = (page - 1) * pageSize;
    const [rows] = await pool.query(
      `${SELECT} ${sql} ORDER BY l.timestamp DESC, l.log_id DESC LIMIT ${Number(pageSize)} OFFSET ${Number(offset)}`,
      params);
    return { rows, total: Number(total), page, pageSize };
  },
  async all(filters, limit = 50000) {
    const { sql, params } = buildWhere(filters);
    const [rows] = await pool.query(
      `${SELECT} ${sql} ORDER BY l.timestamp DESC, l.log_id DESC LIMIT ${Number(limit)}`, params);
    return rows;
  },
};
