const crypto = require('crypto');
const env = require('../config/env');
const { pool } = require('../config/db');
const HttpError = require('../utils/HttpError');
const { sha256 } = require('../utils/crypto');

/**
 * Elevated access to a child's health record and confidential case files.
 *
 *  - A token is bound to ONE user and ONE child and lasts 180 seconds, measured
 *    by the database clock. The frontend timer is only a display.
 *  - Only a SHA-256 hash of the token is stored.
 *  - Every issue, denial, view, update, expiry and revocation is written to
 *    tbl_health_data_access_logs.
 */
const HEADER = 'X-Health-Access';

async function logEvent(req, childId, event, detail = null) {
  try {
    await pool.query(
      `INSERT INTO tbl_health_data_access_logs (user_id, child_id, event, detail, ip_address)
       VALUES (?, ?, ?, ?, ?)`,
      [req.user?.user_id || null, childId || null, event, detail ? String(detail).slice(0, 255) : null, req.ip || null]);
  } catch (err) {
    console.error('[health-log]', err.message); // logging must never block the request
  }
}

async function issue(req, childId, method, ttlSeconds = env.healthAccessTtlSeconds) {
  const token = crypto.randomBytes(32).toString('base64url');
  // One active grant per user per child: issuing a new one revokes the old.
  await pool.query(
    'UPDATE tbl_health_access_tokens SET revoked = TRUE WHERE user_id = ? AND child_id = ? AND revoked = FALSE',
    [req.user.user_id, childId]);
  await pool.query(
    `INSERT INTO tbl_health_access_tokens (token_hash, user_id, child_id, method, issued_at, expires_at)
     VALUES (?, ?, ?, ?, NOW(), NOW() + INTERVAL ? SECOND)`,
    [sha256(token), req.user.user_id, childId, method, ttlSeconds]);
  await logEvent(req, childId, 'TOKEN_ISSUED', `${method}, ${ttlSeconds}s`);
  return { access_token: token, remaining_seconds: ttlSeconds, ttl_seconds: ttlSeconds };
}

/** Express middleware: requires a valid X-Health-Access token for req.params.id. */
async function requireHealthAccess(req, res, next) {
  try {
    const childId = req.params.id;
    const token = req.get(HEADER);
    if (!token) {
      await logEvent(req, childId, 'TOKEN_MISSING');
      throw new HttpError(401, 'Health access is locked. Verify your access to continue.');
    }
    const [rows] = await pool.query(
      `SELECT token_id, user_id, child_id, revoked, TIMESTAMPDIFF(SECOND, NOW(), expires_at) AS remaining
         FROM tbl_health_access_tokens WHERE token_hash = ? LIMIT 1`, [sha256(token)]);
    const grant = rows[0];
    if (!grant || grant.user_id !== req.user.user_id || grant.child_id !== String(childId)) {
      await logEvent(req, childId, 'TOKEN_INVALID');
      throw new HttpError(403, 'This access token is not valid for this record.');
    }
    if (grant.revoked) {
      await logEvent(req, childId, 'TOKEN_REVOKED_USE');
      throw new HttpError(401, 'Health access was closed. Verify your access again.');
    }
    if (Number(grant.remaining) <= 0) {
      await pool.query('UPDATE tbl_health_access_tokens SET revoked = TRUE WHERE token_id = ?', [grant.token_id]);
      await logEvent(req, childId, 'TOKEN_EXPIRED');
      throw new HttpError(401, 'Health access expired. Unlock the record again.');
    }
    req.healthAccess = { token_id: grant.token_id, remaining_seconds: Number(grant.remaining) };
    next();
  } catch (err) {
    next(err);
  }
}

async function revoke(req, childId) {
  const token = req.get(HEADER);
  if (!token) return;
  const [result] = await pool.query(
    'UPDATE tbl_health_access_tokens SET revoked = TRUE WHERE token_hash = ? AND user_id = ? AND revoked = FALSE',
    [sha256(token), req.user.user_id]);
  if (result.affectedRows) await logEvent(req, childId, 'TOKEN_REVOKED');
}

async function purgeExpired() {
  await pool.query('DELETE FROM tbl_health_access_tokens WHERE expires_at < (NOW() - INTERVAL 1 DAY)');
}

module.exports = { HEADER, logEvent, issue, requireHealthAccess, revoke, purgeExpired };
