const { pool, withTransaction } = require('../config/db');
const { likeParam } = require('../utils/validate');

// Staff see children's full names; donors only ever see a privacy name.
const CHILDREN_STAFF = `(SELECT GROUP_CONCAT(c.full_name ORDER BY c.first_name SEPARATOR ', ')
    FROM tbl_donation_children dc JOIN tbl_children c ON c.child_id = dc.child_id WHERE dc.donation_id = d.donation_id)`;
const CHILDREN_PUBLIC = `(SELECT GROUP_CONCAT(CONCAT(c.first_name, ' ', LEFT(c.last_name, 1), '.') ORDER BY c.first_name SEPARATOR ', ')
    FROM tbl_donation_children dc JOIN tbl_children c ON c.child_id = dc.child_id WHERE dc.donation_id = d.donation_id)`;

const COLS = `d.donation_id, d.donor_id, d.donor_name, d.amount, d.payment_method, d.status, d.item_description,
  d.reason_for_donation, d.submitted_by_donor, d.allocation_notes, d.qr_receipt_code, d.created_at, d.received_at`;

module.exports = {
  async list({ donorId, from, to, status, search, forDonor = false } = {}) {
    const where = [];
    const params = [];
    if (donorId) { where.push('d.donor_id = ?'); params.push(donorId); }
    if (status) { where.push('d.status = ?'); params.push(status); }
    if (from) { where.push('DATE(d.created_at) >= ?'); params.push(from); }
    if (to) { where.push('DATE(d.created_at) <= ?'); params.push(to); }
    if (search) {
      where.push('(d.donor_name LIKE ? OR d.payment_method LIKE ? OR d.status LIKE ? OR d.qr_receipt_code LIKE ? OR d.reason_for_donation LIKE ?)');
      const p = likeParam(search);
      params.push(p, p, p, p, p);
    }
    const [rows] = await pool.query(
      `SELECT ${COLS}, ${forDonor ? CHILDREN_PUBLIC : CHILDREN_STAFF} AS supported_children
         FROM tbl_donations d ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
        ORDER BY d.created_at DESC, d.donation_id DESC`, params);
    return rows;
  },

  async findById(id, { forDonor = false } = {}) {
    const [rows] = await pool.query(
      `SELECT ${COLS}, ${forDonor ? CHILDREN_PUBLIC : CHILDREN_STAFF} AS supported_children
         FROM tbl_donations d WHERE d.donation_id = ?`, [id]);
    return rows[0] || null;
  },

  async findByReceipt(code) {
    const [rows] = await pool.query('SELECT * FROM tbl_donations WHERE qr_receipt_code = ?', [code]);
    return rows[0] || null;
  },

  async findByIdempotencyKey(donorId, key) {
    const [rows] = await pool.query('SELECT donation_id FROM tbl_donations WHERE idempotency_key = ? AND donor_id = ?', [key, donorId]);
    return rows[0]?.donation_id || null;
  },

  /** Inserts the donation and its supported children atomically. */
  async create(d) {
    return withTransaction(async (conn) => {
      const [res] = await conn.query(
        `INSERT INTO tbl_donations (donor_id, donor_name, amount, payment_method, status, item_description,
           reason_for_donation, submitted_by_donor, allocation_notes, qr_receipt_code, idempotency_key, received_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ${d.status === 'Received' ? 'NOW()' : 'NULL'})`,
        [d.donor_id, d.donor_name, d.amount, d.payment_method, d.status, d.item_description || null,
          d.reason_for_donation || null, d.submitted_by_donor ? 1 : 0, d.allocation_notes || null, d.qr_receipt_code,
          d.idempotency_key || null]);
      for (const childId of d.child_ids || []) {
        await conn.query('INSERT INTO tbl_donation_children (donation_id, child_id) VALUES (?, ?)', [res.insertId, childId]);
      }
      return res.insertId;
    });
  },

  async setStatus(id, status) {
    await pool.query(
      `UPDATE tbl_donations SET status = ?, received_at = ${status === 'Received' ? 'NOW()' : 'received_at'} WHERE donation_id = ?`,
      [status, id]);
  },

  async updateAllocation(id, notes) {
    await pool.query('UPDATE tbl_donations SET allocation_notes = ? WHERE donation_id = ?', [notes, id]);
  },

  async remove(id) {
    await pool.query('DELETE FROM tbl_donations WHERE donation_id = ?', [id]);
  },

  async donorTotals(donorId) {
    const [rows] = await pool.query(
      `SELECT COUNT(*) AS donation_count,
              COALESCE(SUM(CASE WHEN status = 'Received' THEN amount END), 0) AS total_amount,
              SUM(status = 'Pending') AS pending_count,
              MAX(created_at) AS last_donation_at
         FROM tbl_donations WHERE donor_id = ?`, [donorId]);
    return rows[0];
  },
};
