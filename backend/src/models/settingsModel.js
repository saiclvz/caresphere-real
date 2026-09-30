const { pool } = require('../config/db');

const ALLOWED = ['org_name', 'org_address', 'org_contact', 'receipt_footer', 'default_min_threshold'];

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
