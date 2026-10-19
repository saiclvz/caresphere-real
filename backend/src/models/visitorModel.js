const { pool } = require('../config/db');
const { likeParam } = require('../utils/validate');
const { pageInfo } = require('../utils/pagination');

// Visit type is derived from the donation's visit_id: linked = "Donated", otherwise "Just visited".
const COLS = `v.visitor_id, v.visitor_name, v.contact_number, v.purpose, v.check_in_time, v.check_out_time, v.needs_review,
  d.donation_id, d.donor_type AS donation_donor_type, IF(d.donation_id IS NULL, 'visit', 'donation') AS visit_type,
  u.full_name AS logged_by_name,
  d.payment_method AS donation_method, d.amount AS donation_amount`;

const FROM = `FROM tbl_visitors v
  LEFT JOIN tbl_users u ON u.user_id = v.logged_by
  LEFT JOIN tbl_donations d ON d.visit_id = v.visitor_id`;

/** Every filter except visit type, combined with AND. */
function baseWhere({ dateFrom, dateTo, timeFrom, timeTo, meal, openOnly, search } = {}) {
  const where = ['v.archived_at IS NULL']; // archived visits (migration 034) are kept but not listed
  const params = [];
  if (dateFrom) { where.push('v.check_in_time >= ?'); params.push(`${dateFrom} 00:00:00`); }
  if (dateTo) { where.push('v.check_in_time < (? + INTERVAL 1 DAY)'); params.push(dateTo); }
  if (timeFrom || timeTo) {
    const from = `${timeFrom || '00:00'}:00`;
    const to = `${timeTo || '23:59'}:59`;
    // A range like 22:00 to 02:00 crosses midnight.
    where.push(from <= to ? '(TIME(v.check_in_time) BETWEEN ? AND ?)' : '(TIME(v.check_in_time) >= ? OR TIME(v.check_in_time) <= ?)');
    params.push(from, to);
  }
  // Meal period (config/visitorFilters.js), combined with the time range using AND.
  if (meal) { where.push('(TIME(v.check_in_time) BETWEEN ? AND ?)'); params.push(`${meal.start}:00`, `${meal.end}:59`); }
  if (openOnly) where.push('v.check_out_time IS NULL');
  if (search) {
    where.push('(v.visitor_name LIKE ? OR v.purpose LIKE ? OR v.contact_number LIKE ? OR d.item_description LIKE ?)');
    const p = likeParam(search);
    params.push(p, p, p, p);
  }
  return { where, params };
}

/** Adds the donated items (name + quantity) to each donated visit. */
async function attachItems(rows) {
  const ids = rows.filter((r) => r.donation_id).map((r) => r.donation_id);
  if (!ids.length) return rows.map((r) => ({ ...r, needs_review: !!r.needs_review, donated_items: [] }));
  const [items] = await pool.query(
    `SELECT di.donation_id, di.inventory_item_id AS item_id, i.item_name, di.quantity
       FROM tbl_donation_items di JOIN tbl_inventory i ON i.item_id = di.inventory_item_id
      WHERE di.donation_id IN (?) ORDER BY i.item_name`, [ids]);
  const byDonation = {};
  for (const it of items) (byDonation[it.donation_id] ||= []).push({ item_id: it.item_id, item_name: it.item_name, quantity: it.quantity });
  return rows.map((r) => ({ ...r, needs_review: !!r.needs_review, donated_items: byDonation[r.donation_id] || [] }));
}

module.exports = {
  /**
   * Returns { rows, counts }. counts.{all, visit, donation} use every filter except visit
   * type, so each option of the visit type control shows how many it would return.
   */
  async list({ type, paging, ...filters } = {}) {
    const { where, params } = baseWhere(filters);
    const [[c]] = await pool.query(
      `SELECT COUNT(*) AS all_count, COALESCE(SUM(d.donation_id IS NULL), 0) AS visit_count,
              COALESCE(SUM(d.donation_id IS NOT NULL), 0) AS donation_count
         ${FROM} ${where.length ? `WHERE ${where.join(' AND ')}` : ''}`, params);

    if (type === 'visit') where.push('d.donation_id IS NULL');
    if (type === 'donation') where.push('d.donation_id IS NOT NULL');
    const counts = { all: Number(c.all_count), visit: Number(c.visit_count), donation: Number(c.donation_count) };
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    // Server-side pagination (?page=&limit=) with every filter applied; without paging, up to 500 rows as before.
    let pagination = null;
    let limitSql = 'LIMIT 500';
    if (paging) {
      const total = type === 'visit' ? counts.visit : type === 'donation' ? counts.donation : counts.all;
      pagination = pageInfo(paging, total);
      limitSql = `LIMIT ${pagination.limit} OFFSET ${pagination.offset}`;
    }
    const [rows] = await pool.query(
      `SELECT ${COLS} ${FROM} ${whereSql}
        ORDER BY v.check_out_time IS NULL DESC, v.check_in_time DESC, v.visitor_id DESC ${limitSql}`, params);
    return { rows: await attachItems(rows), counts, pagination };
  },

  async findById(id) {
    const [rows] = await pool.query(`SELECT ${COLS} ${FROM} WHERE v.visitor_id = ? AND v.archived_at IS NULL`, [id]);
    if (!rows[0]) return null;
    return (await attachItems(rows))[0];
  },

  /** Inserts a visit on an existing connection (inside a transaction). */
  async insertWith(conn, v) {
    const [res] = await conn.query(
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
};
