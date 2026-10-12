const { pool } = require('../config/db');

// dpo_*: Data Protection Officer contact (RA 10173), shown in the privacy notice.
const ALLOWED = ['org_name', 'org_address', 'org_contact', 'receipt_footer', 'default_min_threshold', 'dpo_name', 'dpo_email', 'dpo_phone',
  'access_log_retention_months', 'staff_download_doc_types', 'default_allocation_text', 'notification_retention_days', 'id_scan_retention_days'];

module.exports = {
  ALLOWED,
  async getAll() {
    const [rows] = await pool.query('SELECT setting_key, setting_value FROM tbl_settings');
    return Object.fromEntries(rows.map((r) => [r.setting_key, r.setting_value]));
  },
  async set(key, value, userId, conn = pool) {
    await conn.query(
      `INSERT INTO tbl_settings (setting_key, setting_value, updated_by) VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value), updated_by = VALUES(updated_by)`,
      [key, value, userId]);
  },
};
