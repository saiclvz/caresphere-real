const { withTransaction } = require('../config/db');
const Inventory = require('../models/inventoryModel');
const HttpError = require('../utils/HttpError');
const { requireFields, toInt, toBool } = require('../utils/validate');
const { logActivity, logActivityWith } = require('../utils/audit');
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
  res.json({ success: true, data: await Inventory.list({ lowOnly: toBool(req.query.low), search: req.query.q }) });
};

exports.lowStockCount = async (req, res) => {
  res.json({ success: true, count: await Inventory.lowStockCount() });
};

exports.create = async (req, res) => {
  requireFields(req.body, ['item_name', 'category']);
  const item = cleanItem(req.body);
  const id = await withTransaction(async (conn) => {
    const [r] = await conn.query(
      'INSERT INTO tbl_inventory (item_name, category, quantity, min_threshold, is_needed_by_donors, last_updated_by) VALUES (?, ?, ?, ?, ?, ?)',
      [item.item_name, item.category, item.quantity, item.min_threshold, item.is_needed_by_donors, req.user.user_id]);
    await logActivityWith(conn, req, 'CREATE_INVENTORY_ITEM', `Inventory #${r.insertId}`);
    if ((item.quantity ?? 0) <= (item.min_threshold ?? 0)) await Notify.lowStock(conn);
    return r.insertId;
  });
  res.status(201).json({ success: true, data: await Inventory.findById(id) });
};

/** PUT /api/inventory/:id  (Admin, Staff) - full edit with validation. */
exports.update = async (req, res) => {
  const item = await Inventory.findById(req.params.id);
  if (!item) throw new HttpError(404, 'Inventory item not found.');
  const fields = cleanItem(req.body, true);
  if (!Object.keys(fields).length) throw new HttpError(400, 'Nothing to update.');
  const changed = fields.quantity !== undefined && fields.quantity !== item.quantity;
  await withTransaction(async (conn) => {
    const keys = Object.keys(fields);
    await conn.query(`UPDATE tbl_inventory SET ${keys.map((k) => `${k} = ?`).join(', ')}, last_updated_by = ? WHERE item_id = ?`,
      [...keys.map((k) => fields[k]), req.user.user_id, req.params.id]);
    // Stock history: a quantity change made by editing the item (the +/- buttons were removed).
    if (changed) {
      await conn.query(
        "INSERT INTO tbl_inventory_movements (item_id, movement_type, change_qty, quantity_after, created_by) VALUES (?, 'manual_edit', ?, ?, ?)",
        [req.params.id, fields.quantity - item.quantity, fields.quantity, req.user.user_id]);
    }
    const qty = changed ? ` (qty ${item.quantity} -> ${fields.quantity})` : '';
    await logActivityWith(conn, req, `UPDATE_INVENTORY_ITEM${qty}`, `Inventory #${req.params.id}`);
    const wasLow = item.quantity <= item.min_threshold;
    const nowLow = (fields.quantity ?? item.quantity) <= (fields.min_threshold ?? item.min_threshold);
    if (!wasLow && nowLow) await Notify.lowStock(conn);
  });
  res.json({ success: true, data: await Inventory.findById(req.params.id) });
};

exports.remove = async (req, res) => {
  const item = await Inventory.findById(req.params.id);
  if (!item) throw new HttpError(404, 'Inventory item not found.');
  try {
    await Inventory.remove(req.params.id);
  } catch (err) {
    // Items with stock history (donations or quantity edits) are kept so the history stays complete.
    if (err.code === 'ER_ROW_IS_REFERENCED_2' || err.code === 'ER_ROW_IS_REFERENCED') {
      throw new HttpError(409, 'This item has stock history, so it is kept for the record. Set its quantity to 0 instead of deleting it.');
    }
    throw err;
  }
  await logActivity(req, 'DELETE_INVENTORY_ITEM', `Inventory #${req.params.id}`);
  res.json({ success: true, message: 'Item deleted.' });
};
