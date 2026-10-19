const { pool } = require('../config/db');
const { likeParam } = require('../utils/validate');

const COLS = `i.item_id, i.item_name, i.category, i.quantity, i.min_threshold,
              i.is_needed_by_donors, i.updated_at, u.full_name AS last_updated_by_name, i.archived_at, i.archive_reason,
              (i.quantity <= i.min_threshold) AS is_low_stock`;

module.exports = {
  async list({ lowOnly, search, archived = false } = {}) {
    const where = [archived ? 'i.archived_at IS NOT NULL' : 'i.archived_at IS NULL']; // archived items (migration 034) are kept, listed apart
    const params = [];
    if (lowOnly) where.push('i.quantity <= i.min_threshold');
    if (search) { where.push('(i.item_name LIKE ? OR i.category LIKE ?)'); const p = likeParam(search); params.push(p, p); }
    const [rows] = await pool.query(
      `SELECT ${COLS} FROM tbl_inventory i LEFT JOIN tbl_users u ON u.user_id = i.last_updated_by
       ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
       ORDER BY (i.quantity <= i.min_threshold) DESC, i.category, i.item_name`, params);
    return rows;
  },
  async findById(id) {
    const [rows] = await pool.query(
      `SELECT ${COLS} FROM tbl_inventory i LEFT JOIN tbl_users u ON u.user_id = i.last_updated_by
        WHERE i.item_id = ?`, [id]);
    return rows[0] || null;
  },
  async lowStockCount() {
    const [rows] = await pool.query('SELECT COUNT(*) AS n FROM tbl_inventory WHERE archived_at IS NULL AND quantity <= min_threshold');
    return Number(rows[0].n);
  },
  async neededByDonors() {
    const [rows] = await pool.query(
      `SELECT item_id, item_name, category, quantity, min_threshold,
              (quantity <= min_threshold) AS is_low_stock, updated_at
         FROM tbl_inventory
        WHERE archived_at IS NULL AND (is_needed_by_donors = TRUE OR quantity <= min_threshold)
        ORDER BY (quantity <= min_threshold) DESC, (quantity / GREATEST(min_threshold, 1)) ASC`);
    return rows;
  },
  async create(item) {
    const [res] = await pool.query(
      `INSERT INTO tbl_inventory
         (item_name, category, quantity, min_threshold, is_needed_by_donors, last_updated_by)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [item.item_name, item.category, item.quantity, item.min_threshold,
        item.is_needed_by_donors, item.last_updated_by]);
    return res.insertId;
  },
  /** Items are never deleted (migration 034): archived with the reason; stock history and donation links stay valid. */
  async archive(id, userId, reason) {
    await pool.query('UPDATE tbl_inventory SET archived_at = NOW(), archived_by = ?, archive_reason = ? WHERE item_id = ? AND archived_at IS NULL', [userId, reason, id]);
  },
  async restore(id) {
    await pool.query('UPDATE tbl_inventory SET archived_at = NULL, archived_by = NULL, archive_reason = NULL WHERE item_id = ?', [id]);
  },
};
