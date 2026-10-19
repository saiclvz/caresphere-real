/**
 * Release of information, data subject
 * requests and the security incident log (RA 10173).
 */
const { pool } = require('../config/db');
const HttpError = require('../utils/HttpError');

// ------------------------------------------------------------------ release of information (Admin)
const str = (v) => (v === undefined || v === null ? '' : String(v).trim());
function need(value, label, max, min = 1) {
  const v = str(value);
  if (v.length < min) throw new HttpError(400, `${label} is required.`);
  if (v.length > max) throw new HttpError(400, `${label} can be up to ${max} characters.`);
  return v;
}

async function recordRelease(req, { applicationId = null, childId = null }, body) {
  const row = {
    requester_name: need(body.requester_name, 'Requester name', 150),
    requester_org: str(body.requester_org).slice(0, 150) || null,
    purpose: need(body.purpose, 'Purpose', 1000, 5),
    nacc_authorization: need(body.nacc_authorization, 'NACC authorization reference', 120),
    released_items: need(body.released_items, 'What was released', 2000, 3),
  };
  const [res] = await pool.query(
    `INSERT INTO tbl_information_releases (application_id, child_id, requester_name, requester_org, purpose, nacc_authorization, released_items, released_by, ip_address)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [applicationId, childId, row.requester_name, row.requester_org, row.purpose, row.nacc_authorization, row.released_items, req.user.user_id,
      (req.ip || '').replace(/^::ffff:/, '').slice(0, 45)]);
  return res.insertId;
}

async function listReleases({ applicationId, childId } = {}) {
  const where = [];
  const params = [];
  if (applicationId) { where.push('r.application_id = ?'); params.push(applicationId); }
  if (childId) { where.push('r.child_id = ?'); params.push(childId); }
  const [rows] = await pool.query(
    `SELECT r.*, u.full_name AS released_by_name, a.reference_no FROM tbl_information_releases r
       JOIN tbl_users u ON u.user_id = r.released_by LEFT JOIN tbl_adoption_applications a ON a.application_id = r.application_id
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY r.released_at DESC LIMIT 500`, params);
  return rows;
}

// ------------------------------------------------------------------ data subject requests
const DSR_KINDS = ['Access', 'Correction'];
const DSR_STATUSES = ['Open', 'In progress', 'Resolved', 'Rejected'];

async function createRequest(req, body) {
  const kind = str(body.kind);
  if (!DSR_KINDS.includes(kind)) throw new HttpError(400, 'Choose Access or Correction.');
  const details = need(body.details, 'Details', 3000, 10);
  let applicationId = null;
  if (body.application_id) {
    const [[a]] = await pool.query('SELECT application_id FROM tbl_adoption_applications WHERE application_id = ? AND applicant_id = ?',
      [Number(body.application_id), req.user.user_id]);
    if (!a) throw new HttpError(404, 'Application not found.');
    applicationId = a.application_id;
  }
  const [res] = await pool.query('INSERT INTO tbl_data_subject_requests (user_id, application_id, kind, details) VALUES (?, ?, ?, ?)',
    [req.user.user_id, applicationId, kind, details]);
  return res.insertId;
}

async function listRequests({ userId, status } = {}) {
  const where = [];
  const params = [];
  if (userId) { where.push('r.user_id = ?'); params.push(userId); }
  if (status) { where.push('r.status = ?'); params.push(status); }
  const [rows] = await pool.query(
    `SELECT r.request_id, r.user_id, u.full_name AS requester_name, u.email AS requester_email, r.application_id, a.reference_no,
            r.kind, r.details, r.status, r.response, r.created_at, r.resolved_at, rb.full_name AS resolved_by_name
       FROM tbl_data_subject_requests r JOIN tbl_users u ON u.user_id = r.user_id
       LEFT JOIN tbl_adoption_applications a ON a.application_id = r.application_id
       LEFT JOIN tbl_users rb ON rb.user_id = r.resolved_by
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY FIELD(r.status, 'Open', 'In progress', 'Resolved', 'Rejected'), r.created_at DESC`, params);
  return rows;
}

async function updateRequest(req, id, body) {
  const status = str(body.status);
  if (!DSR_STATUSES.includes(status)) throw new HttpError(400, `Status must be one of: ${DSR_STATUSES.join(', ')}.`);
  const response = str(body.response);
  if (['Resolved', 'Rejected'].includes(status) && response.length < 5) throw new HttpError(400, 'Write a response to the requester when resolving or rejecting.');
  if (response.length > 3000) throw new HttpError(400, 'The response can be up to 3000 characters.');
  const done = ['Resolved', 'Rejected'].includes(status);
  // A rejected request is locked for Staff: they can't change the status or the decision. Only an Admin can
  // reopen it (the separate authorized step); every change stays in the Audit log.
  const [[cur]] = await pool.query('SELECT status FROM tbl_data_subject_requests WHERE request_id = ?', [id]);
  if (!cur) throw new HttpError(404, 'Request not found.');
  if (cur.status === 'Rejected' && req.user.role !== 'Admin') {
    await require('../utils/audit').logActivity(req, 'DATA_SUBJECT_REQUEST_EDIT_DENIED (rejected, locked)', `Request #${id}`);
    throw new HttpError(403, 'This request was rejected and is locked. Only an administrator can reopen it.', { locked: true });
  }
  if (cur.status === 'Rejected' && status !== 'Rejected' && response.length < 5) {
    throw new HttpError(400, 'Write why the rejected request is being reopened (it is recorded and shown to the requester).');
  }
  const [res] = await pool.query(
    `UPDATE tbl_data_subject_requests SET status = ?, response = COALESCE(?, response),
            resolved_at = ${done ? 'NOW()' : 'NULL'}, resolved_by = ${done ? '?' : 'NULL'} WHERE request_id = ?`,
    done ? [status, response || null, req.user.user_id, id] : [status, response || null, id]);
  if (!res.affectedRows) throw new HttpError(404, 'Request not found.');
}

// ------------------------------------------------------------------ security incidents (Admin)
const SEVERITIES = ['Low', 'Medium', 'High', 'Serious'];
const dt = (v, label) => {
  const s = str(v).replace('T', ' ');
  if (!s) return null;
  if (!/^\d{4}-\d{2}-\d{2}( \d{2}:\d{2}(:\d{2})?)?$/.test(s)) throw new HttpError(400, `Enter a valid ${label}.`);
  return s;
};
function cleanIncident(body, { partial = false } = {}) {
  const out = {};
  if (!partial || body.discovered_at !== undefined) {
    out.discovered_at = dt(body.discovered_at, 'discovery date');
    if (!out.discovered_at) throw new HttpError(400, 'Discovery date is required.');
  }
  if (!partial || body.severity !== undefined) {
    if (!SEVERITIES.includes(str(body.severity))) throw new HttpError(400, `Severity must be one of: ${SEVERITIES.join(', ')}.`);
    out.severity = str(body.severity);
  }
  if (!partial || body.description !== undefined) out.description = need(body.description, 'Description', 3000, 10);
  if (body.occurred_at !== undefined) out.occurred_at = dt(body.occurred_at, 'occurrence date');
  if (body.affected !== undefined) out.affected = str(body.affected).slice(0, 1000) || null;
  if (body.actions_taken !== undefined) out.actions_taken = str(body.actions_taken).slice(0, 3000) || null;
  if (body.npc_notified_at !== undefined) out.npc_notified_at = dt(body.npc_notified_at, 'NPC notification date');
  if (body.subjects_notified_at !== undefined) out.subjects_notified_at = dt(body.subjects_notified_at, 'notification date');
  return out;
}

async function createIncident(req, body) {
  const f = cleanIncident(body);
  const keys = Object.keys(f);
  const [res] = await pool.query(`INSERT INTO tbl_security_incidents (${keys.join(', ')}, reported_by) VALUES (${keys.map(() => '?').join(', ')}, ?)`,
    [...keys.map((k) => f[k]), req.user.user_id]);
  return res.insertId;
}
async function updateIncident(id, body) {
  const f = cleanIncident(body, { partial: true });
  const keys = Object.keys(f);
  if (!keys.length) return;
  const [res] = await pool.query(`UPDATE tbl_security_incidents SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE incident_id = ?`, [...keys.map((k) => f[k]), id]);
  if (!res.affectedRows) throw new HttpError(404, 'Incident not found.');
}
async function listIncidents() {
  const [rows] = await pool.query(
    `SELECT i.*, u.full_name AS reported_by_name,
            (i.severity IN ('High', 'Serious') AND i.npc_notified_at IS NULL AND i.discovered_at < NOW() - INTERVAL 72 HOUR) AS npc_overdue
       FROM tbl_security_incidents i JOIN tbl_users u ON u.user_id = i.reported_by ORDER BY i.discovered_at DESC`);
  return rows.map((r) => ({ ...r, npc_overdue: !!r.npc_overdue }));
}

async function securityEvents(limit = 300) {
  const [rows] = await pool.query(
    `SELECT e.event_id, e.event_type, e.user_id, u.full_name AS user_name, e.detail, e.ip_address, e.created_at
       FROM tbl_security_events e LEFT JOIN tbl_users u ON u.user_id = e.user_id ORDER BY e.created_at DESC, e.event_id DESC LIMIT ?`, [limit]);
  return rows;
}

module.exports = {
  recordRelease, listReleases, createRequest, listRequests, updateRequest, DSR_KINDS, DSR_STATUSES,
  createIncident, updateIncident, listIncidents, securityEvents, SEVERITIES,
};
