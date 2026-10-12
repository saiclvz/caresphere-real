const HttpError = require('../utils/HttpError');
const { logActivity, logSecurityEvent } = require('../utils/audit');
const C = require('../services/compliance');
const Adoption = require('../models/adoptionModel');

const idParam = (v) => { const n = Number(v); if (!Number.isInteger(n) || n < 1) throw new HttpError(404, 'Not found.'); return n; };

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

const CAPTURE_KINDS = ['print_screen', 'capture_shortcut', 'print', 'save_page', 'copy', 'cut', 'right_click', 'drag', 'watermark_tampered'];
/** Admin may take screenshots and screen recordings (Admin screenshot policy), so these are not attempts for Admin. */
const SCREENSHOT_KINDS = ['print_screen', 'capture_shortcut'];
/**
 * POST /api/security/capture-attempts (signed in) { area, kind, path } - a screenshot, print or copy attempt
 * the browser noticed on a protected page. Logged as a security event and in the Audit log.
 */
exports.captureAttempt = async (req, res) => {
  const kind = String(req.body?.kind || '');
  if (!CAPTURE_KINDS.includes(kind)) throw new HttpError(400, 'Unknown attempt.');
  if (req.user.role === 'Admin' && SCREENSHOT_KINDS.includes(kind)) return res.json({ success: true, data: { recorded: false } });
  const area = String(req.body?.area || '').replace(/[^\w\s-]/g, '').slice(0, 60) || 'Protected page';
  const path = String(req.body?.path || '').slice(0, 200);
  // Browser, OS and device from the request's User-Agent (the page's own report is shown alongside).
  const client = require('../utils/device').clientLabel(req);
  const event = kind === 'watermark_tampered' ? 'WATERMARK_TAMPERED' : 'CAPTURE_ATTEMPT';
  await logSecurityEvent(req, event, { detail: `${kind} on ${area} (${path}); ${client}` });
  await logActivity(req, `${event} (${kind}, ${area}; ${client})`, path || area);
  res.json({ success: true });
};
