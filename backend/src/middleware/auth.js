const jwt = require('jsonwebtoken');
const env = require('../config/env');
const { pool } = require('../config/db');
const HttpError = require('../utils/HttpError');

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

    // Role is read from the database, not trusted from the token, so role
    // changes and deactivations take effect immediately.
    req.user = {
      user_id: user.user_id,
      full_name: user.full_name,
      email: user.email,
      role: user.role_name,
    };
    req.auth = { jti: decoded.jti, exp: decoded.exp };
    next();
  } catch (err) {
    next(err);
  }
}

/** RBAC gate: authorize('Admin', 'Staff') */
const authorize = (...roles) => (req, res, next) => {
  if (!req.user) return next(sessionError('Sign in to continue.'));
  if (!roles.includes(req.user.role)) {
    return next(new HttpError(403, 'Your role does not have access to this resource.'));
  }
  next();
};

module.exports = { authenticate, authorize };
