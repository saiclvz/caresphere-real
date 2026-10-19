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

// ---------------------------------------------------------------- what changed (migration 034)
const show = (v) => {
  if (v === undefined || v === null || v === '') return null;
  if (v instanceof Date) {
    if (Number.isNaN(v.getTime())) return null;
    const p = (n) => String(n).padStart(2, '0');
    const t = `${v.getFullYear()}-${p(v.getMonth() + 1)}-${p(v.getDate())} ${p(v.getHours())}:${p(v.getMinutes())}:${p(v.getSeconds())}`;
    return t.replace(/ 00:00:00$/, '');
  }
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  if (typeof v === 'object') return JSON.stringify(v).slice(0, 500);
  return String(v).slice(0, 500);
};
const norm = (v) => { const x = show(v); return x === null ? null : String(x).replace(/T(\d{2}:\d{2}(:\d{2})?).*$/, ' $1').replace(/ 00:00(:00)?$/, ''); };
const same = (a, b) => norm(a) === norm(b) || (typeof a === 'number' || typeof b === 'number' ? Number(a) === Number(b) && a !== null && b !== null && a !== '' && b !== '' : false);

/**
 * The fields that differ between `before` and `after` (only keys present in `after`).
 * `sensitive`: field names whose values are never stored (the entry only says the field changed).
 * `labels`: friendly field names. `skip`: fields to ignore.
 */
function diff(before = {}, after = {}, { sensitive = [], labels = {}, skip = [] } = {}) {
  const out = [];
  for (const k of Object.keys(after)) {
    if (skip.includes(k) || same(before?.[k], after[k])) continue;
    const s = sensitive.includes(k);
    out.push({ field: labels[k] || k, old: s ? null : show(before?.[k]), new: s ? null : show(after[k]), sensitive: s });
  }
  return out;
}

/**
 * An audit entry with its result (SUCCESS or DENIED), an optional reason and the changed fields.
 * `conn` may be a transaction connection (commits with it) or omitted (pool). Throws only inside a transaction.
 */
async function logChange(conn, req, action, entity, { changes = [], result = 'SUCCESS', reason = null } = {}) {
  const db = conn || pool;
  const run = async () => {
    const [r] = await db.query(
      'INSERT INTO tbl_activity_logs (user_id, user_role, action_performed, target_entity, ip_address, device_type, result, reason) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [req.user.user_id, req.user.role || null, String(action).slice(0, 255), String(entity).slice(0, 100), ipOf(req), deviceType(req), result, reason ? String(reason).slice(0, 500) : null]);
    for (const c of changes) {
      await db.query('INSERT INTO tbl_activity_log_changes (log_id, field_name, old_value, new_value, is_sensitive) VALUES (?, ?, ?, ?, ?)',
        [r.insertId, String(c.field).slice(0, 80), c.sensitive ? null : c.old, c.sensitive ? null : c.new, c.sensitive ? 1 : 0]);
    }
    return r.insertId;
  };
  if (conn) return run();
  try { return await run(); } catch (err) { console.error('[audit] Failed to write activity log:', err.message); return null; }
}

/** A refused attempt (result DENIED). Never throws; written outside any transaction so a rollback can't undo it. */
const logDenied = (req, action, entity, reason) => logChange(null, req, action, entity, { result: 'DENIED', reason });

module.exports = { logActivity, logActivityWith, logSystemActivity, logSecurityEvent, logChange, logDenied, diff };
