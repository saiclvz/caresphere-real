const { pool } = require('../config/db');

/**
 * Write an audit-trail row. Failures are logged but never break the
 * request that triggered them.
 */
async function logActivity(req, action, entity, userIdOverride) {
  const userId = userIdOverride ?? req.user?.user_id;
  if (!userId) return;
  const ip = (req.ip || req.socket?.remoteAddress || '').replace(/^::ffff:/, '').slice(0, 45);
  try {
    await pool.query(
      'INSERT INTO tbl_activity_logs (user_id, action_performed, target_entity, ip_address) VALUES (?, ?, ?, ?)',
      [userId, String(action).slice(0, 255), String(entity).slice(0, 100), ip]
    );
  } catch (err) {
    console.error('[audit] Failed to write activity log:', err.message);
  }
}

module.exports = { logActivity };
