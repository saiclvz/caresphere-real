const { withTransaction } = require('../config/db');
const Settings = require('../models/settingsModel');
const HttpError = require('../utils/HttpError');
const { logActivity } = require('../utils/audit');

exports.get = async (req, res) => {
  const all = await Settings.getAll();
  // Non-admins get only what the UI shows them: the organisation name and the Data Protection
  // Officer contact (shown in the applicant's privacy notice).
  res.json({ success: true, data: req.user.role === 'Admin' ? all
    : { org_name: all.org_name, dpo_name: all.dpo_name, dpo_email: all.dpo_email, dpo_phone: all.dpo_phone } });
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
    if (k === 'default_allocation_text' && (!String(v).trim() || String(v).length > 300)) throw new HttpError(400, 'Default allocation must be 1 to 300 characters.');
    if (k === 'notification_retention_days' && !(/^\d{2,4}$/.test(String(v)) && Number(v) >= 30 && Number(v) <= 3650)) throw new HttpError(400, 'Notification retention must be 30 to 3650 days.');
    if (k === 'id_scan_retention_days' && !(/^\d{1,4}$/.test(String(v)) && Number(v) >= 1 && Number(v) <= 3650)) throw new HttpError(400, 'ID scan retention must be 1 to 3650 days.');
    if (k === 'access_log_retention_months' && !(/^\d{1,3}$/.test(String(v)) && Number(v) >= 12 && Number(v) <= 240)) {
      throw new HttpError(400, 'Access log retention must be 12 to 240 months.');
    }
    if (k === 'staff_download_doc_types') {
      // Keep only current document types (removed types are dropped quietly).
      const { DOCUMENTS, STAGE_DOCUMENTS } = require('../config/adoptionForm');
      const entry = updates.find(([key]) => key === k);
      entry[1] = String(v).split(',').map((x) => x.trim()).filter((x) => DOCUMENTS[x] || STAGE_DOCUMENTS[x]).join(',');
    }
  }
  await withTransaction(async (conn) => {
    for (const [k, v] of updates) await Settings.set(k, String(v).trim(), req.user.user_id, conn);
  });
  await logActivity(req, `UPDATE_SETTINGS (${updates.map(([k]) => k).join(', ')})`, 'Settings');
  res.json({ success: true, data: await Settings.getAll() });
};
