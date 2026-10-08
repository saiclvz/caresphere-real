/**
 * Confidentiality undertakings (per area, first opening in each sign-in session), release of information, data subject
 * requests and the security incident log (RA 10173).
 */
const { pool } = require('../config/db');
const HttpError = require('../utils/HttpError');

const U = require('../config/undertaking');
const { deviceType } = require('../utils/device');
const ipOf = (req) => (req.ip || '').replace(/^::ffff:/, '').slice(0, 45);
/** Short, non-secret reference for a sign-in session (for the audit log). */
const sessionRef = (jti) => require('crypto').createHash('sha256').update(String(jti || '')).digest('hex').slice(0, 8);

function cleanArea(area) {
  const a = String(area || '');
  if (!U.AREAS[a]) throw new HttpError(400, 'Unknown area. Use adoption or transition.');
  return a;
}

/** The current version for an area (its first version is added from config/undertaking.js on first use). */
async function currentVersion(area) {
  const a = U.textArea(cleanArea(area));
  const [[row]] = await pool.query('SELECT version_id, version, area, title, paragraphs, created_at FROM tbl_undertaking_versions WHERE area = ? ORDER BY version_id DESC LIMIT 1', [a]);
  if (row) return { ...row, paragraphs: JSON.parse(row.paragraphs) };
  const f = U.AREAS[a].first;
  await pool.query('INSERT IGNORE INTO tbl_undertaking_versions (version, area, title, paragraphs) VALUES (?, ?, ?, ?)', [f.version, a, f.title, JSON.stringify(f.paragraphs)]);
  return currentVersion(a);
}

// Accepted (session, area) pairs; the database is the record, this only saves queries.
const accepted = new Set();
/** Has this sign-in session accepted the undertaking for the area? */
async function sessionAccepted(jti, area) {
  if (!jti) return false;
  const key = `${jti}:${U.acceptanceArea(area)}`;
  if (accepted.has(key)) return true;
  const [[row]] = await pool.query('SELECT undertaking_id FROM tbl_confidentiality_undertakings WHERE session_jti = ? AND area = ?', [jti, U.acceptanceArea(area)]);
  if (row) accepted.add(key);
  return Boolean(row);
}

async function undertakingStatus(req, area) {
  const a = cleanArea(area);
  const v = await currentVersion(a);
  return { area: a, area_label: U.AREAS[a].label, records: U.AREAS[a].records, version: v.version, title: v.title, paragraphs: v.paragraphs,
    accepted: await sessionAccepted(req.auth?.jti, a), scope: U.SCOPE };
}

/** Accept for this session and area: user, session, area, version shown, time, device and IP. */
async function acceptUndertaking(req, area) {
  const a = cleanArea(area);
  const v = await currentVersion(a);
  if (req.body?.version && req.body.version !== v.version) throw new HttpError(409, 'The undertaking was updated. Read the new version and accept it.');
  await pool.query(
    'INSERT IGNORE INTO tbl_confidentiality_undertakings (user_id, version, version_id, area, session_jti, ip_address, device_type) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [req.user.user_id, v.version, v.version_id, U.acceptanceArea(a), req.auth.jti, ipOf(req), deviceType(req)]);
  accepted.add(`${req.auth.jti}:${U.acceptanceArea(a)}`);
  return { area: a, area_label: U.AREAS[a].label, version: v.version, session: sessionRef(req.auth.jti) };
}

/** Admin: a new version of an area's text (CU-<year>-<n> or CU-TR-<year>-<n>); old versions stay as saved. */
async function updateUndertaking(req, area, body) {
  const a = cleanArea(area);
  const title = String(body?.title || '').trim();
  const paragraphs = (Array.isArray(body?.paragraphs) ? body.paragraphs : []).map((x) => String(x).trim()).filter(Boolean);
  if (title.length < 3 || title.length > 150) throw new HttpError(400, 'Title must be 3 to 150 characters.');
  if (!paragraphs.length || paragraphs.length > 12 || paragraphs.some((x) => x.length > 2000)) throw new HttpError(400, 'Enter 1 to 12 paragraphs, each up to 2,000 characters.');
  const cur = await currentVersion(a);
  if (cur.title === title && JSON.stringify(cur.paragraphs) === JSON.stringify(paragraphs)) throw new HttpError(400, 'Nothing changed.');
  const year = new Date().getFullYear();
  const prefix = U.AREAS[a].versionPrefix;
  const [[n]] = await pool.query('SELECT COUNT(*) AS n FROM tbl_undertaking_versions WHERE area = ? AND version LIKE ?', [a, `${prefix}-${year}-%`]);
  const version = `${prefix}-${year}-${Number(n.n) + 1}`;
  await pool.query('INSERT INTO tbl_undertaking_versions (version, area, title, paragraphs, previous_version, created_by) VALUES (?, ?, ?, ?, ?, ?)',
    [version, a, title, JSON.stringify(paragraphs), cur.version, req.user.user_id]);
  return { area: a, old: cur.version, version };
}

async function undertakingHistory(area) {
  const a = cleanArea(area);
  await currentVersion(a); // make sure the first version exists
  const [rows] = await pool.query(
    `SELECT v.version_id, v.version, v.area, v.previous_version, v.title, v.paragraphs, v.created_at, u.full_name AS created_by_name,
            (SELECT COUNT(*) FROM tbl_confidentiality_undertakings c WHERE c.version = v.version) AS acceptances
       FROM tbl_undertaking_versions v LEFT JOIN tbl_users u ON u.user_id = v.created_by WHERE v.area = ? ORDER BY v.version_id DESC`, [a]);
  return rows.map((r) => ({ ...r, paragraphs: JSON.parse(r.paragraphs), acceptances: Number(r.acceptances) }));
}

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
  undertakingStatus, acceptUndertaking, sessionAccepted, currentVersion, updateUndertaking, undertakingHistory, sessionRef, cleanArea,
  recordRelease, listReleases, createRequest, listRequests, updateRequest, DSR_KINDS, DSR_STATUSES,
  createIncident, updateIncident, listIncidents, securityEvents, SEVERITIES,
};
