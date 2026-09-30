const { withTransaction } = require('../config/db');
const Settings = require('../models/settingsModel');
const HttpError = require('../utils/HttpError');
const { logActivity } = require('../utils/audit');

exports.get = async (req, res) => {
  const all = await Settings.getAll();
  // Non-admins only need the organisation name for the UI.
  res.json({ success: true, data: req.user.role === 'Admin' ? all : { org_name: all.org_name } });
};

exports.update = async (req, res) => {
  const updates = Object.entries(req.body || {}).filter(([k]) => Settings.ALLOWED.includes(k));
  if (!updates.length) throw new HttpError(400, 'No recognised settings were provided.');
  for (const [k, v] of updates) {
    if (String(v).length > 1000) throw new HttpError(400, `${k} is too long.`);
    if (k === 'default_min_threshold' && !/^\d{1,6}$/.test(String(v))) {
      throw new HttpError(400, 'Default minimum threshold must be a whole number.');
    }
    if (k === 'org_name' && !String(v).trim()) throw new HttpError(400, 'Organisation name is required.');
  }
  await withTransaction(async (conn) => {
    for (const [k, v] of updates) await Settings.set(k, String(v).trim(), req.user.user_id, conn);
  });
  await logActivity(req, `UPDATE_SETTINGS (${updates.map(([k]) => k).join(', ')})`, 'Settings');
  res.json({ success: true, data: await Settings.getAll() });
};
