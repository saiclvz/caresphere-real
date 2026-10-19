/**
 * Manual stock movements, history and reports (migration 035). The quantity on hand and the movement row are always
 * written together, under a row lock, so the history adds up to the quantity and two people can't race each other.
 */
const { pool, withTransaction } = require('../config/db');
const HttpError = require('../utils/HttpError');
const { toInt } = require('../utils/validate');
const { logChange } = require('../utils/audit');
const Notify = require('./notifications');
const INV = require('../config/inventory');

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const fail = (errors, message = 'Check the highlighted fields.') => { throw new HttpError(400, message, { errors }); };

/** Validates a manual movement. Returns { type, change, reason, note, reference }. */
function clean(body = {}) {
  const errors = {};
  const type = String(body.type || '');
  const def = INV.TYPES[type];
  if (!def) errors.type = 'Choose Stock in, Stock out, Adjustment or Disposal.';
  let qty = null;
  try { qty = toInt(body.quantity, 'Quantity', { min: 1, max: INV.MAX_QTY }); } catch { errors.quantity = 'Enter a whole number of at least 1.'; }
  const reason = String(body.reason || '').trim();
  if (def && !def.reasons.includes(reason)) errors.reason = 'Choose a reason from the list.';
  const note = String(body.note || '').trim().slice(0, 255);
  if (reason === 'Other' && !note) errors.note = 'Describe the reason.';
  let sign = def?.sign;
  if (type === 'adjustment') {
    const dir = String(body.direction || '');
    if (!['add', 'remove'].includes(dir)) errors.direction = 'Choose whether the adjustment adds or removes stock.';
    sign = dir === 'add' ? 1 : -1;
  }
  if (Object.keys(errors).length) fail(errors);
  return { type, change: sign * qty, reason, note: note || null, reference: String(body.reference || '').trim().slice(0, 100) || null };
}

/**
 * Writes one movement and the new quantity (inside `conn`). Never lets the quantity go below 0.
 * Returns { movement_id, before, after }.
 */
async function record(conn, req, itemId, m) {
  const [[item]] = await conn.query('SELECT item_id, item_name, quantity, min_threshold, archived_at FROM tbl_inventory WHERE item_id = ? FOR UPDATE', [itemId]);
  if (!item || item.archived_at) throw new HttpError(404, 'Inventory item not found.');
  const before = Number(item.quantity);
  const after = before + m.change;
  if (after < 0) throw new HttpError(409, `Only ${before} ${item.item_name} in stock, so ${-m.change} can't be removed.`, { errors: { quantity: `Only ${before} in stock.` } });
  await conn.query('UPDATE tbl_inventory SET quantity = ?, last_updated_by = ? WHERE item_id = ?', [after, req.user.user_id, itemId]);
  const [r] = await conn.query(
    `INSERT INTO tbl_inventory_movements (item_id, movement_type, change_qty, quantity_before, quantity_after, reason, note, reference, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`, [itemId, m.type, m.change, before, after, m.reason, m.note, m.reference || null, req.user.user_id]);
  const label = INV.TYPES[m.type]?.label || m.type;
  await logChange(conn, req, `INVENTORY_${m.type.toUpperCase()} (${m.change > 0 ? '+' : ''}${m.change}, ${m.reason})`, `Inventory #${itemId}`, {
    changes: [{ field: 'Quantity', old: String(before), new: String(after), sensitive: false }], reason: [label, m.reason, m.note].filter(Boolean).join(': '),
  });
  if (before > item.min_threshold && after <= item.min_threshold) await Notify.lowStock(conn);
  return { movement_id: r.insertId, before, after };
}

/** POST /api/inventory/:id/movements - one manual movement. */
async function create(req, itemId, body) {
  const m = clean(body);
  return withTransaction((conn) => record(conn, req, itemId, m));
}

// ---------------------------------------------------------------- history and reports
const SELECT = `SELECT m.movement_id, m.item_id, i.item_name, i.category, m.movement_type, m.change_qty, m.quantity_after,
       COALESCE(m.quantity_before, m.quantity_after - m.change_qty) AS quantity_before, m.reason, m.note, m.reference,
       m.donation_id, d.donation_no, m.created_at, u.full_name AS user_name
  FROM tbl_inventory_movements m JOIN tbl_inventory i ON i.item_id = m.item_id
  LEFT JOIN tbl_users u ON u.user_id = m.created_by LEFT JOIN tbl_donations d ON d.donation_id = m.donation_id`;

function shape(r) {
  const type = INV.DISPLAY[r.movement_type] || 'adjustment';
  return {
    movement_id: r.movement_id, item_id: r.item_id, item_name: r.item_name, category: r.category, at: r.created_at,
    type, type_label: INV.TYPES[type].label, stored_type: r.movement_type, change: Number(r.change_qty),
    quantity_before: Number(r.quantity_before), quantity_after: Number(r.quantity_after),
    reason: r.reason || INV.LEGACY_REASON[r.movement_type] || null, note: r.note || null, reference: r.reference || null,
    user_name: r.user_name || 'System', donation: r.donation_id ? { donation_id: r.donation_id, donation_no: r.donation_no || null } : null,
  };
}

/** Filters shared by the history and the reports. Types are the four display types. */
function filters(q = {}) {
  const where = []; const params = [];
  if (q.item_id) { where.push('m.item_id = ?'); params.push(toInt(q.item_id, 'item', { min: 1 })); }
  if (q.category) { where.push('i.category = ?'); params.push(String(q.category).slice(0, 50)); }
  if (q.type) {
    if (!INV.TYPES[q.type]) throw new HttpError(400, 'Choose a movement type from the list.');
    where.push('m.movement_type IN (?)'); params.push(Object.keys(INV.DISPLAY).filter((k) => INV.DISPLAY[k] === q.type));
  }
  for (const [k, op] of [['from', '>='], ['to', '<=']]) {
    if (!q[k]) continue;
    if (!DATE.test(String(q[k]))) throw new HttpError(400, 'Choose a valid date.');
    where.push(`DATE(m.created_at) ${op} ?`); params.push(String(q[k]));
  }
  if (q.from && q.to && String(q.from) > String(q.to)) throw new HttpError(400, 'From must be on or before To.');
  return { where, params };
}

/** GET /api/inventory/:id/movements - the item's whole history, newest first. */
async function history(itemId) {
  const [[item]] = await pool.query('SELECT item_id, item_name, category, quantity, archived_at FROM tbl_inventory WHERE item_id = ?', [itemId]);
  if (!item) throw new HttpError(404, 'Inventory item not found.');
  const [rows] = await pool.query(`${SELECT} WHERE m.item_id = ? ORDER BY m.created_at DESC, m.movement_id DESC`, [itemId]);
  const movements = rows.map(shape);
  // Opening balance + every movement should equal the quantity on hand.
  const sum = movements.reduce((n, m) => n + m.change, 0);
  return { item: { ...item, quantity: Number(item.quantity) }, movements, reconciled: sum === Number(item.quantity), movement_total: sum };
}

/**
 * GET /api/inventory/reports - current stock, low stock, totals per movement type and the movements themselves for
 * the filters (date range, item, category, type). Archived items are left out of current stock.
 */
async function report(q = {}) {
  const f = filters(q);
  const whereSql = f.where.length ? `WHERE ${f.where.join(' AND ')}` : '';
  const [rows] = await pool.query(`${SELECT} ${whereSql} ORDER BY m.created_at DESC, m.movement_id DESC LIMIT 5000`, f.params);
  const movements = rows.map(shape);
  const totals = Object.fromEntries(Object.keys(INV.TYPES).map((t) => [t, { count: 0, quantity: 0 }]));
  for (const m of movements) { totals[m.type].count += 1; totals[m.type].quantity += m.change; }
  const cw = []; const cp = [];
  if (q.category) { cw.push('category = ?'); cp.push(String(q.category).slice(0, 50)); }
  if (q.item_id) { cw.push('item_id = ?'); cp.push(toInt(q.item_id, 'item', { min: 1 })); }
  const [current] = await pool.query(
    `SELECT item_id, item_name, category, quantity, min_threshold, (quantity <= min_threshold) AS is_low_stock FROM tbl_inventory
      WHERE archived_at IS NULL${cw.length ? ` AND ${cw.join(' AND ')}` : ''} ORDER BY category, item_name`, cp);
  const cur = current.map((c) => ({ ...c, quantity: Number(c.quantity), min_threshold: Number(c.min_threshold), is_low_stock: Boolean(Number(c.is_low_stock)) }));
  const [cats] = await pool.query('SELECT DISTINCT category FROM tbl_inventory WHERE archived_at IS NULL ORDER BY category');
  return { current: cur, low_stock: cur.filter((c) => c.is_low_stock), totals, movements, truncated: rows.length === 5000,
    options: { types: Object.entries(INV.TYPES).map(([k, v]) => ({ key: k, label: v.label })), categories: cats.map((c) => c.category) } };
}

const csvCell = (v) => {
  if (typeof v === 'number') return String(v);
  let s = v === null || v === undefined ? '' : String(v);
  if (/^[=+\-@\t]/.test(s)) s = `'${s}`; // spreadsheet formula injection
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
function reportCsv(r) {
  const head = ['Date', 'Item', 'Category', 'Type', 'Change', 'Previous', 'New', 'Reason', 'Note', 'Reference', 'Donation', 'User'];
  const lines = r.movements.map((m) => [m.at, m.item_name, m.category, m.type_label, m.change, m.quantity_before, m.quantity_after, m.reason, m.note, m.reference, m.donation?.donation_no || '', m.user_name]);
  return [head, ...lines].map((l) => l.map(csvCell).join(',')).join('\r\n');
}

module.exports = { clean, record, create, history, report, reportCsv };
