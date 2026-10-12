const { pool } = require('../config/db');
const { deviceType } = require('./device');

/**
 * Write an audit-trail row. Failures are logged but never break the
 * request that triggered them.
 */
const ipOf = (req) => (req.ip || req.socket?.remoteAddress || '').replace(/^::ffff:/, '').slice(0, 45);

async function logActivity(req, action, entity, userIdOverride, roleOverride) {
  const userId = userIdOverride ?? req.user?.user_id;
  if (!userId) return;
  const role = roleOverride ?? req.user?.role ?? null;
  try {
    await pool.query(
      'INSERT INTO tbl_activity_logs (user_id, user_role, action_performed, target_entity, ip_address, device_type) VALUES (?, ?, ?, ?, ?, ?)',
      [userId, role, String(action).slice(0, 255), String(entity).slice(0, 100), ipOf(req), deviceType(req)]
    );
  } catch (err) {
    console.error('[audit] Failed to write activity log:', err.message);
  }
}

/**
 * Writes an audit row on an existing connection, so it commits or rolls back together
 * with the rest of a transaction.
 */
async function logActivityWith(conn, req, action, entity) {
  await conn.query(
    'INSERT INTO tbl_activity_logs (user_id, user_role, action_performed, target_entity, ip_address, device_type) VALUES (?, ?, ?, ?, ?, ?)',
    [req.user.user_id, req.user.role || null, String(action).slice(0, 255), String(entity).slice(0, 100), ipOf(req), deviceType(req)]);
}

/**
 * An activity row written by the system on behalf of a user (no request): e.g. the automatic ID checks that
 * run after an upload. The action text says it was automatic. Never throws.
 */
async function logSystemActivity(conn, userId, action, entity) {
  if (!userId) return;
  try {
    const [[u]] = await conn.query('SELECT r.role_name AS role FROM tbl_users u JOIN tbl_roles r ON r.role_id = u.role_id WHERE u.user_id = ?', [userId]);
    await conn.query('INSERT INTO tbl_activity_logs (user_id, user_role, action_performed, target_entity, ip_address, device_type) VALUES (?, ?, ?, ?, NULL, NULL)',
      [userId, u?.role || null, String(action).slice(0, 255), String(entity).slice(0, 100)]);
  } catch (err) {
    console.error('[audit] Failed to write system activity:', err.message);
  }
}

/**
 * Security events (failed logins, lockouts, unauthorized access, token failures). The user may be
 * unknown, so these go to tbl_security_events. Only a hash of a typed email is stored.
 */
async function logSecurityEvent(req, type, { userId = null, email = null, detail = null } = {}) {
  const emailHash = email ? require('crypto').createHash('sha256').update(String(email).trim().toLowerCase()).digest('hex') : null;
  try {
    await pool.query('INSERT INTO tbl_security_events (event_type, user_id, email_hash, detail, ip_address) VALUES (?, ?, ?, ?, ?)',
      [String(type).slice(0, 40), userId ?? req.user?.user_id ?? null, emailHash, detail ? String(detail).slice(0, 500) : null, ipOf(req)]);
  } catch (err) {
    console.error('[audit] Failed to write security event:', err.message);
  }
}

module.exports = { logActivity, logActivityWith, logSystemActivity, logSecurityEvent };
