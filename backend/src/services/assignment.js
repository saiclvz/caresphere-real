/**
 * ONE assignment service for children, adoption applications and transition reviews (need-to-know).
 *
 * Types: primary case worker (one at a time), backup, and temporary cover (with start and end dates). The list
 * lives in tbl_record_assignments; rows are never deleted (ending sets ended_at). The old assigned_staff_id
 * column on each record stays as a mirror of the active primary, so existing screens keep working.
 *
 * Records not converted yet (no row in tbl_record_assignments, see scripts/migrateChildAccess.js) still use the
 * old assigned_staff_id, so nobody loses access before the conversion runs.
 *
 * Every change: who and when, the audit log (old and new staff), the staff member's notification (reference only),
 * and, when someone loses the record, their open unlock sessions end at once.
 */
const { pool, withTransaction } = require('../config/db');
const HttpError = require('../utils/HttpError');
const { logActivityWith, logSystemActivity } = require('../utils/audit');
const Notify = require('./notifications');
const U = require('./unlockService');
const { ASSIGNMENT_TYPES } = require('../config/childRecordLevels');

const TABLES = {
  adoption_application: { table: 'tbl_adoption_applications', id: 'application_id', label: 'Application', session: 'adoption_application', duty: 'adoption' },
  transition_review: { table: 'tbl_transition_reviews', id: 'review_id', label: 'Transition review', session: 'transition_review', duty: 'transition' },
  child: { table: 'tbl_children', id: 'child_id', label: 'Child', session: 'health', duty: 'children' },
};
const TYPES = Object.keys(ASSIGNMENT_TYPES);
const ACTIVE_SQL = 'a.ended_at IS NULL AND a.starts_at <= NOW() AND (a.ends_at IS NULL OR a.ends_at > NOW())';

/** Audit entry: the acting user, or (automatic jobs) recorded on the staff member it concerns. */
async function audit(conn, req, code, target, userId) {
  if (req?.user) return logActivityWith(conn, req, code, target);
  return logSystemActivity(conn, userId, `${code} [automatic]`, target);
}

function table(recordType) {
  const t = TABLES[recordType];
  if (!t) throw new HttpError(400, 'Unknown record type.');
  return t;
}
const fkValues = (recordType, recordId) => [
  recordType === 'child' ? String(recordId) : null,
  recordType === 'adoption_application' ? Number(recordId) : null,
  recordType === 'transition_review' ? Number(recordId) : null,
];

async function staffName(conn, userId) {
  if (!userId) return null;
  const [[u]] = await conn.query('SELECT full_name FROM tbl_users WHERE user_id = ?', [userId]);
  return u?.full_name || `user #${userId}`;
}

/** Has this record been converted to the assignment list? */
async function converted(conn, recordType, recordId) {
  const [[r]] = await conn.query('SELECT 1 AS ok FROM tbl_record_assignments WHERE record_type = ? AND record_id = ? LIMIT 1', [recordType, String(recordId)]);
  return Boolean(r);
}

/** Active assignments of a record (now), with the staff member's name and whether the account is active. */
async function active(conn, recordType, recordId) {
  const [rows] = await conn.query(
    `SELECT a.assignment_id, a.record_type, a.record_id, a.user_id, a.assignment_type, a.starts_at, a.ends_at, a.assigned_at, a.source,
            u.full_name AS user_name, u.is_active
       FROM tbl_record_assignments a JOIN tbl_users u ON u.user_id = a.user_id
      WHERE a.record_type = ? AND a.record_id = ? AND ${ACTIVE_SQL}
      ORDER BY FIELD(a.assignment_type, 'primary', 'backup', 'temporary'), a.assigned_at`, [recordType, String(recordId)]);
  if (rows.length || await converted(conn, recordType, recordId)) return rows.map((r) => ({ ...r, is_active: !!r.is_active }));
  // Not converted yet: the old column is the primary.
  const t = table(recordType);
  const [[old]] = await conn.query(
    `SELECT x.assigned_staff_id AS user_id, x.assigned_at, u.full_name AS user_name, u.is_active FROM ${t.table} x
       LEFT JOIN tbl_users u ON u.user_id = x.assigned_staff_id WHERE x.${t.id} = ?`, [recordId]);
  return old?.user_id ? [{ assignment_id: null, record_type: recordType, record_id: String(recordId), user_id: old.user_id, assignment_type: 'primary',
    starts_at: old.assigned_at, ends_at: null, assigned_at: old.assigned_at, source: 'legacy', user_name: old.user_name, is_active: !!old.is_active, legacy: true }] : [];
}

/** The viewer's active assignment to this record (active account only), or null. */
async function assignmentOf(conn, recordType, recordId, userId) {
  if (!userId) return null;
  return (await active(conn, recordType, recordId)).find((a) => a.user_id === userId && a.is_active) || null;
}

/** Every assignment of a record (history, newest first) for the Access tab. */
async function history(conn, recordType, recordId) {
  const [rows] = await conn.query(
    `SELECT a.assignment_id, a.user_id, u.full_name AS user_name, u.is_active, a.assignment_type, a.starts_at, a.ends_at, a.assigned_at,
            ab.full_name AS assigned_by_name, a.source, a.note, a.ended_at, eb.full_name AS ended_by_name, a.end_reason,
            (${ACTIVE_SQL}) AS is_current
       FROM tbl_record_assignments a JOIN tbl_users u ON u.user_id = a.user_id
       LEFT JOIN tbl_users ab ON ab.user_id = a.assigned_by LEFT JOIN tbl_users eb ON eb.user_id = a.ended_by
      WHERE a.record_type = ? AND a.record_id = ? ORDER BY a.assigned_at DESC, a.assignment_id DESC`, [recordType, String(recordId)]);
  return rows.map((r) => ({ ...r, is_active: !!r.is_active, is_current: !!r.is_current, type_label: ASSIGNMENT_TYPES[r.assignment_type] }));
}

/** Keeps the old assigned_staff_id column equal to the active primary (screens and older code read it). */
async function syncMirror(conn, recordType, recordId, actorId) {
  const t = table(recordType);
  const [[p]] = await conn.query(
    `SELECT a.user_id FROM tbl_record_assignments a WHERE a.record_type = ? AND a.record_id = ? AND a.assignment_type = 'primary' AND ${ACTIVE_SQL}
      ORDER BY a.assigned_at DESC LIMIT 1`, [recordType, String(recordId)]);
  const [[cur]] = await conn.query(`SELECT assigned_staff_id FROM ${t.table} WHERE ${t.id} = ?`, [recordId]);
  if (!cur || (cur.assigned_staff_id ?? null) === (p?.user_id ?? null)) return;
  await conn.query(`UPDATE ${t.table} SET assigned_staff_id = ?, assigned_by = ?, assigned_at = NOW() WHERE ${t.id} = ?`, [p?.user_id ?? null, actorId || null, recordId]);
}

/** Before the first change to a record that still uses the old column, the old primary becomes a row. */
async function convertOne(conn, recordType, recordId) {
  if (await converted(conn, recordType, recordId)) return false;
  const t = table(recordType);
  const [[old]] = await conn.query(`SELECT assigned_staff_id, assigned_by, assigned_at FROM ${t.table} WHERE ${t.id} = ?`, [recordId]);
  if (!old?.assigned_staff_id) return false;
  await conn.query(
    `INSERT INTO tbl_record_assignments (record_type, record_id, child_id, application_id, review_id, user_id, assignment_type, starts_at, assigned_by, assigned_at, source, note)
     VALUES (?, ?, ?, ?, ?, ?, 'primary', COALESCE(?, NOW()), ?, COALESCE(?, NOW()), 'migration', 'From the earlier assigned staff field')`,
    [recordType, String(recordId), ...fkValues(recordType, recordId), old.assigned_staff_id, old.assigned_at, old.assigned_by, old.assigned_at]);
  return true;
}

/** Ends this staff member's open unlock sessions for the record (for a child, also its health and Transition Review). */
async function revokeSessions(conn, req, recordType, recordId, userId) {
  const pairs = [[table(recordType).session, String(recordId)]];
  if (recordType === 'child') {
    const [revs] = await conn.query('SELECT review_id FROM tbl_transition_reviews WHERE child_id = ?', [String(recordId)]);
    for (const r of revs) pairs.push(['transition_review', String(r.review_id)]);
  }
  let n = 0;
  for (const [type, id] of pairs) {
    const [r] = await conn.query(
      "UPDATE tbl_unlock_sessions SET ended_at = NOW(), end_reason = 'revoked', revoked_by = ? WHERE record_type = ? AND record_id = ? AND user_id = ? AND ended_at IS NULL",
      [req?.user?.user_id || null, type, id, userId]);
    n += r.affectedRows;
  }
  if (recordType === 'child') await conn.query('UPDATE tbl_health_access_tokens SET revoked = TRUE WHERE child_id = ? AND user_id = ? AND revoked = FALSE', [String(recordId), userId]);
  return n;
}

async function flag(conn, recordType, recordId, userId, reason) {
  const [[open]] = await conn.query('SELECT flag_id FROM tbl_reassignment_flags WHERE record_type = ? AND record_id = ? AND cleared_at IS NULL AND reason = ?', [recordType, String(recordId), reason]);
  if (open) return false;
  await conn.query('INSERT INTO tbl_reassignment_flags (record_type, record_id, user_id, reason) VALUES (?, ?, ?, ?)', [recordType, String(recordId), userId || null, reason]);
  return true;
}
async function clearFlags(conn, recordType, recordId, actorId) {
  await conn.query('UPDATE tbl_reassignment_flags SET cleared_at = NOW(), cleared_by = ? WHERE record_type = ? AND record_id = ? AND cleared_at IS NULL', [actorId || null, recordType, String(recordId)]);
}

const auditRef = (recordType, recordId) => (recordType === 'child' ? `Child ${recordId}` : `${table(recordType).label} #${recordId}`);
const notifyParams = (recordType, recordId, reference) => ({
  params: { id: recordId, ref: reference || String(recordId), kind: recordType },
  entityType: { transition_review: 'transition_review', child: 'child' }[recordType] || 'application', entityId: recordId,
});

/** The staff member can hold this kind of assignment: an active Staff account with the record's duty. */
async function checkStaff(conn, recordType, userId) {
  const [[u]] = await conn.query('SELECT u.is_active, r.role_name FROM tbl_users u JOIN tbl_roles r ON r.role_id = u.role_id WHERE u.user_id = ?', [userId]);
  if (!u || u.role_name !== 'Staff' || !u.is_active) throw new HttpError(422, 'Choose an active Staff account.', { errors: { user_id: 'Choose an active Staff account.' } });
  const { DUTIES } = require('../config/staffDuties');
  const duty = table(recordType).duty;
  const [[has]] = await conn.query('SELECT 1 AS ok FROM tbl_staff_duties WHERE user_id = ? AND duty = ?', [userId, duty]);
  if (!has) throw new HttpError(422, `This staff member doesn't have the ${DUTIES[duty].label} duty. Add it under User accounts first.`, { errors: { user_id: `Needs the ${DUTIES[duty].label} duty.` } });
}

function cleanDate(v, field) {
  if (v === undefined || v === null || v === '') return null;
  const d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(String(v)) ? `${v}T${field === 'ends_at' ? '23:59:59' : '00:00:00'}` : v);
  if (Number.isNaN(d.getTime())) throw new HttpError(422, 'Enter a valid date.', { errors: { [field]: 'Enter a valid date.' } });
  return d;
}

/**
 * Adds an assignment (Admin, or automatic with req = null). A new primary ends the current primary.
 * opts: { userId, type = 'primary', startsAt, endsAt, note, source = 'admin', reference }
 */
async function add(conn, req, recordType, recordId, opts) {
  const t = table(recordType);
  const type = opts.type || 'primary';
  if (!TYPES.includes(type)) throw new HttpError(422, 'Choose primary case worker, backup or temporary cover.', { errors: { type: 'Choose a type.' } });
  const userId = Number(opts.userId);
  if (!userId) throw new HttpError(422, 'Choose a staff member.', { errors: { user_id: 'Choose a staff member.' } });
  await checkStaff(conn, recordType, userId);
  const startsAt = cleanDate(opts.startsAt, 'starts_at') || new Date();
  const endsAt = cleanDate(opts.endsAt, 'ends_at');
  if (type === 'temporary' && !endsAt) throw new HttpError(422, 'A temporary cover needs an end date.', { errors: { ends_at: 'Choose when the cover ends.' } });
  if (endsAt && endsAt <= new Date(Math.max(startsAt.getTime(), Date.now()))) throw new HttpError(422, 'The end must be after the start and in the future.', { errors: { ends_at: 'Choose a later end.' } });
  const [[rec]] = await conn.query(`SELECT ${t.id} AS id${recordType === 'child' ? ', status' : ''} FROM ${t.table} WHERE ${t.id} = ? FOR UPDATE`, [recordId]);
  if (!rec) throw new HttpError(404, 'Record not found.');
  // Assignment comes after admission: a child still in admission is assigned when an Admin approves it.
  if (recordType === 'child' && rec.status === 'In admission') throw new HttpError(409, 'This child is not admitted yet. Assign the case worker when you approve the admission.');
  await convertOne(conn, recordType, recordId);

  const current = await active(conn, recordType, recordId);
  if (current.some((a) => a.user_id === userId && a.assignment_type === type)) return null; // already so
  let replaced = null;
  if (type === 'primary') {
    replaced = current.find((a) => a.assignment_type === 'primary') || null;
    if (replaced?.assignment_id) await endRow(conn, req, replaced, 'reassigned', { quiet: true });
  }
  const [ins] = await conn.query(
    `INSERT INTO tbl_record_assignments (record_type, record_id, child_id, application_id, review_id, user_id, assignment_type, starts_at, ends_at, assigned_by, source, note)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [recordType, String(recordId), ...fkValues(recordType, recordId), userId, type, startsAt, endsAt,
      ['default_case_worker', 'migration'].includes(opts.source) ? null : req?.user?.user_id || null, // automatic: no person assigned it
      opts.source || 'admin', opts.note ? String(opts.note).slice(0, 255) : null]);
  await syncMirror(conn, recordType, recordId, req?.user?.user_id);
  await clearFlags(conn, recordType, recordId, req?.user?.user_id);

  const [oldName, newName] = await Promise.all([staffName(conn, replaced?.user_id), staffName(conn, userId)]);
  await audit(conn, req,
    `CRA_ASSIGNMENT_${replaced ? 'CHANGED' : 'CREATED'} (${recordType}, ${type}${endsAt ? `, until ${endsAt.toISOString().slice(0, 10)}` : ''}: ${oldName || 'none'} -> ${newName})`,
    auditRef(recordType, recordId), userId);
  if (req?.user) await U.logEvent(req, { recordType: t.session, recordId, event: 'assigned', detail: `${ASSIGNMENT_TYPES[type]}: ${oldName || 'none'} -> ${newName}` });
  const np = notifyParams(recordType, recordId, opts.reference);
  await Notify.emit(conn, 'assigned', { ...np, userId, groupKey: `assigned:${ins.insertId}` });
  if (replaced && replaced.user_id !== userId) await Notify.emit(conn, 'unassigned', { ...np, userId: replaced.user_id });

  // An Admin choosing a case worker other than the registering Staff member ends their initial access.
  if (recordType === 'child' && type === 'primary' && (opts.source || 'admin') === 'admin') {
    await require('./childAccess').endInitialAccess(conn, req, String(recordId), 'case_worker_assigned', userId);
  }
  return ins.insertId;
}

/** Ends one assignment row; the person loses access at once (sessions end) and is told. */
async function endRow(conn, req, row, reason, { quiet = false } = {}) {
  await conn.query('UPDATE tbl_record_assignments SET ended_at = NOW(), ended_by = ?, end_reason = ? WHERE assignment_id = ? AND ended_at IS NULL',
    [req?.user?.user_id || null, reason, row.assignment_id]);
  await revokeSessions(conn, req, row.record_type, row.record_id, row.user_id);
  if (quiet) return; // replaced by a new primary: the caller logs and notifies
  await syncMirror(conn, row.record_type, row.record_id, req?.user?.user_id);
  const left = await active(conn, row.record_type, row.record_id);
  if (!left.some((a) => a.assignment_type === 'primary' && a.is_active)) await flag(conn, row.record_type, row.record_id, row.user_id, reason === 'cover_ended' ? 'cover_ended' : 'unassigned');
  const name = await staffName(conn, row.user_id);
  await audit(conn, req, `CRA_ASSIGNMENT_ENDED (${row.record_type}, ${row.assignment_type}, ${reason}: ${name})`, auditRef(row.record_type, row.record_id), row.user_id);
  await Notify.emit(conn, 'unassigned', { ...notifyParams(row.record_type, row.record_id, row.reference), userId: row.user_id });
}

async function rowById(conn, assignmentId) {
  const [[row]] = await conn.query('SELECT * FROM tbl_record_assignments WHERE assignment_id = ? FOR UPDATE', [assignmentId]);
  if (!row) throw new HttpError(404, 'Assignment not found.');
  return row;
}

/** Admin: end an assignment now. */
async function end(conn, req, assignmentId, reason = 'unassigned') {
  const row = await rowById(conn, assignmentId);
  if (row.ended_at) throw new HttpError(409, 'This assignment already ended.');
  await endRow(conn, req, row, reason);
  return row;
}

/** Admin: change when a temporary cover (or a backup) ends. */
async function change(conn, req, assignmentId, { endsAt }) {
  const row = await rowById(conn, assignmentId);
  if (row.ended_at) throw new HttpError(409, 'This assignment already ended.');
  const d = cleanDate(endsAt, 'ends_at');
  if (row.assignment_type === 'temporary' && !d) throw new HttpError(422, 'A temporary cover needs an end date.', { errors: { ends_at: 'Choose when the cover ends.' } });
  if (d && d <= new Date()) throw new HttpError(422, 'Choose an end in the future.', { errors: { ends_at: 'Choose a later end.' } });
  const day = (x) => (x ? new Date(x).toISOString().slice(0, 10) : 'none');
  await conn.query('UPDATE tbl_record_assignments SET ends_at = ? WHERE assignment_id = ?', [d, assignmentId]);
  await logActivityWith(conn, req, `CRA_ASSIGNMENT_CHANGED (${row.record_type}, ${row.assignment_type}, end ${day(row.ends_at)} -> ${day(d)})`, auditRef(row.record_type, row.record_id));
  return row;
}

/** The older "assigned staff" endpoints (adoption, transition, child case worker): set or clear the primary. */
async function assignWith(conn, req, recordType, recordId, rawStaffId, reference) {
  const staffId = rawStaffId === null || rawStaffId === '' || rawStaffId === undefined ? null : Number(rawStaffId);
  if (staffId !== null) return add(conn, req, recordType, recordId, { userId: staffId, type: 'primary', reference });
  table(recordType);
  await convertOne(conn, recordType, recordId);
  const p = (await active(conn, recordType, recordId)).find((a) => a.assignment_type === 'primary');
  if (p?.assignment_id) await endRow(conn, req, { ...p, reference }, 'unassigned');
  return null;
}
async function assign(req, recordType, recordId, rawStaffId, reference) {
  return withTransaction((conn) => assignWith(conn, req, recordType, recordId, rawStaffId, reference));
}

/** Admin: one staff member to many records at once (same type and dates). Returns how many changed. */
async function bulk(req, recordType, ids, opts) {
  const list = [...new Set((Array.isArray(ids) ? ids : []).map(String))].slice(0, 200);
  if (!list.length) throw new HttpError(422, 'Choose at least one record.');
  return withTransaction(async (conn) => {
    let n = 0;
    for (const id of list) if (await add(conn, req, recordType, id, { ...opts, reference: id })) n += 1;
    await logActivityWith(conn, req, `CRA_ASSIGNMENT_BULK (${recordType}, ${opts.type || 'primary'}, ${n} of ${list.length})`, 'Assignments');
    return n;
  });
}

/**
 * A Staff account was deactivated or lost duties: its open unlock sessions end, and the records it was assigned
 * to (for the lost duties) are marked "needs reassignment". Admins get one alert (count only, no names).
 */
async function staffLostAccess(conn, req, userId, { reason, duties = null }) {
  const lostSensitive = !duties || duties.some((d) => ['health', 'adoption', 'transition', 'children'].includes(d));
  if (lostSensitive) {
    await conn.query("UPDATE tbl_unlock_sessions SET ended_at = NOW(), end_reason = 'revoked', revoked_by = ? WHERE user_id = ? AND ended_at IS NULL",
      [req?.user?.user_id || null, userId]);
    await conn.query('UPDATE tbl_health_access_tokens SET revoked = TRUE WHERE user_id = ? AND revoked = FALSE', [userId]);
  }
  const types = Object.entries(TABLES).filter(([, t]) => !duties || duties.includes(t.duty)).map(([k]) => k);
  let count = 0;
  for (const recordType of types) {
    const t = TABLES[recordType];
    const [rows] = await conn.query(
      `SELECT DISTINCT a.record_id FROM tbl_record_assignments a WHERE a.user_id = ? AND a.record_type = ? AND ${ACTIVE_SQL}`, [userId, recordType]);
    const [legacy] = await conn.query(
      `SELECT CAST(x.${t.id} AS CHAR) AS record_id FROM ${t.table} x WHERE x.assigned_staff_id = ?
         AND NOT EXISTS (SELECT 1 FROM tbl_record_assignments a2 WHERE a2.record_type = ? AND a2.record_id = CAST(x.${t.id} AS CHAR))`, [userId, recordType]);
    for (const r of [...rows, ...legacy]) if (await flag(conn, recordType, r.record_id, userId, reason)) count += 1;
  }
  if (reason === 'account_deactivated' || (duties || []).includes('children')) {
    await conn.query("UPDATE tbl_child_initial_access SET ended_at = NOW(), end_reason = ? WHERE user_id = ? AND ended_at IS NULL", [reason, userId]);
  }
  if (count) {
    await Notify.toAdmins(conn, 'admin_needs_reassignment', { params: { count, why: reason === 'account_deactivated' ? 'An assigned staff account was deactivated.' : 'An assigned staff member lost a duty.' },
      groupKey: `needs_reassign:${reason}:user:${userId}:${Date.now()}` });
  }
  return count;
}

/** Records marked "needs reassignment" (Admin). */
async function openFlags(conn = pool, recordType = null) {
  const [rows] = await conn.query(
    `SELECT f.flag_id, f.record_type, f.record_id, f.reason, f.flagged_at, u.full_name AS user_name FROM tbl_reassignment_flags f
       LEFT JOIN tbl_users u ON u.user_id = f.user_id WHERE f.cleared_at IS NULL ${recordType ? 'AND f.record_type = ?' : ''} ORDER BY f.flagged_at DESC`,
    recordType ? [recordType] : []);
  return rows;
}

/**
 * Record ids (strings) of `recordType` that `userId` is assigned to (null = anyone, active accounts only), through
 * the one assignment service: the record's own active primary/backup/temporary rows, the old column for records
 * not converted yet, and, for an adoption application or a transition review, the assignment of its child.
 * Used by every "Assigned to me" / "Unassigned" filter, so lists agree with what the access checks allow.
 */
async function recordIdsFor(conn, recordType, userId = null) {
  const t = table(recordType);
  const uArgs = userId ? [userId] : [];
  const [own] = await conn.query(
    `SELECT DISTINCT a.record_id FROM tbl_record_assignments a JOIN tbl_users u ON u.user_id = a.user_id AND u.is_active = TRUE
      WHERE a.record_type = ? ${userId ? 'AND a.user_id = ?' : ''} AND ${ACTIVE_SQL}`, [recordType, ...uArgs]);
  const [legacy] = await conn.query(
    `SELECT CAST(x.${t.id} AS CHAR) AS record_id FROM ${t.table} x JOIN tbl_users u ON u.user_id = x.assigned_staff_id AND u.is_active = TRUE
      WHERE ${userId ? 'x.assigned_staff_id = ? AND ' : ''}NOT EXISTS (SELECT 1 FROM tbl_record_assignments a2 WHERE a2.record_type = ? AND a2.record_id = CAST(x.${t.id} AS CHAR))`,
    [...uArgs, recordType]);
  const ids = new Set([...own, ...legacy].map((r) => String(r.record_id)));
  if (recordType !== 'child') {
    const children = [...await recordIdsFor(conn, 'child', userId)];
    if (children.length) {
      const [rows] = recordType === 'adoption_application'
        ? await conn.query('SELECT application_id AS id FROM tbl_adoption_applications WHERE COALESCE(matched_child_id, target_child_id, link_child_id) IN (?)', [children])
        : await conn.query('SELECT review_id AS id FROM tbl_transition_reviews WHERE child_id IN (?)', [children]);
      for (const r of rows) ids.add(String(r.id));
    }
  }
  return ids;
}

module.exports = {
  recordIdsFor,
  TABLES, TYPES, ACTIVE_SQL, assign, assignWith, add, end, change, bulk, active, assignmentOf, history, converted, convertOne, syncMirror,
  revokeSessions, staffLostAccess, openFlags, flag, clearFlags, endRow, audit,
};
