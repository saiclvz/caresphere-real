/**
 * Two-step verification (TOTP, RFC 6238) for Admin accounts.
 * Built on Node's crypto module, so no extra packages are needed.
 * Works with Google Authenticator, Microsoft Authenticator, Authy, etc.
 */
const crypto = require('crypto');
const QRCode = require('qrcode');
const env = require('../config/env');
const { pool, withTransaction } = require('../config/db');
const HttpError = require('../utils/HttpError');
const { encrypt, decrypt, sha256, hmac, safeEqual } = require('../utils/crypto');

const ISSUER = 'CareSphere';
const PERIOD = 30;              // seconds per code
const DIGITS = 6;
const WINDOW = 1;               // accept the previous and next code (phone clock drift)
const CHALLENGE_SECONDS = 300;  // the code step must be finished within 5 minutes
const MAX_ATTEMPTS = 5;         // wrong codes per sign-in before starting over
const BACKUP_CODE_COUNT = 10;
const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const BACKUP_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I

/**
 * Key for encrypting TOTP secrets and hashing backup codes. Uses MFA_ENCRYPTION_KEY
 * from .env if present; otherwise a separate key derived from QR_ENCRYPTION_KEY, so
 * existing installs keep working without editing .env.
 */
const MFA_KEY = /^[0-9a-fA-F]{64}$/.test(process.env.MFA_ENCRYPTION_KEY || '')
  ? Buffer.from(process.env.MFA_ENCRYPTION_KEY, 'hex')
  : Buffer.from(crypto.hkdfSync('sha256', env.qrKey, Buffer.from('caresphere'), Buffer.from('mfa-totp-v1'), 32));

// ------------------------------------------------------------------ TOTP
function base32Encode(buf) {
  let bits = 0; let value = 0; let out = '';
  for (const byte of buf) {
    value = (value << 8) | byte; bits += 8;
    while (bits >= 5) { out += BASE32[(value >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) out += BASE32[(value << (5 - bits)) & 31];
  return out;
}

function base32Decode(str) {
  const clean = String(str).toUpperCase().replace(/[^A-Z2-7]/g, '');
  let bits = 0; let value = 0; const out = [];
  for (const ch of clean) {
    value = (value << 5) | BASE32.indexOf(ch); bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; }
  }
  return Buffer.from(out);
}

function codeAt(secretB32, step) {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const digest = crypto.createHmac('sha1', base32Decode(secretB32)).update(counter).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const bin = ((digest[offset] & 0x7f) << 24) | (digest[offset + 1] << 16) | (digest[offset + 2] << 8) | digest[offset + 3];
  return String(bin % 10 ** DIGITS).padStart(DIGITS, '0');
}

const currentStep = () => Math.floor(Date.now() / 1000 / PERIOD);

/** Returns the time step the code belongs to, or null if it doesn't match. */
function matchStep(secretB32, code) {
  const now = currentStep();
  for (let w = -WINDOW; w <= WINDOW; w += 1) {
    if (safeEqual(codeAt(secretB32, now + w), code)) return now + w;
  }
  return null;
}

// ------------------------------------------------------------------ codes
const isTotpCode = (v) => /^\d{6}$/.test(String(v ?? '').trim());
const normalizeBackup = (v) => String(v ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
const isBackupCode = (v) => /^[A-Z0-9]{8}$/.test(normalizeBackup(v));
const hashBackup = (v) => hmac(normalizeBackup(v), MFA_KEY);

function newBackupCode() {
  const bytes = crypto.randomBytes(8);
  let s = '';
  for (let i = 0; i < 8; i += 1) s += BACKUP_ALPHABET[bytes[i] % BACKUP_ALPHABET.length]; // 256 % 32 = 0, no bias
  return `${s.slice(0, 4)}-${s.slice(4)}`;
}

/** Validates the code field and returns { kind, value }. */
function readCode(raw, { allowBackup = true } = {}) {
  const v = String(raw ?? '').trim();
  if (!v) throw new HttpError(400, 'The 6-digit code is required.');
  if (isTotpCode(v)) return { kind: 'totp', value: v };
  if (allowBackup && isBackupCode(v)) return { kind: 'backup', value: v };
  throw new HttpError(400, allowBackup
    ? 'Enter the 6-digit code from your authenticator app, or a backup code like ABCD-EFGH.'
    : 'Enter the 6-digit code from your authenticator app.');
}

// ------------------------------------------------------------------ challenges
/** Starts the "password OK, code pending" step. Returns the one-time challenge token. */
async function createChallenge(userId, purpose) {
  const token = crypto.randomBytes(32).toString('base64url');
  // One pending sign-in per admin: older unfinished challenges stop working.
  await pool.query('UPDATE tbl_mfa_challenges SET consumed_at = NOW() WHERE user_id = ? AND consumed_at IS NULL', [userId]);
  await pool.query(
    `INSERT INTO tbl_mfa_challenges (challenge_hash, user_id, purpose, expires_at)
     VALUES (?, ?, ?, NOW() + INTERVAL ? SECOND)`, [sha256(token), userId, purpose, CHALLENGE_SECONDS]);
  return token;
}

const restart = (message) => new HttpError(401, message, { restart: true });

async function loadChallenge(token, purpose) {
  if (!token) throw restart('Your sign-in has expired. Sign in again.');
  const [rows] = await pool.query(
    `SELECT challenge_hash, user_id, purpose, pending_secret_enc, attempts, consumed_at,
            (expires_at < NOW()) AS expired
       FROM tbl_mfa_challenges WHERE challenge_hash = ?`, [sha256(String(token))]);
  const ch = rows[0];
  if (!ch || ch.consumed_at || ch.expired || ch.purpose !== purpose) throw restart('Your sign-in has expired. Sign in again.');
  if (ch.attempts >= MAX_ATTEMPTS) throw restart('Too many incorrect codes. Sign in again.');
  return ch;
}

/** Counts a wrong code. After MAX_ATTEMPTS the challenge is closed and the user must sign in again. */
async function failAttempt(ch, message) {
  await pool.query('UPDATE tbl_mfa_challenges SET attempts = attempts + 1 WHERE challenge_hash = ?', [ch.challenge_hash]);
  const left = MAX_ATTEMPTS - (ch.attempts + 1);
  if (left <= 0) {
    await pool.query('UPDATE tbl_mfa_challenges SET consumed_at = NOW() WHERE challenge_hash = ?', [ch.challenge_hash]);
    return restart('Too many incorrect codes. Sign in again.');
  }
  return new HttpError(401, `${message} ${left} attempt${left === 1 ? '' : 's'} left.`);
}

/** Marks the challenge used, exactly once (safe against double submits). */
async function consumeChallenge(conn, ch) {
  const [res] = await conn.query(
    'UPDATE tbl_mfa_challenges SET consumed_at = NOW() WHERE challenge_hash = ? AND consumed_at IS NULL', [ch.challenge_hash]);
  if (res.affectedRows !== 1) throw restart('This sign-in was already completed. Sign in again.');
}

// ------------------------------------------------------------------ setup
async function userEmail(userId) {
  const [[u]] = await pool.query('SELECT email FROM tbl_users WHERE user_id = ?', [userId]);
  return u?.email || 'admin';
}

/** Creates (or re-shows) the secret for setup. Returns the QR code and manual key. */
async function setupDetails(ch) {
  let secret = ch.pending_secret_enc ? decrypt(ch.pending_secret_enc, MFA_KEY) : null;
  if (!secret) {
    secret = base32Encode(crypto.randomBytes(20)); // 160-bit secret, as RFC 4226 recommends
    await pool.query('UPDATE tbl_mfa_challenges SET pending_secret_enc = ? WHERE challenge_hash = ?',
      [encrypt(secret, MFA_KEY), ch.challenge_hash]);
  }
  const email = await userEmail(ch.user_id);
  const label = encodeURIComponent(`${ISSUER}:${email}`);
  const otpauth = `otpauth://totp/${label}?secret=${secret}&issuer=${ISSUER}&algorithm=SHA1&digits=${DIGITS}&period=${PERIOD}`;
  return {
    qr_data_url: await QRCode.toDataURL(otpauth, { margin: 1, width: 220 }),
    manual_key: secret.match(/.{1,4}/g).join(' '),
    account: email,
    issuer: ISSUER,
  };
}

/** Verifies the first code, turns MFA on, and returns fresh backup codes (shown once). */
async function completeSetup(ch, code) {
  const secret = ch.pending_secret_enc ? decrypt(ch.pending_secret_enc, MFA_KEY) : null;
  if (!secret) throw restart('Setup was interrupted. Sign in again.');
  const step = matchStep(secret, code);
  if (step === null) throw await failAttempt(ch, 'That code is incorrect. Check that your phone’s time is set automatically, then try again.');

  const codes = Array.from({ length: BACKUP_CODE_COUNT }, newBackupCode);
  await withTransaction(async (conn) => {
    await consumeChallenge(conn, ch);
    await conn.query(
      `UPDATE tbl_users SET mfa_enabled = TRUE, mfa_secret_enc = ?, mfa_last_step = ?, mfa_enrolled_at = NOW()
        WHERE user_id = ?`, [encrypt(secret, MFA_KEY), step, ch.user_id]);
    await conn.query('DELETE FROM tbl_mfa_backup_codes WHERE user_id = ?', [ch.user_id]);
    await conn.query('INSERT INTO tbl_mfa_backup_codes (user_id, code_hash) VALUES ?',
      [codes.map((c) => [ch.user_id, hashBackup(c)])]);
  });
  return codes;
}

// ------------------------------------------------------------------ verify
/**
 * Checks a TOTP or backup code for a user and "spends" it so it can't be used again.
 * Returns 'totp' | 'backup' on success, or null if the code is wrong or already used.
 */
async function checkUserCode(conn, userId, { kind, value }) {
  if (kind === 'backup') {
    const [res] = await conn.query(
      'UPDATE tbl_mfa_backup_codes SET used_at = NOW() WHERE user_id = ? AND code_hash = ? AND used_at IS NULL',
      [userId, hashBackup(value)]);
    return res.affectedRows === 1 ? 'backup' : null;
  }
  const [[u]] = await conn.query('SELECT mfa_secret_enc FROM tbl_users WHERE user_id = ? AND mfa_enabled = TRUE', [userId]);
  if (!u?.mfa_secret_enc) return null;
  const step = matchStep(decrypt(u.mfa_secret_enc, MFA_KEY), value);
  if (step === null) return null;
  // Only accept a code newer than the last one accepted (blocks replaying a code).
  const [res] = await conn.query(
    'UPDATE tbl_users SET mfa_last_step = ? WHERE user_id = ? AND (mfa_last_step IS NULL OR mfa_last_step < ?)',
    [step, userId, step]);
  return res.affectedRows === 1 ? 'totp' : null;
}

/** Sign-in step 2. Returns 'totp' | 'backup'. Throws on a wrong or reused code. */
async function completeVerify(ch, code) {
  const parsed = readCode(code);
  let used = null;
  await withTransaction(async (conn) => {
    used = await checkUserCode(conn, ch.user_id, parsed);
    if (used) await consumeChallenge(conn, ch);
  });
  if (!used) {
    throw await failAttempt(ch, parsed.kind === 'backup'
      ? 'That backup code is incorrect or was already used.'
      : 'That code is incorrect or was already used. Wait for the next code and try again.');
  }
  return used;
}

async function backupCodesLeft(userId) {
  const [[r]] = await pool.query('SELECT COUNT(*) AS n FROM tbl_mfa_backup_codes WHERE user_id = ? AND used_at IS NULL', [userId]);
  return Number(r.n);
}

/** Step-up check for sensitive admin actions (e.g. resetting someone's MFA). */
async function verifyStepUp(userId, code) {
  const parsed = readCode(code);
  let used = null;
  await withTransaction(async (conn) => { used = await checkUserCode(conn, userId, parsed); });
  return used;
}

/** Turns MFA off for a user (lost device). They set it up again at next sign-in. */
async function reset(userId) {
  await withTransaction(async (conn) => {
    await conn.query(
      `UPDATE tbl_users SET mfa_enabled = FALSE, mfa_secret_enc = NULL, mfa_last_step = NULL, mfa_enrolled_at = NULL,
              tokens_valid_after = NOW() WHERE user_id = ?`, [userId]);
    await conn.query('DELETE FROM tbl_mfa_backup_codes WHERE user_id = ?', [userId]);
    await conn.query('UPDATE tbl_mfa_challenges SET consumed_at = NOW() WHERE user_id = ? AND consumed_at IS NULL', [userId]);
  });
}

async function purgeExpired() {
  await pool.query('DELETE FROM tbl_mfa_challenges WHERE expires_at < (NOW() - INTERVAL 1 DAY)');
}

module.exports = {
  createChallenge, loadChallenge, setupDetails, completeSetup, completeVerify,
  readCode, backupCodesLeft, verifyStepUp, reset, purgeExpired,
  // exported for tests
  _internal: { base32Encode, base32Decode, codeAt, matchStep, newBackupCode, normalizeBackup },
};
