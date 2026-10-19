/**
 * Re-authentication for high-risk Admin actions (Payment QR changes and approvals): the Admin types their password
 * and a current two-step code again. A success gives a one-time grant, valid REAUTH_SECONDS, bound to the user, the
 * signed-in session and the purpose. Only its SHA-256 is stored. The grant travels in the X-Reauth header (never in
 * a URL or a log) and is spent by the action it was for.
 * Wrong attempts: MAX_FAILURES in WINDOW_MINUTES lock re-authentication for that user (and are logged).
 */
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { pool } = require('../config/db');
const HttpError = require('../utils/HttpError');
const { sha256 } = require('../utils/crypto');
const mfa = require('./mfaService');
const { logActivity } = require('../utils/audit');

const REAUTH_SECONDS = 300;
const MAX_FAILURES = 5;
const WINDOW_MINUTES = 15;
// payment_qr: Payment QR changes. donation_controls: the donation limits and controls in Settings (turning off the
// second-Admin rule or segregation of duties must not be a one-click change).
const PURPOSES = ['payment_qr', 'donation_controls'];
const HEADER = 'x-reauth';
const failures = new Map(); // userId -> [timestamps] (single-process LAN server; also logged)

function recentFailures(userId) {
  const since = Date.now() - WINDOW_MINUTES * 60 * 1000;
  const list = (failures.get(userId) || []).filter((t) => t > since);
  failures.set(userId, list);
  return list.length;
}

/** POST /api/auth/reauth { password, code, purpose } -> { grant, expires_in } */
async function start(req, body) {
  if (req.user.role !== 'Admin') throw new HttpError(403, 'Only an administrator can do this.');
  const purpose = String(body?.purpose || '');
  if (!PURPOSES.includes(purpose)) throw new HttpError(400, 'Unknown purpose.');
  if (recentFailures(req.user.user_id) >= MAX_FAILURES) throw new HttpError(429, `Too many attempts. Try again in ${WINDOW_MINUTES} minutes.`);
  const password = String(body?.password ?? '');
  const [[u]] = await pool.query('SELECT password_hash FROM tbl_users WHERE user_id = ? AND is_active = TRUE', [req.user.user_id]);
  const passOk = !!u && password.length > 0 && await bcrypt.compare(password, u.password_hash);
  let codeOk = false;
  if (passOk) {
    try { codeOk = !!(await mfa.verifyStepUp(req.user.user_id, body?.code)); } catch { codeOk = false; }
  }
  if (!passOk || !codeOk) {
    (failures.get(req.user.user_id) || failures.set(req.user.user_id, []).get(req.user.user_id)).push(Date.now());
    await logActivity(req, `REAUTH_FAILED (${purpose})`, `User #${req.user.user_id}`);
    // One message: never say whether the password or the code was wrong.
    throw new HttpError(401, 'The password or the two-step code is incorrect.');
  }
  const grant = crypto.randomBytes(32).toString('base64url');
  await pool.query('INSERT INTO tbl_reauth_grants (grant_hash, user_id, session_jti, purpose, expires_at) VALUES (?, ?, ?, ?, NOW() + INTERVAL ? SECOND)',
    [sha256(grant), req.user.user_id, String(req.auth?.jti || ''), purpose, REAUTH_SECONDS]);
  await logActivity(req, `REAUTH_OK (${purpose})`, `User #${req.user.user_id}`);
  return { grant, expires_in: REAUTH_SECONDS };
}

/** Spends the grant in the X-Reauth header for this purpose (once). Throws 401 { reauth: true } otherwise. */
async function consume(conn, req, purpose) {
  const grant = String(req.headers?.[HEADER] || '');
  const need = new HttpError(401, 'Confirm it is you: enter your password and two-step code again.', { reauth: true });
  if (!grant || grant.length > 100) throw need;
  const [r] = await conn.query(
    `UPDATE tbl_reauth_grants SET used_at = NOW()
      WHERE grant_hash = ? AND user_id = ? AND session_jti = ? AND purpose = ? AND used_at IS NULL AND expires_at > NOW()`,
    [sha256(grant), req.user.user_id, String(req.auth?.jti || ''), purpose]);
  if (r.affectedRows !== 1) throw need;
}

async function purgeOld() {
  await pool.query('DELETE FROM tbl_reauth_grants WHERE expires_at < NOW() - INTERVAL 1 DAY');
}

module.exports = { start, consume, purgeOld, REAUTH_SECONDS, HEADER, _failures: failures };
