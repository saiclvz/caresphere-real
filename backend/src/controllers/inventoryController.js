const { withTransaction } = require('../config/db');
const Inventory = require('../models/inventoryModel');
const HttpError = require('../utils/HttpError');
const { requireFields, toInt, toBool } = require('../utils/validate');
const { logActivity, logChange, diff } = require('../utils/audit');
const Movements = require('../services/inventoryMovements');
const INV = require('../config/inventory');
const LABELS = { item_name: 'Item name', category: 'Category', min_threshold: 'Low-stock threshold', is_needed_by_donors: 'Needed by donors' };
const Notify = require('../services/notifications');

function cleanItem(body, partial = false) {
  const out = {};
  if (!partial || body.item_name !== undefined) {
    const v = String(body.item_name || '').trim();
    if (!v || v.length > 100) throw new HttpError(400, 'Item name is required (max 100 characters).');
    out.item_name = v;
  }
  if (!partial || body.category !== undefined) {
    const v = String(body.category || '').trim();
    if (!v || v.length > 50) throw new HttpError(400, 'Category is required (max 50 characters).');
    out.category = v;
  }
  if (!partial || body.quantity !== undefined) out.quantity = toInt(body.quantity ?? 0, 'Quantity', { min: 0, max: 1000000 });
  if (!partial || body.min_threshold !== undefined) out.min_threshold = toInt(body.min_threshold ?? 5, 'Minimum threshold', { min: 0, max: 1000000 });
  if (!partial || body.is_needed_by_donors !== undefined) out.is_needed_by_donors = toBool(body.is_needed_by_donors);
  return out;
}

exports.list = async (req, res) => {
  const archived = req.user.role === 'Admin' && toBool(req.query.archived); // archived items: Admin only
  res.json({ success: true, data: await Inventory.list({ lowOnly: toBool(req.query.low), search: req.query.q, archived }) });
};

exports.lowStockCount = async (req, res) => {
  res.json({ success: true, count: await Inventory.lowStockCount() });
};

/**
 * POST /api/inventory (Admin, Staff with the Inventory duty). A starting quantity above 0 is recorded as a
 * Stock in movement "Opening balance" in the same transaction, so the history adds up to the quantity.
 */
exports.create = async (req, res) => {
  requireFields(req.body, ['item_name', 'category']);
  const item = cleanItem(req.body);
  const id = await withTransaction(async (conn) => {
    const [[dup]] = await conn.query('SELECT item_id, archived_at FROM tbl_inventory WHERE LOWER(item_name) = LOWER(?) LIMIT 1', [item.item_name]);
    if (dup) throw new HttpError(409, dup.archived_at ? 'An archived item has this name. Ask an Admin to restore it.' : 'An item with this name already exists.', { errors: { item_name: 'An item with this name already exists.' } });
    const [r] = await conn.query(
      'INSERT INTO tbl_inventory (item_name, category, quantity, min_threshold, is_needed_by_donors, last_updated_by) VALUES (?, ?, 0, ?, ?, ?)',
      [item.item_name, item.category, item.min_threshold, item.is_needed_by_donors, req.user.user_id]);
    await logChange(conn, req, 'CREATE_INVENTORY_ITEM', `Inventory #${r.insertId}`, {
      changes: diff({}, { item_name: item.item_name, category: item.category, min_threshold: item.min_threshold }, { labels: LABELS }) });
    if (item.quantity > 0) await Movements.record(conn, req, r.insertId, { type: 'stock_in', change: item.quantity, reason: INV.OPENING_BALANCE, note: null });
    if (item.quantity <= item.min_threshold) await Notify.lowStock(conn);
    return r.insertId;
  });
  res.status(201).json({ success: true, data: await Inventory.findById(id) });
};

/**
 * PUT /api/inventory/:id (Admin, Staff) - name, category, threshold and "needed by donors". The quantity is not
 * edited here: every quantity change is a movement (Stock in, Stock out, Adjustment or Disposal) with a reason.
 */
exports.update = async (req, res) => {
  const item = await Inventory.findById(req.params.id);
  if (!item || item.archived_at) throw new HttpError(404, 'Inventory item not found.');
  const fields = cleanItem(req.body, true);
  if (fields.quantity !== undefined && fields.quantity !== Number(item.quantity)) {
    throw new HttpError(400, 'Change the quantity with Stock in, Stock out, Adjustment or Disposal, so the reason is recorded.', { errors: { quantity: 'Use a stock movement to change the quantity.' } });
  }
  delete fields.quantity;
  if (!Object.keys(fields).length) throw new HttpError(400, 'Nothing to update.');
  const changes = diff(item, fields, { labels: LABELS });
  await withTransaction(async (conn) => {
    const keys = Object.keys(fields);
    await conn.query(`UPDATE tbl_inventory SET ${keys.map((k) => `${k} = ?`).join(', ')}, last_updated_by = ? WHERE item_id = ?`,
      [...keys.map((k) => fields[k]), req.user.user_id, req.params.id]);
    await logChange(conn, req, 'UPDATE_INVENTORY_ITEM', `Inventory #${req.params.id}`, { changes });
    const wasLow = item.quantity <= item.min_threshold;
    const nowLow = item.quantity <= (fields.min_threshold ?? item.min_threshold);
    if (!wasLow && nowLow) await Notify.lowStock(conn);
  });
  res.json({ success: true, data: await Inventory.findById(req.params.id) });
};

/**
 * POST /api/inventory/:id/movements { type, quantity, reason, note?, reference?, direction? } (Admin, Staff with the
 * Inventory duty): Stock in, Stock out, Adjustment (add or remove) or Disposal, with a reason. The quantity never
 * goes below 0. POST /api/inventory/:id/adjust (the - / + buttons) takes the same body: the buttons open the dialog.
 */
exports.movement = async (req, res) => {
  const id = toInt(req.params.id, 'Item', { min: 1 });
  const out = await Movements.create(req, id, req.body || {});
  res.status(201).json({ success: true, data: { item: await Inventory.findById(id), movement: out } });
};
exports.adjust = exports.movement;

/** GET /api/inventory/:id/movements - the item's movement history (newest first). */
exports.history = async (req, res) => {
  res.json({ success: true, data: await Movements.history(toInt(req.params.id, 'Item', { min: 1 })) });
};

/** GET /api/inventory/options - movement types and reasons for the dialog. */
exports.options = async (req, res) => {
  res.json({ success: true, data: { types: Object.entries(INV.TYPES).map(([key, v]) => ({ key, label: v.label, reasons: v.reasons, sign: v.sign })) } });
};

/** GET /api/inventory/reports?from&to&item_id&category&type[&format=csv] - inventory reports (CSV export logged). */
exports.reports = async (req, res) => {
  const r = await Movements.report(req.query);
  if (req.query.format === 'csv') {
    await logActivity(req, `EXPORT_INVENTORY_REPORT (${r.movements.length} movements)`, 'Inventory');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="inventory-movements-${new Date().toISOString().slice(0, 10)}.csv"`);
    return res.send(`\ufeff${Movements.reportCsv(r)}`);
  }
  res.json({ success: true, data: r });
};

/**
 * DELETE /api/inventory/:id { reason } - items are never deleted (migration 034): the item is archived with the
 * reason, leaves the lists and the pickers, and keeps its stock history and donation links. Only an item with no
 * stock on hand can be archived (use Stock out or Disposal first), so no quantity silently disappears.
 */
exports.remove = async (req, res) => {
  const item = await Inventory.findById(req.params.id);
  if (!item || item.archived_at) throw new HttpError(404, 'Inventory item not found.');
  const reason = String(req.body?.reason || req.query.reason || '').trim();
  if (!reason) throw new HttpError(400, 'Give the reason for archiving this item.', { errors: { reason: 'Give the reason for archiving this item.' } });
  if (Number(item.quantity) > 0) throw new HttpError(409, `This item still has ${item.quantity} in stock. Record a Stock out or Disposal first, then archive it.`);
  await Inventory.archive(req.params.id, req.user.user_id, reason.slice(0, 500));
  await logActivity(req, 'ARCHIVE_INVENTORY_ITEM', `Inventory #${req.params.id}`);
  res.json({ success: true, message: 'Item archived. Its stock history is kept.' });
};

/** POST /api/inventory/:id/restore (Admin) */
exports.restore = async (req, res) => {
  const item = await Inventory.findById(req.params.id);
  if (!item || !item.archived_at) throw new HttpError(404, 'Archived item not found.');
  await Inventory.restore(req.params.id);
  await logActivity(req, 'RESTORE_INVENTORY_ITEM', `Inventory #${req.params.id}`);
  res.json({ success: true, data: await Inventory.findById(req.params.id) });
};
