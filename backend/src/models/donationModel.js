const { pool, withTransaction } = require('../config/db');
const { likeParam } = require('../utils/validate');

// Staff see children's full names; donors only ever see a privacy name.
const CHILDREN_STAFF = `(SELECT GROUP_CONCAT(c.full_name ORDER BY c.first_name SEPARATOR ', ')
    FROM tbl_donation_children dc JOIN tbl_children c ON c.child_id = dc.child_id WHERE dc.donation_id = d.donation_id)`;
const CHILDREN_PUBLIC = `(SELECT GROUP_CONCAT(CONCAT(c.first_name, ' ', LEFT(c.last_name, 1), '.') ORDER BY c.first_name SEPARATOR ', ')
    FROM tbl_donation_children dc JOIN tbl_children c ON c.child_id = dc.child_id WHERE dc.donation_id = d.donation_id)`;
const ITEMS = `(SELECT GROUP_CONCAT(CONCAT(i.item_name, ' x', di.quantity) ORDER BY i.item_name SEPARATOR ', ')
    FROM tbl_donation_items di JOIN tbl_inventory i ON i.item_id = di.inventory_item_id WHERE di.donation_id = d.donation_id)`;

const COLS = `d.donation_id, d.donor_id, d.donor_type, d.walk_in_name, d.walk_in_contact, d.visit_id, d.donor_name, d.source,
  d.amount, d.payment_method, d.status, d.item_description, d.reason_for_donation, d.reason_category, d.is_general,
  d.submitted_by_donor, d.allocation_notes, d.qr_receipt_code, d.receipt_issued, d.created_at, d.received_at,
  (SELECT vl.check_in_time FROM tbl_visitors vl WHERE vl.visitor_id = d.visit_id) AS linked_visit_time`;

/**
 * Source filter labels (Donations page badge):
 *   portal = the donor's own Donate page, walk_in = any walk-in donor (either page),
 *   staff  = a registered donor's gift recorded by staff (bank transfer, event, mail).
 */
const SOURCE_GROUPS = {
  portal: "d.source = 'portal'",
  walk_in: "d.donor_type = 'walk_in'",
  staff: "d.donor_type = 'registered' AND d.source <> 'portal'",
};

/** One WHERE builder for the list, the totals, the dashboard and donor history, so they always agree. */
function buildWhere({ donorId, from, to, status, source, method, receipt, search } = {}) {
  const where = [];
  const params = [];
  if (donorId) { where.push('d.donor_id = ?'); params.push(donorId); }
  if (status) { where.push('d.status = ?'); params.push(status); }
  if (source && SOURCE_GROUPS[source]) where.push(`(${SOURCE_GROUPS[source]})`);
  if (method) { where.push('d.payment_method = ?'); params.push(method); }
  if (receipt === 'issued') where.push('d.receipt_issued = TRUE');
  if (receipt === 'not_issued') where.push('d.receipt_issued = FALSE');
  if (from) { where.push('d.created_at >= ?'); params.push(`${from} 00:00:00`); }
  if (to) { where.push('d.created_at < (? + INTERVAL 1 DAY)'); params.push(to); }
  if (search) {
    where.push(`(d.donor_name LIKE ? OR d.walk_in_name LIKE ? OR d.payment_method LIKE ? OR d.status LIKE ? OR d.qr_receipt_code LIKE ?
      OR d.reason_for_donation LIKE ? OR d.reason_category LIKE ? OR d.item_description LIKE ?)`);
    const p = likeParam(search);
    params.push(p, p, p, p, p, p, p, p);
  }
  return { sql: where.length ? `WHERE ${where.join(' AND ')}` : '', params };
}

module.exports = {
  async list(filters = {}) {
    const { sql, params } = buildWhere(filters);
    const [rows] = await pool.query(
      `SELECT ${COLS}, ${filters.forDonor ? CHILDREN_PUBLIC : CHILDREN_STAFF} AS supported_children, ${ITEMS} AS items_summary
         FROM tbl_donations d ${sql}
        ORDER BY d.created_at DESC, d.donation_id DESC`, params);
    return rows;
  },

  /**
   * Totals with the same rules everywhere:
   *   count          = every donation matching the filters (any status)
   *   received_total = sum of amounts with status 'Received'
   */
  async summary(filters = {}) {
    const { sql, params } = buildWhere(filters);
    const [[r]] = await pool.query(
      `SELECT COUNT(*) AS count,
              COALESCE(SUM(CASE WHEN d.status = 'Received' THEN d.amount END), 0) AS received_total,
              COALESCE(SUM(d.status = 'Pending'), 0) AS pending_count,
              MAX(d.created_at) AS last_donation_at
         FROM tbl_donations d ${sql}`, params);
    return { count: Number(r.count), received_total: Number(r.received_total), pending_count: Number(r.pending_count), last_donation_at: r.last_donation_at };
  },

  async findById(id, { forDonor = false } = {}) {
    const [rows] = await pool.query(
      `SELECT ${COLS}, ${forDonor ? CHILDREN_PUBLIC : CHILDREN_STAFF} AS supported_children, ${ITEMS} AS items_summary
         FROM tbl_donations d WHERE d.donation_id = ?`, [id]);
    return rows[0] || null;
  },

  /** In-kind items of a donation (for edits and reversals). */
  async items(id, conn = pool) {
    const [rows] = await conn.query(
      'SELECT inventory_item_id AS item_id, quantity FROM tbl_donation_items WHERE donation_id = ? ORDER BY inventory_item_id', [id]);
    return rows;
  },

  async findByReceipt(code) {
    const [rows] = await pool.query('SELECT * FROM tbl_donations WHERE qr_receipt_code = ?', [code]);
    return rows[0] || null;
  },

  async findByIdempotencyKey(donorId, key) {
    const [rows] = await pool.query('SELECT donation_id FROM tbl_donations WHERE idempotency_key = ? AND donor_id = ?', [key, donorId]);
    return rows[0]?.donation_id || null;
  },

  /** Inserts a donation and its supported children on an existing connection (inside a transaction). */
  async insertWith(conn, d) {
    const [res] = await conn.query(
      `INSERT INTO tbl_donations (donor_id, donor_type, walk_in_name, walk_in_contact, visit_id, donor_name, source, amount,
         payment_method, status, item_description, reason_for_donation, reason_category, is_general, submitted_by_donor,
         allocation_notes, qr_receipt_code, idempotency_key, received_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ${d.status === 'Received' ? 'NOW()' : 'NULL'})`,
      [d.donor_id ?? null, d.donor_type || 'registered', d.walk_in_name || null, d.walk_in_contact || null, d.visit_id ?? null,
        d.donor_name, d.source || 'donations_page', d.amount, d.payment_method, d.status,
        d.item_description || null, d.reason_for_donation || null, d.reason_category || null, d.is_general ? 1 : 0,
        d.submitted_by_donor ? 1 : 0, d.allocation_notes || null, d.qr_receipt_code, d.idempotency_key || null]);
    for (const childId of d.child_ids || []) {
      await conn.query('INSERT INTO tbl_donation_children (donation_id, child_id) VALUES (?, ?)', [res.insertId, childId]);
    }
    return res.insertId;
  },

  /** Inserts the donation and its supported children atomically. */
  async create(d) {
    return withTransaction((conn) => this.insertWith(conn, d));
  },

  async setStatus(id, status) {
    await pool.query(
      `UPDATE tbl_donations SET status = ?, received_at = ${status === 'Received' ? 'NOW()' : 'received_at'} WHERE donation_id = ?`,
      [status, id]);
  },

  async updateAllocation(id, notes) {
    await pool.query('UPDATE tbl_donations SET allocation_notes = ? WHERE donation_id = ?', [notes, id]);
  },

  /** Edits amount, method, allocation and receipt status (Donations page). */
  async update(id, fields) {
    const keys = Object.keys(fields);
    if (!keys.length) return;
    await pool.query(`UPDATE tbl_donations SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE donation_id = ?`,
      [...keys.map((k) => fields[k]), id]);
  },

  async markReceiptIssued(id) {
    await pool.query('UPDATE tbl_donations SET receipt_issued = TRUE WHERE donation_id = ? AND receipt_issued = FALSE', [id]);
  },

  async remove(id) {
    await pool.query('DELETE FROM tbl_donations WHERE donation_id = ?', [id]);
  },

  /** Donor portal totals: the same rules as the Donations page and Dashboard, for one donor. */
  async donorTotals(donorId) {
    const s = await this.summary({ donorId });
    return { donation_count: s.count, total_amount: s.received_total, pending_count: s.pending_count, last_donation_at: s.last_donation_at };
  },
};
