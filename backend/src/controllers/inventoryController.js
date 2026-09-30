const Inventory = require('../models/inventoryModel');
const HttpError = require('../utils/HttpError');
const { requireFields, toInt, toBool } = require('../utils/validate');
const { logActivity } = require('../utils/audit');

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
  const id = await Inventory.create({ ...item, last_updated_by: req.user.user_id });
  await logActivity(req, 'CREATE_INVENTORY_ITEM', `Inventory #${id}`);
  res.status(201).json({ success: true, data: await Inventory.findById(id) });
};

/** PUT /api/inventory/:id  (Admin, Staff) - full edit with validation. */
exports.update = async (req, res) => {
  const item = await Inventory.findById(req.params.id);
  if (!item) throw new HttpError(404, 'Inventory item not found.');
  const fields = cleanItem(req.body, true);
  if (!Object.keys(fields).length) throw new HttpError(400, 'Nothing to update.');
  await Inventory.update(req.params.id, { ...fields, last_updated_by: req.user.user_id });
  const qty = fields.quantity !== undefined && fields.quantity !== item.quantity ? ` (qty ${item.quantity} -> ${fields.quantity})` : '';
  await logActivity(req, `UPDATE_INVENTORY_ITEM${qty}`, `Inventory #${req.params.id}`);
  res.json({ success: true, data: await Inventory.findById(req.params.id) });
};

exports.remove = async (req, res) => {
  const item = await Inventory.findById(req.params.id);
  if (!item) throw new HttpError(404, 'Inventory item not found.');
  await Inventory.remove(req.params.id);
  await logActivity(req, 'DELETE_INVENTORY_ITEM', `Inventory #${req.params.id}`);
  res.json({ success: true, message: 'Item deleted.' });
};
