/**
 * Protected records with token access.
 *  - Each protected record has a random public UUID: the only thing inside its QR code.
 *  - Admin opens protected records directly (sealed birth records also need a reason and
 *    the NACC order number). Staff need a token Admin issued for that one record and that
 *    one staff user; a valid token gives a short server-side grant (never the token in a URL).
 *  - Tokens: crypto-random, 12 characters from an alphabet without look-alikes, shown once,
 *    stored only as a SHA-256 hash, compared in constant time, locked after 5 wrong tries.
 * Every issue, use, failure, lock, expiry, revocation, view and download is logged.
 */
const crypto = require('crypto');
const { pool, withTransaction } = require('../config/db');
const HttpError = require('../utils/HttpError');
const { sha256, safeEqual } = require('../utils/crypto');
const { logActivity, logSecurityEvent } = require('../utils/audit');
const { AFTER_ORDER } = require('../config/adoptionWorkflow');
const { deviceType } = require('../utils/device');

const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // no I, L, O, 0, 1
const TOKEN_LENGTH = 12;
const MAX_FAILED = 5;
const DEFAULT_HOURS = 8;
const MAX_HOURS = 7 * 24;
const DENIED = 'Access denied.';
const SEALED_GRANT_MINUTES = 15;

const ipOf = (req) => (req.ip || '').replace(/^::ffff:/, '').slice(0, 45);
const normalizeToken = (t) => String(t || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
const formatToken = (t) => t.match(/.{1,4}/g).join('-');

function newToken() {
  let t = '';
  for (let i = 0; i < TOKEN_LENGTH; i += 1) t += ALPHABET[crypto.randomInt(ALPHABET.length)];
  return t;
}

async function log(event, { req, recordId = null, tokenId = null, userId, detail = null }) {
  await pool.query('INSERT INTO tbl_protected_access_log (event, record_id, token_id, user_id, detail, ip_address, device_type) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [event, recordId, tokenId, userId ?? req.user.user_id, detail ? String(detail).slice(0, 500) : null, ipOf(req), deviceType(req)]);
}

/** Creates a protected record (inside the caller's transaction). Returns { record_id, public_id }. */
async function createRecord(conn, { type, label, applicationId = null, documentId = null, childId = null, sealedId = null, createdBy }) {
  const publicId = crypto.randomUUID();
  const [res] = await conn.query(
    `INSERT INTO tbl_protected_records (public_id, record_type, label, application_id, document_id, child_id, sealed_id, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, [publicId, type, String(label).slice(0, 150), applicationId, documentId, childId, sealedId, createdBy]);
  return { record_id: res.insertId, public_id: publicId };
}

async function findByPublicId(publicId) {
  if (!/^[0-9a-f-]{36}$/i.test(String(publicId || ''))) return null;
  const [[r]] = await pool.query('SELECT * FROM tbl_protected_records WHERE public_id = ?', [publicId]);
  return r || null;
}

/** The file behind a record: { storage_key, mime_type, original_name, sha256 }. */
async function fileFor(record) {
  if (record.document_id) {
    const [[d]] = await pool.query('SELECT storage_key, mime_type, original_name, sha256 FROM tbl_adoption_documents WHERE document_id = ?', [record.document_id]);
    return d || null;
  }
  if (record.sealed_id) {
    const [[s]] = await pool.query('SELECT storage_key, mime_type, original_name, sha256 FROM tbl_sealed_records WHERE sealed_id = ?', [record.sealed_id]);
    return s || null;
  }
  if (record.record_type === 'cdclaa' && record.child_id) {
    const [[c]] = await pool.query(
      'SELECT cdclaa_storage_key AS storage_key, cdclaa_mime AS mime_type, cdclaa_original_name AS original_name, cdclaa_sha256 AS sha256 FROM tbl_children WHERE child_id = ?',
      [record.child_id]);
    return c?.storage_key ? c : null;
  }
  return null;
}

/** The child a sealed record belongs to. */
async function sealedChild(record) {
  const [[s]] = await pool.query('SELECT child_id FROM tbl_sealed_records WHERE sealed_id = ?', [record.sealed_id]);
  return s?.child_id || null;
}

/**
 * Sealed original birth record rule: a typed reason and the NACC order number recorded for
 * this child's finalized adoption. Logs the access. Throws on a missing or wrong value.
 */
async function checkSealedAccess(req, record, body, { viaToken }) {
  const reason = String(body?.reason || '').trim();
  const orderNumber = String(body?.order_number || '').trim();
  if (reason.length < 10) throw new HttpError(400, 'Type the reason for opening this sealed record (at least 10 characters).');
  if (reason.length > 500) throw new HttpError(400, 'The reason can be up to 500 characters.');
  if (!orderNumber) throw new HttpError(400, 'Enter the NACC Order of Adoption number.');
  const childId = await sealedChild(record);
  const [[match]] = await pool.query(
    'SELECT application_id FROM tbl_adoption_applications WHERE matched_child_id = ? AND UPPER(order_number) = UPPER(?) AND status IN (?) LIMIT 1',
    [childId, orderNumber, AFTER_ORDER]);
  if (!match) {
    await logSecurityEvent(req, 'SEALED_ACCESS_DENIED', { detail: `record ${record.record_id}` });
    throw new HttpError(403, 'The NACC order number does not match a recorded Order of Adoption for this child. The record stays sealed.');
  }
  await pool.query(
    'INSERT INTO tbl_sealed_access_log (sealed_id, child_id, user_id, reason, order_number, via_token, ip_address) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [record.sealed_id, childId, req.user.user_id, reason, orderNumber, viaToken ? 1 : 0, ipOf(req)]);
  await logActivity(req, `OPEN_SEALED_RECORD (order ${orderNumber})`, `Protected #${record.record_id}`);
}

async function createGrant(conn, { tokenId = null, recordId, userId, expiresAt }) {
  const secret = crypto.randomBytes(32).toString('base64url');
  // Admin sealed-record grants have no token (token_id NULL).
  await conn.query('INSERT INTO tbl_protected_grants (grant_hash, token_id, record_id, user_id, expires_at) VALUES (?, ?, ?, ?, ?)',
    [sha256(secret), tokenId, recordId, userId, expiresAt]);
  return secret;
}

// ------------------------------------------------------------------ Admin: tokens

async function issueToken(req, recordId, body) {
  const [[record]] = await pool.query('SELECT record_id, label FROM tbl_protected_records WHERE record_id = ?', [recordId]);
  if (!record) throw new HttpError(404, 'Protected record not found.');
  const staffId = Number(body?.staff_user_id);
  const [[staff]] = await pool.query(
    "SELECT u.user_id, u.full_name, u.is_active, r.role_name FROM tbl_users u JOIN tbl_roles r ON r.role_id = u.role_id WHERE u.user_id = ?", [staffId]);
  if (!staff || staff.role_name !== 'Staff' || !staff.is_active) throw new HttpError(400, 'Choose an active Staff account.');
  const hours = body?.expires_hours === undefined || body.expires_hours === '' ? DEFAULT_HOURS : Number(body.expires_hours);
  if (!Number.isInteger(hours) || hours < 1 || hours > MAX_HOURS) throw new HttpError(400, `Expiry must be 1 to ${MAX_HOURS} hours (7 days).`);
  const maxUses = body?.max_uses === undefined || body.max_uses === '' ? 3 : Number(body.max_uses);
  if (!Number.isInteger(maxUses) || maxUses < 1 || maxUses > 20) throw new HttpError(400, 'Max uses must be 1 to 20.');
  const purpose = String(body?.purpose || '').trim();
  if (purpose.length < 5) throw new HttpError(400, 'State the purpose (at least 5 characters).');
  if (purpose.length > 500) throw new HttpError(400, 'The purpose can be up to 500 characters.');

  const token = newToken();
  const [res] = await pool.query(
    `INSERT INTO tbl_protected_tokens (token_hash, record_id, staff_user_id, purpose, expires_at, max_uses, issued_by)
     VALUES (?, ?, ?, ?, NOW() + INTERVAL ? HOUR, ?, ?)`, [sha256(token), recordId, staffId, purpose, hours, maxUses, req.user.user_id]);
  await log('issued', { req, recordId, tokenId: res.insertId, detail: `to user #${staffId}, ${hours} h, ${maxUses} use(s): ${purpose}` });
  await logActivity(req, `PROTECTED_TOKEN_ISSUED (to user #${staffId}, ${hours} h, ${maxUses} uses)`, `Protected #${recordId}`);
  const [[t]] = await pool.query('SELECT expires_at FROM tbl_protected_tokens WHERE token_id = ?', [res.insertId]);
  // The token is returned once and never stored.
  return { token_id: res.insertId, token: formatToken(token), staff_name: staff.full_name, expires_at: t.expires_at, max_uses: maxUses, record_label: record.label };
}

async function revokeToken(req, tokenId) {
  const [result] = await pool.query('UPDATE tbl_protected_tokens SET revoked_at = NOW(), revoked_by = ? WHERE token_id = ? AND revoked_at IS NULL',
    [req.user.user_id, tokenId]);
  if (!result.affectedRows) throw new HttpError(404, 'That token is not active.');
  const [[t]] = await pool.query('SELECT record_id FROM tbl_protected_tokens WHERE token_id = ?', [tokenId]);
  await pool.query('DELETE FROM tbl_protected_grants WHERE token_id = ?', [tokenId]);
  await log('revoked', { req, recordId: t.record_id, tokenId });
  await logActivity(req, 'PROTECTED_TOKEN_REVOKED', `Token #${tokenId}`);
}

/** Admin "Protected access" page: active tokens and recent access. */
async function accessOverview() {
  const [tokens] = await pool.query(
    `SELECT t.token_id, t.record_id, pr.label, pr.public_id, t.staff_user_id, u.full_name AS staff_name, t.purpose, t.expires_at,
            t.max_uses, t.uses, t.failed_attempts, t.created_at, ib.full_name AS issued_by_name
       FROM tbl_protected_tokens t JOIN tbl_protected_records pr ON pr.record_id = t.record_id
       JOIN tbl_users u ON u.user_id = t.staff_user_id JOIN tbl_users ib ON ib.user_id = t.issued_by
      WHERE t.revoked_at IS NULL AND t.locked_at IS NULL AND t.expires_at > NOW() AND t.uses < t.max_uses
      ORDER BY t.expires_at`);
  const [recent] = await pool.query(
    `SELECT l.log_id, l.event, l.record_id, pr.label, l.token_id, l.user_id, u.full_name AS user_name, l.detail, l.ip_address, l.created_at
       FROM tbl_protected_access_log l LEFT JOIN tbl_protected_records pr ON pr.record_id = l.record_id
       LEFT JOIN tbl_users u ON u.user_id = l.user_id ORDER BY l.created_at DESC, l.log_id DESC LIMIT 200`);
  return { tokens, recent };
}

// ------------------------------------------------------------------ Staff: unlock with a token

/**
 * Staff enters a token for a record. Any problem (no such record, wrong token, someone
 * else's token, expired, revoked, used up, locked) gives the same "Access denied".
 * Wrong tokens count against the user's active tokens for this record; 5 locks them.
 */
async function unlockWithToken(req, publicId, body) {
  const record = await findByPublicId(publicId);
  const typed = normalizeToken(body?.token);
  const userId = req.user.user_id;
  if (!record || typed.length !== TOKEN_LENGTH) {
    if (record) await log('failed', { req, recordId: record.record_id, detail: 'malformed token' });
    await logSecurityEvent(req, 'PROTECTED_TOKEN_FAILED', { detail: record ? `record ${record.record_id}` : 'unknown record' });
    throw new HttpError(403, DENIED);
  }
  const [tokens] = await pool.query(
    `SELECT token_id, token_hash, expires_at, (expires_at <= NOW()) AS expired, max_uses, uses, failed_attempts, locked_at, revoked_at
       FROM tbl_protected_tokens WHERE record_id = ? AND staff_user_id = ?`, [record.record_id, userId]);
  const hash = sha256(typed);
  let match = null;
  for (const t of tokens) if (safeEqual(t.token_hash, hash)) match = t; // check all, constant time each

  const usable = match && !match.revoked_at && !match.locked_at && !match.expired && match.uses < match.max_uses;
  if (!usable) {
    if (match?.expired) await log('expired', { req, recordId: record.record_id, tokenId: match.token_id });
    else await log('failed', { req, recordId: record.record_id, tokenId: match?.token_id ?? null, detail: match ? 'revoked, locked or used up' : 'wrong token' });
    await logSecurityEvent(req, 'PROTECTED_TOKEN_FAILED', { detail: `record ${record.record_id}` });
    if (!match) {
      // Count the wrong try against this user's live tokens for this record.
      const live = tokens.filter((t) => !t.revoked_at && !t.locked_at && !t.expired);
      for (const t of live) {
        await pool.query('UPDATE tbl_protected_tokens SET failed_attempts = failed_attempts + 1 WHERE token_id = ?', [t.token_id]);
        if (t.failed_attempts + 1 >= MAX_FAILED) {
          await pool.query('UPDATE tbl_protected_tokens SET locked_at = NOW() WHERE token_id = ? AND locked_at IS NULL', [t.token_id]);
          await pool.query('DELETE FROM tbl_protected_grants WHERE token_id = ?', [t.token_id]);
          await log('locked', { req, recordId: record.record_id, tokenId: t.token_id, detail: `${MAX_FAILED} wrong attempts` });
          await logSecurityEvent(req, 'PROTECTED_TOKEN_LOCKED', { detail: `token ${t.token_id}, record ${record.record_id}` });
          await logActivity(req, 'PROTECTED_TOKEN_LOCKED', `Token #${t.token_id}`);
        }
      }
    }
    throw new HttpError(403, DENIED);
  }

  if (record.record_type === 'sealed_birth_record') await checkSealedAccess(req, record, body, { viaToken: true });

  const grant = await withTransaction(async (conn) => {
    const [res] = await conn.query(
      'UPDATE tbl_protected_tokens SET uses = uses + 1, failed_attempts = 0 WHERE token_id = ? AND uses < max_uses AND revoked_at IS NULL AND locked_at IS NULL AND expires_at > NOW()',
      [match.token_id]);
    if (!res.affectedRows) throw new HttpError(403, DENIED);
    return createGrant(conn, { tokenId: match.token_id, recordId: record.record_id, userId, expiresAt: match.expires_at });
  });
  await log('used', { req, recordId: record.record_id, tokenId: match.token_id });
  await logActivity(req, 'PROTECTED_TOKEN_USED', `Protected #${record.record_id}`);
  return { grant, expires_at: match.expires_at, record: await describe(record) };
}

/** Admin opening a sealed record: reason + order number, then a short grant. */
async function openSealedAsAdmin(req, publicId, body) {
  const record = await findByPublicId(publicId);
  if (!record || record.record_type !== 'sealed_birth_record') throw new HttpError(404, 'Protected record not found.');
  await checkSealedAccess(req, record, body, { viaToken: false });
  const expiresAt = new Date(Date.now() + SEALED_GRANT_MINUTES * 60000);
  const grant = await withTransaction((conn) => createGrant(conn, { tokenId: null, recordId: record.record_id, userId: req.user.user_id, expiresAt }));
  return { grant, expires_at: expiresAt, record: await describe(record) };
}

/** Resolves access for viewing: Admin direct (except sealed), Staff (and sealed) need a live grant. */
async function resolveAccess(req, publicId) {
  const record = await findByPublicId(publicId);
  if (!record) throw new HttpError(403, DENIED);
  const needsGrant = req.user.role !== 'Admin' || record.record_type === 'sealed_birth_record';
  if (needsGrant) {
    const secret = String(req.headers['x-protected-access'] || '');
    if (!secret) throw new HttpError(403, DENIED);
    const [[g]] = await pool.query(
      'SELECT grant_hash FROM tbl_protected_grants WHERE grant_hash = ? AND record_id = ? AND user_id = ? AND expires_at > NOW()',
      [sha256(secret), record.record_id, req.user.user_id]);
    if (!g) throw new HttpError(403, DENIED);
  }
  return record;
}

/** Safe description of a record (no personal data). */
async function describe(record) {
  const file = await fileFor(record);
  return {
    record_id: record.record_id, public_id: record.public_id, record_type: record.record_type, label: record.label,
    // Whole-record tokens open the application or child page instead of a file.
    whole_record: ['adoption_application', 'child_record'].includes(record.record_type),
    application_id: record.record_type === 'adoption_application' ? record.application_id : null,
    child_id: record.record_type === 'child_record' ? record.child_id : null,
    allow_download: !!record.allow_download, sealed: record.record_type === 'sealed_birth_record',
    has_file: !!file, mime_type: file?.mime_type || null, file_name: file?.original_name || null,
  };
}

async function listRecords({ applicationId, childId }) {
  const where = [];
  const params = [];
  if (applicationId) { where.push('application_id = ?'); params.push(applicationId); }
  if (childId) { where.push('child_id = ?'); params.push(childId); }
  if (!where.length) return [];
  const [rows] = await pool.query(
    `SELECT record_id, public_id, record_type, label, allow_download, application_id, document_id, child_id, sealed_id, created_at
       FROM tbl_protected_records WHERE ${where.join(' OR ')} ORDER BY created_at`, params);
  return rows.map((r) => ({ ...r, allow_download: !!r.allow_download }));
}

// ------------------------------------------------------------------ whole-record access (application or child)

/**
 * The protected record that covers a whole adoption application or child record (created on
 * first use). Its label holds only the reference code, never a name.
 */
async function ensureWholeRecord({ applicationId = null, childId = null, label, createdBy }) {
  const type = applicationId ? 'adoption_application' : 'child_record';
  const [[found]] = await pool.query(
    `SELECT * FROM tbl_protected_records WHERE record_type = ? AND ${applicationId ? 'application_id' : 'child_id'} = ?`,
    [type, applicationId || childId]);
  if (found) return found;
  return withTransaction(async (conn) => {
    const { record_id: id } = await createRecord(conn, { type, label, applicationId, childId, createdBy });
    const [[r]] = await conn.query('SELECT * FROM tbl_protected_records WHERE record_id = ?', [id]);
    return r;
  });
}

/** Live grant for this user on this record (from the X-Protected-Access header), or null. */
async function grantFor(req, recordId) {
  const secret = String(req.headers['x-protected-access'] || '');
  if (!secret || !recordId) return null;
  const [[g]] = await pool.query(
    'SELECT expires_at, TIMESTAMPDIFF(SECOND, NOW(), expires_at) AS remaining FROM tbl_protected_grants WHERE grant_hash = ? AND record_id = ? AND user_id = ? AND expires_at > NOW()',
    [sha256(secret), recordId, req.user.user_id]);
  return g ? { expires_at: g.expires_at, remaining_seconds: Number(g.remaining) } : null;
}

/** Signing out ends every protected grant the user holds (sensitive sections lock again). */
async function revokeGrantsForUser(userId) {
  await pool.query('DELETE FROM tbl_protected_grants WHERE user_id = ?', [userId]);
}

async function cleanupGrants() {
  await pool.query('DELETE FROM tbl_protected_grants WHERE expires_at < NOW() - INTERVAL 1 DAY');
}

module.exports = {
  createRecord, findByPublicId, fileFor, describe, issueToken, revokeToken, accessOverview, unlockWithToken,
  openSealedAsAdmin, resolveAccess, listRecords, log, cleanupGrants, ensureWholeRecord, grantFor, revokeGrantsForUser, normalizeToken, formatToken, newToken, ALPHABET, DENIED,
};
