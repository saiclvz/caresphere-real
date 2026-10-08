/**
 * Assigned staff (need-to-know) for adoption applications, Transition Review and the child's case worker
 * (health records), shared by the record pages and Staff schedules > Record access.
 * Admin only. Records who assigned and when, ends other staff's open unlocks for the record,
 * writes old and new staff to the audit log, and notifies the newly assigned staff member
 * (reference number only).
 */
const { pool } = require('../config/db');
const HttpError = require('../utils/HttpError');
const { logActivityWith } = require('../utils/audit');
const Notify = require('./notifications');
const U = require('./unlockService');

const TABLES = {
  adoption_application: { table: 'tbl_adoption_applications', id: 'application_id', link: (id) => `/adoptions/${id}`, label: 'Application' },
  transition_review: { table: 'tbl_transition_reviews', id: 'review_id', link: (id) => `/transition-reviews/${id}`, label: 'Transition review' },
  child: { table: 'tbl_children', id: 'child_id', link: (id) => `/children/${encodeURIComponent(id)}`, label: 'Child', session: 'health', code: 'CHILD_CASE_WORKER' },
};

async function staffName(userId, conn = pool) {
  if (!userId) return null;
  const [[u]] = await conn.query('SELECT full_name FROM tbl_users WHERE user_id = ?', [userId]);
  return u?.full_name || `user #${userId}`;
}

async function assign(req, recordType, recordId, rawStaffId, reference) {
  return require('../config/db').withTransaction((conn) => assignWith(conn, req, recordType, recordId, rawStaffId, reference));
}

/** The assignment, its audit entries and the notifications in one transaction. */
async function assignWith(conn, req, recordType, recordId, rawStaffId, reference) {
  const pool = conn; // every query below runs on the transaction
  const t = TABLES[recordType];
  if (!t) throw new HttpError(400, 'Unknown record type.');
  const staffId = rawStaffId === null || rawStaffId === '' || rawStaffId === undefined ? null : Number(rawStaffId);
  if (staffId !== null) {
    const [[u]] = await pool.query('SELECT u.is_active, r.role_name FROM tbl_users u JOIN tbl_roles r ON r.role_id = u.role_id WHERE u.user_id = ?', [staffId]);
    if (!u || u.role_name !== 'Staff' || !u.is_active) throw new HttpError(400, 'Choose an active Staff account.');
  }
  const [[cur]] = await pool.query(`SELECT assigned_staff_id FROM ${t.table} WHERE ${t.id} = ? FOR UPDATE`, [recordId]);
  if (!cur) throw new HttpError(404, 'Record not found.');
  if ((cur.assigned_staff_id ?? null) === staffId) return;
  await pool.query(`UPDATE ${t.table} SET assigned_staff_id = ?, assigned_by = ?, assigned_at = NOW() WHERE ${t.id} = ?`, [staffId, req.user.user_id, recordId]);
  // Anyone else who had the record unlocked loses it now.
  await pool.query(
    "UPDATE tbl_unlock_sessions SET ended_at = NOW(), end_reason = 'revoked', revoked_by = ? WHERE record_type = ? AND record_id = ? AND ended_at IS NULL AND user_id <> ?",
    [req.user.user_id, t.session || recordType, String(recordId), staffId ?? 0]);
  const [oldName, newName] = await Promise.all([staffName(cur.assigned_staff_id, conn), staffName(staffId, conn)]);
  const what = !cur.assigned_staff_id ? 'ASSIGNED' : !staffId ? 'UNASSIGNED' : 'REASSIGNED';
  const prefix = t.code || (recordType === 'transition_review' ? 'TRANSITION' : 'ADOPTION');
  await logActivityWith(conn, req, `${prefix}_${what} (${oldName || 'none'} -> ${newName || 'none'})`, recordType === 'child' ? `Child ${recordId}` : `${t.label} #${recordId}`);
  await U.logEvent(req, { recordType: t.session || recordType, recordId, event: 'assigned', detail: `${oldName || 'none'} -> ${newName || 'none'}` });
  const params = { id: recordId, ref: reference, kind: recordType };
  const entity = { entityType: { transition_review: 'transition_review', child: 'child' }[recordType] || 'application', entityId: recordId };
  if (staffId) await Notify.emit(conn, 'assigned', { ...entity, userId: staffId, params });
  if (cur.assigned_staff_id && cur.assigned_staff_id !== staffId) await Notify.emit(conn, 'unassigned', { ...entity, userId: cur.assigned_staff_id, params });
}

module.exports = { assign, assignWith, TABLES };
