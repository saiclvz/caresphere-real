const jwt = require('jsonwebtoken');
const env = require('../config/env');
const { pool } = require('../config/db');
const HttpError = require('../utils/HttpError');
const { logSecurityEvent } = require('../utils/audit');

// Idle timeout (RA 10175): a session with no activity for this long is signed out.
const IDLE_MINUTES = Math.max(5, Number(process.env.SESSION_IDLE_MINUTES) || 30);

/** Verifies the Bearer JWT, checks the denylist, and loads the live user record. */
const sessionError = (message) => Object.assign(new HttpError(401, message), { session: true });

async function authenticate(req, res, next) {
  try {
    const header = req.headers.authorization || '';
    const [scheme, token] = header.split(' ');
    if (scheme !== 'Bearer' || !token) throw sessionError('Sign in to continue.');

    let decoded;
    try {
      decoded = jwt.verify(token, env.jwtSecret, { issuer: 'caresphere', algorithms: ['HS256'] });
    } catch {
      throw sessionError('Your session has expired. Sign in again.');
    }

    const [revoked] = await pool.query('SELECT 1 FROM tbl_revoked_tokens WHERE jti = ? LIMIT 1', [decoded.jti]);
    if (revoked.length) throw sessionError('You have been signed out. Sign in again.');

    const [rows] = await pool.query(
      `SELECT u.user_id, u.full_name, u.email, u.is_active, r.role_name,
              UNIX_TIMESTAMP(u.tokens_valid_after) AS valid_after
         FROM tbl_users u JOIN tbl_roles r ON r.role_id = u.role_id
        WHERE u.user_id = ?`,
      [decoded.sub]
    );
    const user = rows[0];
    if (!user || !user.is_active) throw sessionError('This account is no longer active.');
    // Sessions issued before an MFA reset (or similar) no longer work.
    if (user.valid_after && decoded.iat < Number(user.valid_after)) throw sessionError('Your session has ended. Sign in again.');
    // Admin access requires a session that passed two-step verification. This also
    // catches sessions from before MFA was enforced, and accounts promoted to Admin.
    if (user.role_name === 'Admin' && decoded.mfa !== true) {
      throw sessionError('Administrator accounts must sign in with two-step verification. Sign in again.');
    }

    // Idle timeout. Background polling (header X-Background: 1) does not count as activity.
    const [[activity]] = await pool.query(
      'SELECT (last_seen < NOW() - INTERVAL ? MINUTE) AS idle, (last_seen < NOW() - INTERVAL 60 SECOND) AS stale FROM tbl_session_activity WHERE jti = ?',
      [IDLE_MINUTES, decoded.jti]);
    if (activity?.idle) {
      await pool.query('INSERT IGNORE INTO tbl_revoked_tokens (jti, expires_at) VALUES (?, FROM_UNIXTIME(?))', [decoded.jti, decoded.exp]);
      // Signing out (here, for inactivity) locks sensitive sections again, as on Sign out.
      await pool.query('DELETE FROM tbl_protected_grants WHERE user_id = ?', [user.user_id]);
      await require('../services/unlockService').endForUser(user.user_id);
      await require('../services/childAccess').endMonitoringForUser(user.user_id, 'signed_out').catch(() => {});
      throw sessionError(`You were signed out after ${IDLE_MINUTES} minutes without activity. Sign in again.`);
    }
    if (req.headers['x-background'] !== '1' && (!activity || activity.stale)) {
      await pool.query(
        'INSERT INTO tbl_session_activity (jti, user_id, last_seen) VALUES (?, ?, NOW()) ON DUPLICATE KEY UPDATE last_seen = NOW()',
        [decoded.jti, user.user_id]);
    }

    // Role is read from the database, not trusted from the token, so role
    // changes and deactivations take effect immediately.
    req.user = {
      user_id: user.user_id,
      full_name: user.full_name,
      email: user.email,
      role: user.role_name,
    };
    // Staff duties (the areas they may use), read fresh so a change applies on the next request.
    if (user.role_name === 'Staff') {
      const [duties] = await pool.query('SELECT duty FROM tbl_staff_duties WHERE user_id = ?', [user.user_id]);
      req.user.duties = duties.map((d) => d.duty);
    }
    req.auth = { jti: decoded.jti, exp: decoded.exp, iat: decoded.iat };
    next();
  } catch (err) {
    next(err);
  }
}

/** RBAC gate: authorize('Admin', 'Staff') */
const authorize = (...roles) => (req, res, next) => {
  if (!req.user) return next(sessionError('Sign in to continue.'));
  if (!roles.includes(req.user.role)) {
    logSecurityEvent(req, 'UNAUTHORIZED_ACCESS', { detail: `${req.method} ${req.originalUrl}`.slice(0, 300) });
    return next(new HttpError(403, 'ACCESS DENIED – You are not authorized to view this information.'));
  }
  next();
};

module.exports = { authenticate, authorize };
