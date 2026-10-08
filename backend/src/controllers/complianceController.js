const HttpError = require('../utils/HttpError');
const { logActivity } = require('../utils/audit');
const C = require('../services/compliance');
const Adoption = require('../models/adoptionModel');

const idParam = (v) => { const n = Number(v); if (!Number.isInteger(n) || n < 1) throw new HttpError(404, 'Not found.'); return n; };

/** GET /api/compliance/undertaking?area=adoption|transition (Admin, Staff) - current text and whether this session accepted it. */
exports.undertaking = async (req, res) => {
  res.json({ success: true, data: await C.undertakingStatus(req, req.query.area) });
};

/** POST /api/compliance/undertaking { area, version } (Admin, Staff) - accepts for this sign-in session and area. */
exports.acceptUndertaking = async (req, res) => {
  const d = await C.acceptUndertaking(req, req.body?.area);
  await logActivity(req, `CONFIDENTIALITY_UNDERTAKING_ACCEPTED (${d.area_label}, ${d.version}, session ${d.session})`, `User #${req.user.user_id}`);
  res.json({ success: true, data: d });
};

/** POST /api/compliance/undertaking/decline { area } (Admin, Staff) - logged; the user stays signed in. */
exports.declineUndertaking = async (req, res) => {
  const area = C.cleanArea(req.body?.area);
  const v = await C.currentVersion(area);
  const label = require('../config/undertaking').AREAS[area].label;
  await logActivity(req, `CONFIDENTIALITY_UNDERTAKING_DECLINED (${label}, ${v.version}, session ${C.sessionRef(req.auth.jti)})`, `User #${req.user.user_id}`);
  res.json({ success: true, message: 'You need to accept the undertaking to open these records.' });
};

/** GET /api/compliance/undertaking/versions?area= (Admin) - every version of an area's text, with who and when. */
exports.undertakingVersions = async (req, res) => {
  res.json({ success: true, data: await C.undertakingHistory(req.query.area) });
};

/** PUT /api/compliance/undertaking { area, title, paragraphs[] } (Admin) - saves a new version for the area. */
exports.updateUndertaking = async (req, res) => {
  const r = await C.updateUndertaking(req, req.body?.area, req.body || {});
  await logActivity(req, `UNDERTAKING_TEXT_CHANGED (${r.area}: ${r.old} -> ${r.version})`, 'Confidentiality undertaking');
  res.json({ success: true, data: await C.undertakingHistory(r.area) });
};

/** POST /api/adoptions/:id/releases (Admin) - release of information to a third party (NACC authorization required). */
exports.createRelease = async (req, res) => {
  const id = idParam(req.params.id);
  const app = await Adoption.findById(id);
  if (!app || app.status === 'Draft') throw new HttpError(404, 'Application not found.');
  const releaseId = await C.recordRelease(req, { applicationId: id, childId: app.matched_child_id || null }, req.body || {});
  await logActivity(req, `INFORMATION_RELEASED (release #${releaseId}, NACC ref ${String(req.body.nacc_authorization).slice(0, 60)})`, `Application #${id}`);
  res.status(201).json({ success: true, data: await C.listReleases({ applicationId: id }) });
};

/** GET /api/releases?application_id= (Admin) */
exports.listReleases = async (req, res) => {
  const applicationId = req.query.application_id ? idParam(req.query.application_id) : undefined;
  await logActivity(req, 'VIEW_INFORMATION_RELEASES', applicationId ? `Application #${applicationId}` : 'All');
  res.json({ success: true, data: await C.listReleases({ applicationId }) });
};

/** POST /api/privacy-requests (Donor) { kind: Access|Correction, details, application_id? } */
exports.createPrivacyRequest = async (req, res) => {
  const id = await C.createRequest(req, req.body || {});
  await logActivity(req, `DATA_SUBJECT_REQUEST (${req.body.kind})`, `Request #${id}`);
  res.status(201).json({ success: true, data: await C.listRequests({ userId: req.user.user_id }) });
};

/** GET /api/privacy-requests/mine (Donor) */
exports.myPrivacyRequests = async (req, res) => {
  res.json({ success: true, data: await C.listRequests({ userId: req.user.user_id }) });
};

/** GET /api/privacy-requests?status= (Admin, Staff) - the queue staff must resolve. */
exports.listPrivacyRequests = async (req, res) => {
  const status = req.query.status ? String(req.query.status) : undefined;
  if (status && !C.DSR_STATUSES.includes(status)) throw new HttpError(400, 'Choose a status from the list.');
  res.json({ success: true, data: await C.listRequests({ status }) });
};

/** PUT /api/privacy-requests/:id (Admin, Staff) { status, response } */
exports.updatePrivacyRequest = async (req, res) => {
  const id = idParam(req.params.id);
  await C.updateRequest(req, id, req.body || {});
  await logActivity(req, `DATA_SUBJECT_REQUEST_${String(req.body.status).toUpperCase().replace(/\s+/g, '_')}`, `Request #${id}`);
  res.json({ success: true, data: await C.listRequests({}) });
};

/** Security incident log (Admin). Serious breaches must reach the NPC and affected people within 72 hours. */
exports.listIncidents = async (req, res) => {
  res.json({ success: true, data: await C.listIncidents(), reminder: 'Serious personal data breaches must be reported to the National Privacy Commission and the affected people within 72 hours of discovery (RA 10173, NPC Circular 16-03).' });
};
exports.createIncident = async (req, res) => {
  const id = await C.createIncident(req, req.body || {});
  await logActivity(req, `SECURITY_INCIDENT_LOGGED (${req.body.severity})`, `Incident #${id}`);
  res.status(201).json({ success: true, data: await C.listIncidents() });
};
exports.updateIncident = async (req, res) => {
  const id = idParam(req.params.id);
  await C.updateIncident(id, req.body || {});
  await logActivity(req, 'SECURITY_INCIDENT_UPDATED', `Incident #${id}`);
  res.json({ success: true, data: await C.listIncidents() });
};

/** GET /api/security-events (Admin) - failed logins, lockouts, unauthorized access, token failures. */
exports.securityEvents = async (req, res) => {
  res.json({ success: true, data: await C.securityEvents() });
};
