/**
 * Shared access flow for sensitive records: health, adoption applications, Transition Review.
 * Settings: config/sensitiveAccess.js.
 *
 *  1. Purpose (list per record type) + confidentiality acknowledgement.
 *  2. A single-use 8-character Token ID valid TOKEN_TYPING_WINDOW seconds, shown as a plain-text
 *     QR ("CareSphere ... Pass"). A new QR replaces the old one, which stops working at once.
 *  3. The Token ID is accepted only for that staff member, that record, and the same signed-in
 *     session (JWT id) that generated it.
 *  4. A match opens an unlock session of ACCESS_SESSION seconds, bound to user, record, purpose
 *     and session. The secret travels in the X-Unlock-Session header; only its hash is stored.
 *
 * Every failure gives the same message; LOCKOUT_FAILURES failures in LOCKOUT_MINUTES lock the user
 * out. Every step goes to tbl_unlock_events (who, when, record, purpose, device). Admin never needs
 * this flow: Admin views are logged as "Admin full access".
 */
const crypto = require('crypto');
const { pool, withTransaction } = require('../config/db');
const HttpError = require('../utils/HttpError');
const { sha256, safeEqual } = require('../utils/crypto');
const { deviceType } = require('../utils/device');
const CFG = require('../config/sensitiveAccess');
const Notify = require('./notifications');
const { UNUSUAL_UNLOCK } = require('../config/notificationEvents');

const RECORD_TYPES = CFG.RECORD_TYPES;
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // no I, L, O, 0, 1
const TOKEN_LENGTH = 8;
const HEADER = 'x-unlock-session';
const GENERIC = "That token isn't valid or has expired.";
const NOT_ASSIGNED = "You're not assigned to this record. Ask an Admin to assign you.";

const ipOf = (req) => (req.ip || '').replace(/^::ffff:/, '').slice(0, 45);
const tokenHash = (t) => sha256(`unlock:${t}`);
const jtiOf = (req) => req.auth?.jti || null;

async function logEvent(req, { recordType, recordId, event, purpose = null, detail = null, userId }) {
  try {
    await pool.query(
      'INSERT INTO tbl_unlock_events (event, record_type, record_id, user_id, user_role, purpose, detail, device_type, ip_address) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [event, recordType, String(recordId), userId ?? req.user?.user_id ?? null, req.user?.role || null, purpose,
        detail ? String(detail).slice(0, 500) : null, deviceType(req), ipOf(req)]);
  } catch (err) {
    console.error('[unlock-log]', err.message); // logging must never block the request
  }
}

function cleanType(v) {
  const t = String(v || '');
  if (!RECORD_TYPES.includes(t)) throw new HttpError(400, 'Unknown record type.');
  return t;
}

/** Label for the modal: the reference code only, never a name. */
async function recordLabel(recordType, recordId) {
  if (recordType === 'adoption_application') {
    const [[a]] = await pool.query('SELECT reference_no FROM tbl_adoption_applications WHERE application_id = ?', [recordId]);
    return a?.reference_no || 'Adoption application';
  }
  if (recordType === 'transition_review') {
    const [[t]] = await pool.query('SELECT child_id FROM tbl_transition_reviews WHERE review_id = ?', [recordId]);
    return t?.child_id || 'Transition review';
  }
  return String(recordId);
}

/**
 * Need-to-know, through the ONE assignment service (services/assignment.js) and policy (services/childAccess.js).
 * Admin: always. Staff: only while assigned (primary, backup or temporary cover) with an active account:
 *  - adoption: the application's assignment
 *  - transition_review: the review's assignment, or the child's case worker assignment
 *  - health: the child's case worker assignment (never initial or emergency access)
 */
async function access(req, recordType, recordId) {
  let row;
  if (recordType === 'adoption_application') {
    [[row]] = await pool.query('SELECT status FROM tbl_adoption_applications WHERE application_id = ?', [recordId]);
    if (row && row.status === 'Draft') row = null;
  } else if (recordType === 'transition_review') {
    [[row]] = await pool.query('SELECT review_id FROM tbl_transition_reviews WHERE review_id = ?', [recordId]);
  } else {
    [[row]] = await pool.query('SELECT child_id FROM tbl_children WHERE child_id = ?', [recordId]);
  }
  if (!row) throw new HttpError(404, 'Record not found.');
  if (req.user.role === 'Admin') return { allowed: true };
  return (await require('./childAccess').isAssigned(req, recordType, recordId)) ? { allowed: true } : { allowed: false, reason: 'not_assigned' };
}

async function lockedOut(userId) {
  const [[r]] = await pool.query(
    "SELECT COUNT(*) AS n FROM tbl_unlock_events WHERE user_id = ? AND event = 'verify_failed' AND created_at > NOW() - INTERVAL ? MINUTE",
    [userId, CFG.LOCKOUT_MINUTES]);
  return Number(r.n) >= CFG.LOCKOUT_FAILURES;
}

function newToken() {
  let t = '';
  for (let i = 0; i < TOKEN_LENGTH; i += 1) t += ALPHABET[crypto.randomInt(ALPHABET.length)];
  return t;
}

/** Purpose + acknowledgement, then a fresh token and its QR text (replacing any older one). */
async function createChallenge(req, body) {
  const recordType = cleanType(body?.record_type);
  const recordId = String(body?.record_id || '').slice(0, 50);
  const purpose = String(body?.purpose || '');
  const note = String(body?.purpose_note || '').trim();
  if (!CFG.PURPOSES[recordType].includes(purpose)) throw new HttpError(400, 'Choose the purpose for opening this record.');
  if (purpose === 'Other' && note.length < 5) throw new HttpError(400, 'Describe the purpose (at least 5 characters).');
  if (note.length > 500) throw new HttpError(400, 'The note can be up to 500 characters.');
  if (body?.acknowledged !== true) throw new HttpError(400, 'Tick the confidentiality acknowledgement to continue.');
  if (req.user.role === 'Admin') throw new HttpError(400, 'Administrators have full access and do not need to unlock.');

  const a = await access(req, recordType, recordId);
  if (!a.allowed) {
    await logEvent(req, { recordType, recordId, event: 'request_denied', purpose, detail: 'not assigned' });
    throw new HttpError(403, NOT_ASSIGNED, { not_assigned: true });
  }
  if (await lockedOut(req.user.user_id)) throw new HttpError(429, `Too many failed attempts. Try again in ${CFG.LOCKOUT_MINUTES} minutes.`);

  const token = newToken();
  const publicId = crypto.randomBytes(16).toString('base64url');
  const refresh = body?.refresh === true;
  const replaced = await withTransaction(async (conn) => {
    // The previous token stops working immediately.
    const [rep] = await conn.query(
      'UPDATE tbl_unlock_challenges SET replaced_at = NOW() WHERE user_id = ? AND record_type = ? AND record_id = ? AND used_at IS NULL AND replaced_at IS NULL AND expires_at > NOW()',
      [req.user.user_id, recordType, recordId]);
    await conn.query(
      'UPDATE tbl_unlock_challenges SET replaced_at = NOW() WHERE user_id = ? AND record_type = ? AND record_id = ? AND used_at IS NULL AND replaced_at IS NULL',
      [req.user.user_id, recordType, recordId]);
    await conn.query(
      `INSERT INTO tbl_unlock_challenges (public_id, record_type, record_id, user_id, session_jti, purpose, purpose_note, acknowledged_at, token_hash, token_enc, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, NOW(), ?, NULL, NOW() + INTERVAL ? SECOND)`,
      [publicId, recordType, recordId, req.user.user_id, jtiOf(req), purpose, note || null, tokenHash(token), CFG.TOKEN_TYPING_WINDOW]);
    return rep.affectedRows > 0;
  });
  if (replaced) await logEvent(req, { recordType, recordId, event: 'token_replaced', purpose });
  const [[c]] = await pool.query('SELECT expires_at, TIMESTAMPDIFF(SECOND, NOW(), expires_at) AS remaining FROM tbl_unlock_challenges WHERE public_id = ?', [publicId]);
  if (!refresh) await logEvent(req, { recordType, recordId, event: 'purpose_chosen', purpose, detail: note ? `Acknowledged. Note: ${note}` : 'Acknowledged' });
  await logEvent(req, { recordType, recordId, event: 'qr_generated', purpose });
  const validUntil = new Date(c.expires_at);
  // "Valid until" in the QR and the modal countdown both come from this server-side expiry.
  return { qr_text: CFG.qrText(recordType, token, validUntil), valid_until: CFG.hhmmss(validUntil), expires_at: c.expires_at, expires_in: Math.max(0, Number(c.remaining)) };
}

/** Verify the typed Token ID (same user, record and signed-in session) and start the unlock session. */
async function verify(req, body) {
  const recordType = cleanType(body?.record_type);
  const recordId = String(body?.record_id || '').slice(0, 50);
  const typed = String(body?.token || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (await lockedOut(req.user.user_id)) throw new HttpError(429, `Too many failed attempts. Try again in ${CFG.LOCKOUT_MINUTES} minutes.`);
  const a = await access(req, recordType, recordId);
  if (!a.allowed) throw new HttpError(403, NOT_ASSIGNED, { not_assigned: true });

  const [[c]] = await pool.query(
    `SELECT challenge_id, token_hash, purpose, session_jti, (expires_at > NOW()) AS live FROM tbl_unlock_challenges
      WHERE user_id = ? AND record_type = ? AND record_id = ? AND used_at IS NULL AND replaced_at IS NULL
      ORDER BY challenge_id DESC LIMIT 1`, [req.user.user_id, recordType, recordId]);
  const sameSession = c && (c.session_jti || null) === jtiOf(req);
  const ok = c && c.live && sameSession && typed.length === TOKEN_LENGTH && safeEqual(c.token_hash, tokenHash(typed));
  if (!ok) {
    if (c) await pool.query('UPDATE tbl_unlock_challenges SET failed_attempts = failed_attempts + 1 WHERE challenge_id = ?', [c.challenge_id]);
    const why = !c ? 'no live code' : !c.live ? 'expired' : !sameSession ? 'different session' : 'wrong token';
    await logEvent(req, { recordType, recordId, event: 'verify_failed', purpose: c?.purpose || null, detail: why });
    if (await lockedOut(req.user.user_id)) {
      await logEvent(req, { recordType, recordId, event: 'lockout', purpose: c?.purpose || null, detail: `${CFG.LOCKOUT_FAILURES} failed verifications` });
      await Notify.toAdmins(pool, 'admin_lockout', { groupKey: 'lockouts', mode: 'count' }).catch((e) => console.error('[notify]', e.message));
    }
    throw new HttpError(403, GENERIC);
  }

  const secret = crypto.randomBytes(32).toString('base64url');
  const sessionId = await withTransaction(async (conn) => {
    const [r] = await conn.query('UPDATE tbl_unlock_challenges SET used_at = NOW() WHERE challenge_id = ? AND used_at IS NULL', [c.challenge_id]);
    if (!r.affectedRows) throw new HttpError(403, GENERIC); // single use, even under a race
    await conn.query(
      "UPDATE tbl_unlock_sessions SET ended_at = NOW(), end_reason = 'locked' WHERE user_id = ? AND record_type = ? AND record_id = ? AND ended_at IS NULL",
      [req.user.user_id, recordType, recordId]);
    const [s] = await conn.query(
      `INSERT INTO tbl_unlock_sessions (grant_hash, challenge_id, record_type, record_id, user_id, session_jti, purpose, started_at, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, NOW(), NOW() + INTERVAL ? SECOND)`,
      [sha256(secret), c.challenge_id, recordType, recordId, req.user.user_id, jtiOf(req), c.purpose, CFG.ACCESS_SESSION]);
    // Admins hear about every unlock: Info when routine, Warning when unusual (rule in notificationEvents.js).
    const rule = UNUSUAL_UNLOCK;
    const hour = new Date().getHours();
    const [[today]] = await conn.query('SELECT COUNT(*) AS n FROM tbl_unlock_sessions WHERE user_id = ? AND started_at >= CURDATE()', [req.user.user_id]);
    const why = hour < rule.startHour || hour >= rule.endHour ? 'outside office hours' : Number(today.n) > rule.maxPerDay ? `${today.n} unlocks today by the same staff member` : null;
    await Notify.toAdmins(conn, 'admin_unlock_started', { params: { ref: await recordLabel(recordType, recordId), unusual: Boolean(why), why },
      groupKey: `unlock:session:${s.insertId}` });
    return s.insertId;
  });
  await logEvent(req, { recordType, recordId, event: 'verify_success', purpose: c.purpose });
  await logEvent(req, { recordType, recordId, event: 'session_started', purpose: c.purpose, detail: `${CFG.ACCESS_SESSION} s, session #${sessionId}` });
  const [[s]] = await pool.query('SELECT expires_at, TIMESTAMPDIFF(SECOND, NOW(), expires_at) AS remaining FROM tbl_unlock_sessions WHERE session_id = ?', [sessionId]);
  return { grant: secret, expires_at: s.expires_at, remaining_seconds: Number(s.remaining), purpose: c.purpose, session_id: sessionId, warning_seconds: CFG.WARNING_SECONDS };
}

/** The live session for this user, record and signed-in session, or null. Expired sessions are closed and logged. */
async function sessionFor(req, recordType, recordId) {
  const secret = String(req.headers[HEADER] || '');
  if (!secret) return null;
  const [[s]] = await pool.query(
    `SELECT session_id, purpose, session_jti, expires_at, ended_at, TIMESTAMPDIFF(SECOND, NOW(), expires_at) AS remaining
       FROM tbl_unlock_sessions WHERE grant_hash = ? AND user_id = ? AND record_type = ? AND record_id = ?`,
    [sha256(secret), req.user.user_id, recordType, String(recordId)]);
  if (!s || s.ended_at || (s.session_jti || null) !== jtiOf(req)) return null;
  if (Number(s.remaining) <= 0) {
    const [r] = await pool.query("UPDATE tbl_unlock_sessions SET ended_at = NOW(), end_reason = 'expired' WHERE session_id = ? AND ended_at IS NULL", [s.session_id]);
    if (r.affectedRows) await logEvent(req, { recordType, recordId, event: 'session_expired', purpose: s.purpose });
    return null;
  }
  return { session_id: s.session_id, purpose: s.purpose, expires_at: s.expires_at, remaining_seconds: Number(s.remaining) };
}

/** "Lock now": ends the caller's own session for this record. */
async function lockNow(req, body) {
  const recordType = cleanType(body?.record_type);
  const recordId = String(body?.record_id || '');
  const s = await sessionFor(req, recordType, recordId);
  if (!s) return;
  await pool.query("UPDATE tbl_unlock_sessions SET ended_at = NOW(), end_reason = 'locked' WHERE session_id = ? AND ended_at IS NULL", [s.session_id]);
  await logEvent(req, { recordType, recordId, event: 'session_locked', purpose: s.purpose });
}

/** Admin: end any session immediately. */
async function revoke(req, sessionId) {
  const [[s]] = await pool.query('SELECT record_type, record_id, purpose, user_id FROM tbl_unlock_sessions WHERE session_id = ? AND ended_at IS NULL', [sessionId]);
  if (!s) throw new HttpError(404, 'That session is not active.');
  const ref = await recordLabel(s.record_type, s.record_id);
  await withTransaction(async (conn) => {
    await conn.query("UPDATE tbl_unlock_sessions SET ended_at = NOW(), end_reason = 'revoked', revoked_by = ? WHERE session_id = ?", [req.user.user_id, sessionId]);
    // The staff member: reference and "access ended by an administrator" only. Other Admins: who ended it.
    await Notify.emit(conn, 'staff_access_ended', { userId: s.user_id, params: { ref }, groupKey: `access_ended:session:${sessionId}` });
    await Notify.toAdmins(conn, 'admin_session_revoked', { params: { ref, by: req.user.full_name || 'an administrator' }, exceptUserId: req.user.user_id,
      groupKey: `revoked:session:${sessionId}` });
  });
  await logEvent(req, { recordType: s.record_type, recordId: s.record_id, event: 'session_revoked', purpose: s.purpose, detail: `session #${sessionId} of user #${s.user_id}` });
}

/** Signing out (or the idle timeout) ends every open session of the user. */
async function endForUser(userId) {
  const [open] = await pool.query('SELECT session_id, record_type, record_id, purpose FROM tbl_unlock_sessions WHERE user_id = ? AND ended_at IS NULL AND expires_at > NOW()', [userId]);
  await pool.query("UPDATE tbl_unlock_sessions SET ended_at = NOW(), end_reason = 'signed_out' WHERE user_id = ? AND ended_at IS NULL", [userId]);
  // Logged so the audit log can show "Access ended: revoked automatically".
  for (const s of open) {
    await pool.query(
      "INSERT INTO tbl_unlock_events (event, record_type, record_id, user_id, purpose, detail) VALUES ('session_signed_out', ?, ?, ?, ?, ?)",
      [s.record_type, s.record_id, userId, s.purpose, `session #${s.session_id}`]).catch(() => {});
  }
}

/** Sessions for one record (Admin panel), newest first. */
/**
 * Paged sessions for one record (Admin, Access tab): active ones always in full, then the ended history,
 * 10 a page, optionally for one user. Returns { active, history, total, page, per_page, users }.
 */
async function sessionsPage(recordType, recordId, { page = 1, perPage = 10, userId = null, state = 'all' } = {}) {
  const SEL = `SELECT s.session_id, s.user_id, u.full_name AS user_name, s.purpose, ch.purpose_note, ch.acknowledged_at, s.started_at, s.expires_at,
            s.ended_at, s.end_reason, rb.full_name AS revoked_by_name, (s.ended_at IS NULL AND s.expires_at > NOW()) AS active
       FROM tbl_unlock_sessions s JOIN tbl_users u ON u.user_id = s.user_id JOIN tbl_unlock_challenges ch ON ch.challenge_id = s.challenge_id
       LEFT JOIN tbl_users rb ON rb.user_id = s.revoked_by
      WHERE s.record_type = ? AND s.record_id = ?`;
  const args = [recordType, String(recordId)];
  const userCond = userId ? ' AND s.user_id = ?' : '';
  const userArgs = userId ? [userId] : [];
  const [active] = state === 'ended' ? [[]] : await pool.query(`${SEL} AND s.ended_at IS NULL AND s.expires_at > NOW()${userCond} ORDER BY s.started_at DESC`, [...args, ...userArgs]);
  let history = []; let total = 0;
  if (state !== 'active') {
    const ended = ' AND NOT (s.ended_at IS NULL AND s.expires_at > NOW())';
    const [[c]] = await pool.query(`SELECT COUNT(*) AS n FROM tbl_unlock_sessions s WHERE s.record_type = ? AND s.record_id = ?${ended}${userCond}`, [...args, ...userArgs]);
    total = Number(c.n);
    [history] = await pool.query(`${SEL}${ended}${userCond} ORDER BY s.started_at DESC LIMIT ? OFFSET ?`, [...args, ...userArgs, perPage, (page - 1) * perPage]);
  }
  const [users] = await pool.query(
    `SELECT DISTINCT u.user_id, u.full_name FROM tbl_unlock_sessions s JOIN tbl_users u ON u.user_id = s.user_id
      WHERE s.record_type = ? AND s.record_id = ? ORDER BY u.full_name`, args);
  const fix = (rows) => rows.map((r) => ({ ...r, active: !!r.active }));
  return { active: fix(active), history: fix(history), total, page, per_page: perPage, users };
}

async function sessionsFor(recordType, recordId) {
  const [rows] = await pool.query(
    `SELECT s.session_id, s.user_id, u.full_name AS user_name, s.purpose, ch.purpose_note, ch.acknowledged_at, s.started_at, s.expires_at,
            s.ended_at, s.end_reason, rb.full_name AS revoked_by_name, (s.ended_at IS NULL AND s.expires_at > NOW()) AS active
       FROM tbl_unlock_sessions s JOIN tbl_users u ON u.user_id = s.user_id JOIN tbl_unlock_challenges ch ON ch.challenge_id = s.challenge_id
       LEFT JOIN tbl_users rb ON rb.user_id = s.revoked_by
      WHERE s.record_type = ? AND s.record_id = ? ORDER BY s.started_at DESC LIMIT 50`, [recordType, String(recordId)]);
  return rows.map((r) => ({ ...r, active: !!r.active }));
}

/** Every active session (Admin overview). Labels are reference codes only. */
async function activeSessions() {
  const [rows] = await pool.query(
    `SELECT s.session_id, s.record_type, s.record_id, COALESCE(a.reference_no, trv.child_id, s.record_id) AS reference_no,
            u.full_name AS user_name, s.purpose, s.started_at, s.expires_at
       FROM tbl_unlock_sessions s JOIN tbl_users u ON u.user_id = s.user_id
       LEFT JOIN tbl_adoption_applications a ON s.record_type = 'adoption_application' AND a.application_id = s.record_id
       LEFT JOIN tbl_transition_reviews trv ON s.record_type = 'transition_review' AND trv.review_id = s.record_id
      WHERE s.ended_at IS NULL AND s.expires_at > NOW() ORDER BY s.expires_at`);
  return rows;
}

module.exports = {
  RECORD_TYPES, GENERIC, NOT_ASSIGNED, logEvent, access, createChallenge, verify, sessionFor, lockNow, revoke, endForUser,
  sessionsFor, sessionsPage, activeSessions, recordLabel,
};
