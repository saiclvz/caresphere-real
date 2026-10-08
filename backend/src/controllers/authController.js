const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const env = require('../config/env');
const { pool } = require('../config/db');
const User = require('../models/userModel');
const HttpError = require('../utils/HttpError');
const { requireFields, isEmail } = require('../utils/validate');
const { logActivity, logSecurityEvent } = require('../utils/audit');
const { problem: passwordProblem } = require('../utils/passwordPolicy');
const mfa = require('../services/mfaService');

// Pre-computed hash so failed lookups take the same time as real comparisons.
const LOCK_AFTER = 10;
const LOCK_MINUTES = 15;
const DUMMY_HASH = bcrypt.hashSync('caresphere-timing-guard', 10);

/** `mfa: true` marks a session that passed two-step verification (required for Admin). */
function signSession(user, { mfa: mfaPassed = false } = {}) {
  const jti = crypto.randomUUID();
  const token = jwt.sign(
    { sub: user.user_id, role: user.role, name: user.full_name, jti, ...(mfaPassed ? { mfa: true } : {}) },
    env.jwtSecret,
    { expiresIn: env.jwtExpiresIn, issuer: 'caresphere', algorithm: 'HS256' }
  );
  return token;
}

const publicUser = (u) => ({ user_id: u.user_id, full_name: u.full_name, email: u.email, role: u.role });
/** The user for a sign-in response, with Staff duties so the menu is right straight away. */
async function sessionUser(u) {
  const out = publicUser(u);
  if (u.role === 'Staff') {
    const [d] = await require('../config/db').pool.query('SELECT duty FROM tbl_staff_duties WHERE user_id = ?', [u.user_id]);
    out.duties = d.map((x) => x.duty);
  }
  return out;
}

exports.login = async (req, res) => {
  const b = req.body || {};
  const email = String(b.email ?? '').trim().toLowerCase();
  const password = String(b.password ?? '');
  if (!email) throw new HttpError(400, 'Email is required.');
  if (!isEmail(email)) throw new HttpError(400, 'Enter a valid email address.');
  if (!password.trim()) throw new HttpError(400, 'Password is required.');

  const user = await User.findByEmailWithHash(email);
  const ok = await bcrypt.compare(password, user ? user.password_hash : DUMMY_HASH);

  // Per-account lockout (RA 10175): LOCK_AFTER wrong passwords lock the account for LOCK_MINUTES.
  if (user) {
    const [[lock]] = await pool.query(
      "SELECT (locked_until > NOW()) AS locked, DATE_FORMAT(locked_until, '%h:%i %p') AS until FROM tbl_users WHERE user_id = ?", [user.user_id]);
    if (lock?.locked) {
      await logSecurityEvent(req, 'LOGIN_WHILE_LOCKED', { userId: user.user_id });
      throw new HttpError(429, `Too many failed sign-in attempts. Try again after ${lock.until}.`);
    }
  }
  if (!user || !ok) {
    await logSecurityEvent(req, 'LOGIN_FAILED', { userId: user?.user_id ?? null, email });
    if (user) {
      await pool.query('UPDATE tbl_users SET failed_logins = failed_logins + 1 WHERE user_id = ?', [user.user_id]);
      const [[u]] = await pool.query('SELECT failed_logins FROM tbl_users WHERE user_id = ?', [user.user_id]);
      if (u.failed_logins >= LOCK_AFTER) {
        await pool.query('UPDATE tbl_users SET failed_logins = 0, locked_until = NOW() + INTERVAL ? MINUTE WHERE user_id = ?', [LOCK_MINUTES, user.user_id]);
        await logSecurityEvent(req, 'ACCOUNT_LOCKED', { userId: user.user_id, detail: `${LOCK_AFTER} failed sign-ins` });
      }
    }
    // One generic message: never reveal whether the email or the password was wrong.
    throw new HttpError(401, 'Incorrect email or password.');
  }
  await pool.query('UPDATE tbl_users SET failed_logins = 0, locked_until = NULL WHERE user_id = ?', [user.user_id]);
  if (!user.is_active) throw new HttpError(403, 'This account has been deactivated. Contact the administrator.');

  // Admins must pass two-step verification. No session is issued yet: the client gets a
  // short-lived challenge token that only the /auth/mfa/* endpoints accept.
  if (user.role === 'Admin') {
    const setup = !user.mfa_enabled;
    const mfaToken = await mfa.createChallenge(user.user_id, setup ? 'setup' : 'verify');
    await logActivity(req, 'LOGIN_PASSWORD_OK_MFA_PENDING', `User #${user.user_id}`, user.user_id);
    return res.json({ success: true, mfa_required: true, mfa_setup: setup, mfa_token: mfaToken, name: user.full_name });
  }

  const token = signSession(user);
  await logActivity(req, 'LOGIN', `User #${user.user_id}`, user.user_id);
  res.json({ success: true, token, user: await sessionUser(user) });
};

// ---------------------------------------------------------------- two-step verification (Admin)
/** POST /api/auth/mfa/setup/start { mfa_token } - QR code + manual key for the authenticator app. */
exports.mfaSetupStart = async (req, res) => {
  const ch = await mfa.loadChallenge(req.body?.mfa_token, 'setup');
  res.json({ success: true, data: await mfa.setupDetails(ch) });
};

/** POST /api/auth/mfa/setup/confirm { mfa_token, code } - turns MFA on, returns backup codes and the session. */
exports.mfaSetupConfirm = async (req, res) => {
  const ch = await mfa.loadChallenge(req.body?.mfa_token, 'setup');
  const { value } = mfa.readCode(req.body?.code, { allowBackup: false });
  let codes;
  try {
    codes = await mfa.completeSetup(ch, value);
  } catch (err) {
    await logActivity(req, 'MFA_FAILED (setup)', `User #${ch.user_id}`, ch.user_id);
    throw err;
  }
  const user = await User.findById(ch.user_id);
  await logActivity(req, 'MFA_ENROLLED', `User #${user.user_id}`, user.user_id);
  await logActivity(req, 'LOGIN', `User #${user.user_id}`, user.user_id);
  res.json({ success: true, token: signSession(user, { mfa: true }), user: await sessionUser(user), backup_codes: codes });
};

/** POST /api/auth/mfa/verify { mfa_token, code } - 6-digit code or a backup code. */
exports.mfaVerify = async (req, res) => {
  const ch = await mfa.loadChallenge(req.body?.mfa_token, 'verify');
  let used;
  try {
    used = await mfa.completeVerify(ch, req.body?.code);
  } catch (err) {
    await logActivity(req, 'MFA_FAILED', `User #${ch.user_id}`, ch.user_id);
    throw err;
  }
  const user = await User.findById(ch.user_id);
  if (!user?.is_active) throw new HttpError(403, 'This account has been deactivated. Contact the administrator.');
  if (used === 'backup') await logActivity(req, 'MFA_BACKUP_CODE_USED', `User #${user.user_id}`, user.user_id);
  await logActivity(req, 'LOGIN', `User #${user.user_id}`, user.user_id);
  res.json({
    success: true, token: signSession(user, { mfa: true }), user: await sessionUser(user),
    backup_codes_left: used === 'backup' ? await mfa.backupCodesLeft(user.user_id) : undefined,
  });
};

/**
 * Public self-registration. Always creates a Donor account (which includes Adopt a Child
 * and My applications). Admin and Staff accounts are created only by an Admin.
 * Any role or account_type sent by the client (including old clients) is ignored.
 */
exports.register = async (req, res) => {
  const b = req.body || {};
  const fullName = String(b.full_name ?? '').trim();
  const email = String(b.email ?? '').trim().toLowerCase();
  const password = String(b.password ?? '');
  const confirm = String(b.confirm_password ?? '');

  if (!fullName) throw new HttpError(400, 'Full name is required.');
  if (fullName.length < 2 || fullName.length > 100) throw new HttpError(400, 'Full name must be 2-100 characters.');
  if (!email) throw new HttpError(400, 'Email is required.');
  if (!isEmail(email) || email.length > 100) throw new HttpError(400, 'Enter a valid email address.');
  if (!password) throw new HttpError(400, 'Password is required.');
  const weak = passwordProblem(password, { email, name: fullName });
  if (weak) throw new HttpError(400, weak);
  if (!confirm) throw new HttpError(400, 'Confirm password is required.');
  if (password !== confirm) throw new HttpError(400, 'Passwords do not match.');
  if (await User.findByEmailWithHash(email)) throw new HttpError(409, 'An account with this email already exists.');

  const roleId = await User.roleId('Donor');
  if (!roleId) throw new HttpError(500, 'The Donor role is missing. Run npm run migrate.');
  const hash = await bcrypt.hash(password, env.bcryptRounds);
  const userId = await User.create({ full_name: fullName, email, password_hash: hash, role_id: roleId });
  const user = await User.findById(userId);

  await logActivity(req, 'REGISTER_DONOR', `User #${userId}`, userId);
  res.status(201).json({ success: true, token: signSession(user), user: await sessionUser(user) });
};

exports.logout = async (req, res) => {
  // Signing out locks every sensitive section again (protected grants end).
  await require('../services/protectedRecords').revokeGrantsForUser(req.user.user_id).catch(() => {});
  await require('../services/unlockService').endForUser(req.user.user_id).catch(() => {});
  await pool.query('INSERT IGNORE INTO tbl_revoked_tokens (jti, expires_at) VALUES (?, FROM_UNIXTIME(?))',
    [req.auth.jti, req.auth.exp]);
  await logActivity(req, 'LOGOUT', `User #${req.user.user_id}`);
  res.json({ success: true, message: 'Signed out.' });
};

exports.me = async (req, res) => {
  res.json({ success: true, user: req.user });
};

exports.changePassword = async (req, res) => {
  requireFields(req.body, ['current_password', 'new_password']);
  const weak = passwordProblem(String(req.body.new_password), { email: req.user.email, name: req.user.full_name });
  if (weak) throw new HttpError(400, weak);
  if (req.body.confirm_password !== undefined && req.body.confirm_password !== req.body.new_password) throw new HttpError(400, 'Passwords do not match.');
  const user = await User.findByEmailWithHash(req.user.email);
  if (!(await bcrypt.compare(String(req.body.current_password), user.password_hash))) {
    throw new HttpError(400, 'Current password is incorrect.');
  }
  const hash = await bcrypt.hash(String(req.body.new_password), env.bcryptRounds);
  // The change, its audit entry and (for donors) the "password changed" notice in one transaction.
  await require('../config/db').withTransaction(async (conn) => {
    await conn.query('UPDATE tbl_users SET password_hash = ? WHERE user_id = ?', [hash, req.user.user_id]);
    await require('../utils/audit').logActivityWith(conn, req, 'CHANGE_PASSWORD', `User #${req.user.user_id}`);
    if (req.user.role === 'Donor') await require('../services/notifications').emit(conn, 'password_changed', { userId: req.user.user_id });
  });
  res.json({ success: true, message: 'Password updated.' });
};
