const crypto = require('crypto');
const QRCode = require('qrcode');
const env = require('../config/env');
const { pool } = require('../config/db');
const HttpError = require('../utils/HttpError');

const TTL_MS = env.qrTtlSeconds * 1000;
const SCOPES = ['child'];

// Token IDs are 8 characters from a 32-symbol alphabet (no 0/O/1/I to avoid
// misreading when typed by hand): 32^8 ≈ 1.1 trillion combinations. With a
// 60-second lifetime and the QR rate limit (30 attempts/min), guessing one is
// not practical.
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const TOKEN_LENGTH = 8;

function randomTokenId() {
  const bytes = crypto.randomBytes(TOKEN_LENGTH);
  let out = '';
  for (let i = 0; i < TOKEN_LENGTH; i += 1) out += ALPHABET[bytes[i] % ALPHABET.length]; // 256 % 32 = 0, no bias
  return out;
}

/** Uppercase and strip spaces/dashes so "wrox-khg3" and "WROXKHG3" match. */
function normalizeTokenId(value) {
  return String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

/**
 * Only a keyed hash (HMAC-SHA256 with QR_ENCRYPTION_KEY) of the Token ID is
 * stored. A plain SHA-256 of an 8-character code could be brute-forced from a
 * database dump; the HMAC cannot without the server key.
 */
function hashTokenId(tokenId) {
  return crypto.createHmac('sha256', env.qrKey).update(tokenId).digest('hex');
}

/** HH:MM:SS in the server's local time (the LAN server's clock is the authority). */
function clockTime(ms) {
  const d = new Date(ms);
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/**
 * Plain-text payload read by a phone's built-in camera app. It contains only
 * the Token ID and its expiry time: no names, IDs or health data.
 */
function qrText(tokenId, expiresAt) {
  return [
    'CareSphere confidential token',
    `Token: ${tokenId}`,
    `Valid until: ${clockTime(expiresAt)}`,
    '',
    'Restricted: do not share this token',
    '',
    'For authorized staff use only. No personal or child health data is stored in this code.',
  ].join('\n');
}

/**
 * Issue a 60-second Token ID for one record.
 * Staff-issued tokens can only be redeemed by the same staff member.
 */
async function issueToken({ scope, targetId, issuedBy }) {
  if (!SCOPES.includes(scope)) throw new HttpError(400, `scope must be one of: ${SCOPES.join(', ')}`);
  const iat = Date.now();
  const issuedAt = new Date(iat);
  const expiresAt = iat + TTL_MS;

  let tokenId;
  let tokenHash;
  for (let attempt = 0; ; attempt += 1) {
    tokenId = randomTokenId();
    tokenHash = hashTokenId(tokenId);
    try {
      await pool.query(
        `INSERT INTO tbl_qr_sessions (token_hash, scope, target_id, issued_by, issued_at, expires_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [tokenHash, scope, String(targetId), issuedBy, issuedAt, new Date(expiresAt)]
      );
      break;
    } catch (err) {
      if (err.code !== 'ER_DUP_ENTRY' || attempt >= 4) throw err; // astronomically rare collision
    }
  }

  if (scope === 'child') {
    // Only the most recently issued code for a child is honoured.
    await pool.query('UPDATE tbl_children SET qr_token = ?, qr_created_at = ? WHERE child_id = ?',
      [tokenHash, issuedAt, targetId]);
  }

  const qrDataUrl = await QRCode.toDataURL(qrText(tokenId, expiresAt), { errorCorrectionLevel: 'M', margin: 1, width: 360 });
  return {
    token: tokenId,
    qr_data_url: qrDataUrl,
    issued_at: iat,
    expires_at: expiresAt,
    valid_until: clockTime(expiresAt),
    ttl_seconds: env.qrTtlSeconds,
  };
}

/**
 * Validate a typed Token ID.
 * Rejects: unknown or malformed IDs, wrong scope, wrong record, tokens older
 * than 60 s, revoked tokens, superseded child codes, and staff-issued tokens
 * presented by a different user.
 */
async function verifyToken(rawTokenId, { scope, targetId, userId } = {}) {
  const tokenId = normalizeTokenId(rawTokenId);
  if (!tokenId) throw new HttpError(401, 'Enter the Token ID shown on your phone.');
  const pattern = new RegExp(`^[${ALPHABET}]{${TOKEN_LENGTH}}$`);
  if (!pattern.test(tokenId)) throw new HttpError(401, 'That Token ID is not valid. Check it and try again.');

  const tokenHash = hashTokenId(tokenId);
  const [rows] = await pool.query(
    `SELECT s.scope, s.target_id, s.issued_by, s.revoked, r.role_name AS issuer_role,
            TIMESTAMPDIFF(SECOND, s.issued_at, NOW()) AS age_seconds
       FROM tbl_qr_sessions s
       JOIN tbl_users u ON u.user_id = s.issued_by
       JOIN tbl_roles r ON r.role_id = u.role_id
      WHERE s.token_hash = ? LIMIT 1`,
    [tokenHash]
  );
  const session = rows[0];
  if (!session) throw new HttpError(401, 'That Token ID is not valid. Check it and try again.');
  if (session.revoked) throw new HttpError(401, 'This token has been revoked. Generate a new one.');

  const age = Number(session.age_seconds);
  if (age < 0 || age > env.qrTtlSeconds) throw new HttpError(401, 'This token has expired. Generate a new one.');
  if (scope && session.scope !== scope) throw new HttpError(401, 'This token was issued for a different purpose.');
  if (targetId !== undefined && session.target_id !== String(targetId)) {
    throw new HttpError(403, 'This token belongs to a different record.');
  }
  if (session.issuer_role === 'Staff' && userId !== undefined && Number(session.issued_by) !== Number(userId)) {
    throw new HttpError(403, 'This token was generated by another staff member. Generate your own.');
  }

  if (session.scope === 'child') {
    const [children] = await pool.query('SELECT qr_token FROM tbl_children WHERE child_id = ?', [session.target_id]);
    if (!children[0]) throw new HttpError(404, 'Child record not found.');
    if (children[0].qr_token !== tokenHash) {
      throw new HttpError(401, 'A newer token has been issued for this child. Use the latest one.');
    }
  }

  const remaining = Math.max(0, env.qrTtlSeconds - age);
  return {
    scope: session.scope,
    target_id: session.target_id,
    expires_at: Date.now() + remaining * 1000,
    remaining_seconds: remaining,
  };
}

/** Typed tokens are single-use: once exchanged for health access, they stop working. */
async function consume(rawTokenId) {
  const tokenId = normalizeTokenId(rawTokenId);
  await pool.query('UPDATE tbl_qr_sessions SET revoked = TRUE WHERE token_hash = ?', [hashTokenId(tokenId)]);
}

async function revokeForTarget(scope, targetId) {
  await pool.query('UPDATE tbl_qr_sessions SET revoked = TRUE WHERE scope = ? AND target_id = ? AND expires_at > NOW()',
    [scope, String(targetId)]);
}

async function purgeExpired() {
  await pool.query('DELETE FROM tbl_qr_sessions WHERE expires_at < (NOW() - INTERVAL 1 DAY)');
  await pool.query('DELETE FROM tbl_revoked_tokens WHERE expires_at < NOW()');
}

module.exports = { issueToken, verifyToken, consume, revokeForTarget, purgeExpired, normalizeTokenId, qrText, TTL_MS };
