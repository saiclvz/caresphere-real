const { pool, withTransaction } = require('../config/db');
const { likeParam } = require('../utils/validate');
const L = require('../config/donationLifecycle');

const q = (list) => list.map((s) => `'${s.replace(/'/g, "''")}'`).join(', ');
// Counted: a verified or accepted status AND, for donor reports, verified against the home's account, AND, for cash
// above the dual-control amount, confirmed by a second person. Nothing else is ever in a total.
const COUNTED = `(d.status IN (${q(L.COUNTED)}) AND (d.claim_status IS NULL OR d.claim_status = 'Verified') AND (d.dual_control IS NULL OR d.dual_control = 'Approved'))`;
const IN_KIND = "d.payment_method = 'In-kind'";
// In-kind value: the item lines' estimated values when every line has one, else the older whole-donation estimate.
const LINES_VALUE = `(SELECT CASE WHEN COUNT(*) = 0 OR SUM(l.estimated_value IS NULL) > 0 THEN NULL ELSE SUM(l.estimated_value) END
    FROM tbl_donation_item_lines l WHERE l.donation_id = d.donation_id)`;
const EST_VALUE = `CASE WHEN ${IN_KIND} THEN COALESCE(${LINES_VALUE}, NULLIF(d.amount, 0)) END`;
const NEEDS_REVIEW = 'EXISTS (SELECT 1 FROM tbl_donation_allocations a WHERE a.donation_id = d.donation_id AND a.superseded_at IS NULL AND a.needs_review = TRUE)';
const NO_ALLOCATION = 'NOT EXISTS (SELECT 1 FROM tbl_donation_allocations a WHERE a.donation_id = d.donation_id AND a.superseded_at IS NULL)';
const VOID_PENDING = "EXISTS (SELECT 1 FROM tbl_donation_void_requests vr WHERE vr.donation_id = d.donation_id AND vr.status = 'Pending')";
const HAS_ACK = '(d.receipt_issued = TRUE OR EXISTS (SELECT 1 FROM tbl_donation_acknowledgments k WHERE k.donation_id = d.donation_id))';
/** Needs attention: anything waiting for a person (not ended or closed). */
const ATTENTION = `(d.status NOT IN ('Voided', 'Rejected', 'Cancelled', 'Closed') AND (d.status IN ('Pending', 'Pending verification', 'Received', 'Under inspection', 'Accepted')
    OR ${NEEDS_REVIEW} OR (${IN_KIND} AND ${EST_VALUE} IS NULL) OR ${VOID_PENDING}))`;
const ITEMS = `COALESCE((SELECT GROUP_CONCAT(CONCAT(l.item_name, ' x', l.quantity) ORDER BY l.line_id SEPARATOR ', ') FROM tbl_donation_item_lines l WHERE l.donation_id = d.donation_id),
    (SELECT GROUP_CONCAT(CONCAT(i.item_name, ' x', di.quantity) ORDER BY i.item_name SEPARATOR ', ') FROM tbl_donation_items di JOIN tbl_inventory i ON i.item_id = di.inventory_item_id WHERE di.donation_id = d.donation_id))`;
const DONOR_KEY = "COALESCE(CONCAT('r', d.donor_ref_id), CONCAT('u', d.donor_id), CONCAT('w', LOWER(TRIM(d.walk_in_name))), CONCAT('n', LOWER(TRIM(d.donor_name))))";

const COLS = `d.donation_id, d.donation_no, d.donor_id, d.donor_type, d.walk_in_name, d.walk_in_contact, d.visit_id, d.donor_name, d.source,
  d.amount, d.payment_method, d.status, d.legacy_status, d.item_description, d.reason_for_donation, d.reason_category, d.is_general, d.submitted_by_donor,
  d.allocation_notes, d.legacy_allocation, d.qr_receipt_code, d.receipt_issued, d.created_at, d.received_at, d.purpose, d.is_anonymous, d.last_activity_at,
  d.void_reason, d.void_note, d.voided_at, d.donor_ref_id, d.lifecycle_converted_at,
  d.claim_status, d.reported_amount, d.verified_amount, d.reference_raw, d.sent_at, d.claim_reported_at, d.stale_flagged_at, d.payment_method_id,
  d.dual_control, d.recorded_by, d.verified_at, d.legacy_payment_id,
  dr.donor_code, dr.donor_type AS donor_kind, dr.display_name AS donor_record_name,
  (SELECT vl.check_in_time FROM tbl_visitors vl WHERE vl.visitor_id = d.visit_id) AS linked_visit_time,
  ${EST_VALUE} AS estimated_value, ${ITEMS} AS items_summary, ${NEEDS_REVIEW} AS allocation_needs_review, ${NO_ALLOCATION} AS allocation_missing,
  ${VOID_PENDING} AS void_requested, ${HAS_ACK} AS has_acknowledgment, ${ATTENTION} AS needs_attention`;
const FROM = 'FROM tbl_donations d LEFT JOIN tbl_donors dr ON dr.donor_ref_id = d.donor_ref_id';

/**
 * Source groups (Donations page chip):
 *   portal = the donor's own Donate page, walk_in = any walk-in donor (either page),
 *   staff  = a registered donor's gift recorded by staff (bank transfer, event, mail).
 */
const SOURCE_GROUPS = {
  portal: "d.source = 'portal'",
  walk_in: "d.donor_type = 'walk_in'",
  staff: "d.donor_type = 'registered' AND d.source <> 'portal'",
};

/**
 * One WHERE builder for the list, the cards, exports, reports and donor history, so they always agree.
 * `canSeeNames`: only then does the search look at donor names (otherwise donation number and donor code).
 */
function buildWhere(f = {}, { cards = false } = {}) {
  const where = [];
  const params = [];
  if (f.donorId) { where.push('d.donor_id = ?'); params.push(f.donorId); }
  if (f.donorRefId) { where.push('d.donor_ref_id = ?'); params.push(f.donorRefId); }
  if (f.source && SOURCE_GROUPS[f.source]) where.push(`(${SOURCE_GROUPS[f.source]})`);
  if (f.method) { where.push('d.payment_method = ?'); params.push(f.method); }
  if (f.receipt === 'issued') where.push(HAS_ACK);
  if (f.receipt === 'not_issued') where.push(`NOT ${HAS_ACK}`);
  if (f.purpose) { where.push('d.purpose = ?'); params.push(f.purpose); }
  if (f.donorType === 'anonymous') where.push('d.is_anonymous = TRUE');
  else if (f.donorType) { where.push('dr.donor_type = ?'); params.push(f.donorType); }
  if (f.from) { where.push('d.created_at >= ?'); params.push(`${f.from} 00:00:00`); }
  if (f.to) { where.push('d.created_at < (? + INTERVAL 1 DAY)'); params.push(f.to); }
  if (f.search) {
    const p = likeParam(f.search);
    const parts = ['d.donation_no LIKE ?', 'dr.donor_code LIKE ?', 'd.qr_receipt_code LIKE ?'];
    params.push(p, p, p);
    if (f.canSeeNames) { parts.push('(d.is_anonymous = FALSE AND (d.donor_name LIKE ? OR d.walk_in_name LIKE ?))'); params.push(p, p); }
    where.push(`(${parts.join(' OR ')})`);
  }
  if (!cards) {
    if (f.type === 'cash') where.push(`NOT ${IN_KIND}`);
    if (f.type === 'in_kind') where.push(IN_KIND);
    if (f.status === 'counted') where.push(COUNTED);
    else if (f.status) { where.push('d.status = ?'); params.push(f.status); }
    if (f.attention) where.push(ATTENTION);
    if (f.needsReview) where.push(NEEDS_REVIEW);
    if (f.valueMissing) where.push(`(${IN_KIND} AND ${EST_VALUE} IS NULL)`);
  }
  return { sql: where.length ? `WHERE ${where.join(' AND ')}` : '', params };
}

const shape = (r) => r && ({
  ...r, amount: Number(r.amount), estimated_value: r.estimated_value === null || r.estimated_value === undefined ? null : Number(r.estimated_value),
  allocation_needs_review: !!r.allocation_needs_review, allocation_missing: !!r.allocation_missing, void_requested: !!r.void_requested,
  has_acknowledgment: !!r.has_acknowledgment, needs_attention: !!r.needs_attention, is_anonymous: !!r.is_anonymous, in_kind: r.payment_method === 'In-kind',
  reported_amount: r.reported_amount === null || r.reported_amount === undefined ? null : Number(r.reported_amount),
  verified_amount: r.verified_amount === null || r.verified_amount === undefined ? null : Number(r.verified_amount),
});

async function allocationsFor(ids, conn = pool) {
  if (!ids.length) return {};
  const [rows] = await conn.query(`SELECT donation_id, allocation_id, program, amount, intended_use, needs_review, original_text FROM tbl_donation_allocations
    WHERE donation_id IN (?) AND superseded_at IS NULL ORDER BY allocation_id`, [ids]);
  const out = {};
  for (const r of rows) (out[r.donation_id] = out[r.donation_id] || []).push({ ...r, amount: r.amount === null ? null : Number(r.amount), needs_review: !!r.needs_review });
  return out;
}

module.exports = {
  COUNTED_SQL: COUNTED, IN_KIND_SQL: IN_KIND, EST_VALUE_SQL: EST_VALUE, FROM_SQL: FROM, buildWhere, allocationsFor,

  /** The list: newest activity first; paginated when `paging` is given ({ limit, offset }). */
  async list(filters = {}, paging = null) {
    const { sql, params } = buildWhere(filters);
    const order = 'ORDER BY COALESCE(d.last_activity_at, d.created_at) DESC, d.donation_id DESC';
    let total = null;
    if (paging) {
      const [[c]] = await pool.query(`SELECT COUNT(*) AS n ${FROM} ${sql}`, params);
      total = Number(c.n);
    }
    const [rows] = await pool.query(`SELECT ${COLS} ${FROM} ${sql} ${order}${paging ? ' LIMIT ? OFFSET ?' : ''}`,
      paging ? [...params, paging.limit, paging.offset] : params);
    const alloc = await allocationsFor(rows.map((r) => r.donation_id));
    const data = rows.map((r) => ({ ...shape(r), allocation: alloc[r.donation_id] || [] }));
    return paging ? { rows: data, total } : data;
  },

  async count(filters = {}) {
    const { sql, params } = buildWhere(filters);
    const [[c]] = await pool.query(`SELECT COUNT(*) AS n ${FROM} ${sql}`, params);
    return Number(c.n);
  },

  /**
   * The cards (server-computed). Totals count only verified or accepted donations and never Voided ones.
   * Cash is real money; in-kind is an estimate and is never added to the cash total.
   */
  async cards(filters = {}) {
    const { sql, params } = buildWhere(filters, { cards: true });
    const [[r]] = await pool.query(
      `SELECT COALESCE(SUM(x.counted AND NOT x.in_kind), 0) AS cash_count, COALESCE(SUM(CASE WHEN x.counted AND NOT x.in_kind THEN x.amount END), 0) AS cash_total,
              COALESCE(SUM(x.counted AND x.in_kind), 0) AS in_kind_count, COALESCE(SUM(CASE WHEN x.counted AND x.in_kind THEN x.est END), 0) AS in_kind_value,
              COALESCE(SUM(x.counted AND x.in_kind AND x.est IS NULL), 0) AS in_kind_no_value,
              COALESCE(SUM(x.counted), 0) AS donations, COUNT(DISTINCT CASE WHEN x.counted THEN x.donor_key END) AS donors,
              COALESCE(SUM(x.attention), 0) AS needs_attention, COALESCE(SUM(x.status = 'Voided'), 0) AS voided
         FROM (SELECT d.amount, d.status, ${COUNTED} AS counted, ${IN_KIND} AS in_kind, ${EST_VALUE} AS est, ${DONOR_KEY} AS donor_key, ${ATTENTION} AS attention
                 ${FROM} ${sql}) x`, params);
    const n = (k) => Number(r[k] || 0);
    return {
      cash: { total: n('cash_total'), count: n('cash_count') },
      in_kind: { estimated_value: n('in_kind_value'), count: n('in_kind_count'), no_value: n('in_kind_no_value') },
      donations: n('donations'), donors: n('donors'), needs_attention: n('needs_attention'), voided: n('voided'),
    };
  },

  /**
   * Totals for the Dashboard and the donor portal, with the same rules as the cards:
   *   count = verified or accepted donations (never Voided), received_total = their cash amounts.
   */
  async summary(filters = {}) {
    const { sql, params } = buildWhere(filters);
    const [[r]] = await pool.query(
      `SELECT COALESCE(SUM(${COUNTED}), 0) AS count,
              COALESCE(SUM(CASE WHEN ${COUNTED} AND NOT ${IN_KIND} THEN d.amount END), 0) AS received_total,
              COALESCE(SUM(d.status IN ('Pending', 'Pending verification') AND (d.claim_status IS NULL OR d.claim_status IN ('Reported', 'Details requested', 'Awaiting approval'))), 0) AS pending_count,
              MAX(CASE WHEN d.status <> 'Voided' THEN d.created_at END) AS last_donation_at
         ${FROM} ${sql}`, params);
    return { count: Number(r.count), received_total: Number(r.received_total), pending_count: Number(r.pending_count), last_donation_at: r.last_donation_at };
  },

  async findById(id, conn = pool) {
    const [rows] = await conn.query(`SELECT ${COLS}, dr.contact_enc AS donor_contact_enc, dr.user_id AS donor_user_id ${FROM} WHERE d.donation_id = ?`, [id]);
    if (!rows[0]) return null;
    const alloc = await allocationsFor([rows[0].donation_id], conn);
    return { ...shape(rows[0]), allocation: alloc[rows[0].donation_id] || [] };
  },

  /** In-kind items of a donation (stock movements). */
  async items(id, conn = pool) {
    const [rows] = await conn.query(
      'SELECT inventory_item_id AS item_id, quantity FROM tbl_donation_items WHERE donation_id = ? ORDER BY inventory_item_id', [id]);
    return rows;
  },

  async findByReceipt(code) {
    const [rows] = await pool.query('SELECT d.*, dr.donor_code FROM tbl_donations d LEFT JOIN tbl_donors dr ON dr.donor_ref_id = d.donor_ref_id WHERE d.qr_receipt_code = ?', [code]);
    return rows[0] || null;
  },

  async findByIdempotencyKey(donorId, key) {
    const [rows] = await pool.query('SELECT donation_id FROM tbl_donations WHERE idempotency_key = ? AND donor_id = ?', [key, donorId]);
    return rows[0]?.donation_id || null;
  },

  /** Inserts a donation (with its DNT number and donor record) on an existing connection, inside a transaction. */
  async insertWith(conn, d) {
    const LC = require('../services/donationLifecycle');
    const number = await LC.donationNumber(conn);
    let donorRef = d.donor_ref_id || null;
    if (!donorRef && d.donor_id) {
      const [[u]] = await conn.query('SELECT user_id, full_name FROM tbl_users WHERE user_id = ?', [d.donor_id]);
      if (u) donorRef = await LC.donorForAccount(conn, u);
    }
    const [res] = await conn.query(
      `INSERT INTO tbl_donations (donor_id, donor_type, walk_in_name, walk_in_contact, visit_id, donor_name, source, amount,
         payment_method, status, item_description, reason_for_donation, reason_category, is_general, submitted_by_donor,
         allocation_notes, qr_receipt_code, idempotency_key, received_at, donation_no, donor_ref_id, is_anonymous, purpose, last_activity_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ${d.status === 'Received' ? 'NOW()' : 'NULL'}, ?, ?, ?, ?, NOW())`,
      [d.donor_id ?? null, d.donor_type || 'registered', d.walk_in_name || null, d.walk_in_contact || null, d.visit_id ?? null,
        d.donor_name, d.source || 'donations_page', d.amount, d.payment_method, d.status,
        d.item_description || null, d.reason_for_donation || null, d.reason_category || null, d.is_general ? 1 : 0,
        d.submitted_by_donor ? 1 : 0, d.allocation_notes || null, d.qr_receipt_code, d.idempotency_key || null,
        number, donorRef, d.is_anonymous ? 1 : 0, d.purpose || null]);
    for (const childId of d.child_ids || []) {
      await conn.query('INSERT INTO tbl_donation_children (donation_id, child_id) VALUES (?, ?)', [res.insertId, childId]);
    }
    return res.insertId;
  },

  async create(d) {
    return withTransaction((conn) => this.insertWith(conn, d));
  },

  /** Edits fields (before acknowledgment only; the controller checks). */
  async update(id, fields, conn = pool) {
    const keys = Object.keys(fields);
    if (!keys.length) return;
    await conn.query(`UPDATE tbl_donations SET ${keys.map((k) => `${k} = ?`).join(', ')}, last_activity_at = NOW() WHERE donation_id = ?`,
      [...keys.map((k) => fields[k]), id]);
  },

  /** Donor portal totals: the same rules as the Donations page and Dashboard, for one donor. */
  async donorTotals(donorId) {
    const s = await this.summary({ donorId });
    return { donation_count: s.count, total_amount: s.received_total, pending_count: s.pending_count, last_donation_at: s.last_donation_at };
  },
};
