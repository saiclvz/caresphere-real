const HttpError = require('../utils/HttpError');
const U = require('../services/unlockService');
const CFG = require('../config/sensitiveAccess');
const healthAccess = require('../services/healthAccessService');

/** GET /api/unlock/options?record_type= (Admin, Staff) - purposes for that record type and the timers. */
exports.options = async (req, res) => {
  const type = String(req.query.record_type || '');
  if (!CFG.RECORD_TYPES.includes(type)) throw new HttpError(400, 'Unknown record type.');
  res.json({ success: true, data: {
    purposes: CFG.PURPOSES[type], access_session: CFG.ACCESS_SESSION, token_typing_window: CFG.TOKEN_TYPING_WINDOW, warning_seconds: CFG.WARNING_SECONDS,
  } });
};

/** POST /api/unlock/challenges (Staff) { record_type, record_id, purpose, purpose_note?, acknowledged: true, refresh? } -> plain-text QR. */
exports.createChallenge = async (req, res) => {
  res.status(201).json({ success: true, data: await U.createChallenge(req, req.body || {}) });
};

/**
 * POST /api/unlock/verify (Staff) { record_type, record_id, token }
 * Health also gets its health-access token for the same length, so the health record and case
 * files open with this one verification.
 */
exports.verify = async (req, res) => {
  const result = await U.verify(req, req.body || {});
  if (req.body.record_type === 'health') {
    const health = await healthAccess.issue(req, String(req.body.record_id), 'unlock', result.remaining_seconds);
    result.health_access_token = health.access_token;
  }
  res.json({ success: true, data: result });
};

/** POST /api/unlock/lock (Staff) { record_type, record_id } - "Lock now". */
exports.lock = async (req, res) => {
  await U.lockNow(req, req.body || {});
  if (req.body?.record_type === 'health') await healthAccess.revoke(req, String(req.body.record_id)).catch(() => {});
  res.json({ success: true });
};

const CLIENT_EVENTS = ['copy', 'print', 'view_section', 'warning_shown'];
/** POST /api/unlock/events (Admin, Staff) { record_type, record_id, event, detail? } - actions the browser can detect. */
exports.clientEvent = async (req, res) => {
  const event = String(req.body?.event || '');
  if (!CLIENT_EVENTS.includes(event)) throw new HttpError(400, 'Unknown event.');
  const recordType = String(req.body?.record_type || '');
  if (!CFG.RECORD_TYPES.includes(recordType)) throw new HttpError(400, 'Unknown record type.');
  const recordId = String(req.body?.record_id || '').slice(0, 50);
  const s = req.user.role === 'Admin' ? null : await U.sessionFor(req, recordType, recordId);
  await U.logEvent(req, { recordType, recordId, event, purpose: s?.purpose || (req.user.role === 'Admin' ? 'Admin full access' : null), detail: String(req.body?.detail || '').slice(0, 200) || null });
  res.json({ success: true });
};

/** GET /api/unlock/sessions?record_type=&record_id= (Admin) - who unlocked a record, when and why. */
exports.sessions = async (req, res) => {
  const recordType = String(req.query.record_type || '');
  if (!CFG.RECORD_TYPES.includes(recordType)) throw new HttpError(400, 'Unknown record type.');
  // ?page= gives the paged Access tab view (active first, then the ended history, 10 a page).
  if (req.query.page !== undefined) {
    const page = Math.max(1, Math.min(10000, Number.parseInt(req.query.page, 10) || 1));
    const userId = req.query.user_id ? Number.parseInt(req.query.user_id, 10) || null : null;
    const state = ['active', 'ended'].includes(req.query.state) ? req.query.state : 'all';
    res.json({ success: true, data: await U.sessionsPage(recordType, String(req.query.record_id || ''), { page, userId, state }) });
    return;
  }
  res.json({ success: true, data: await U.sessionsFor(recordType, String(req.query.record_id || '')) });
};

/** GET /api/unlock/sessions/active (Admin) */
exports.active = async (req, res) => {
  res.json({ success: true, data: await U.activeSessions() });
};

/** POST /api/unlock/sessions/:id/revoke (Admin) */
exports.revoke = async (req, res) => {
  await U.revoke(req, Number(req.params.id));
  res.json({ success: true, data: await U.activeSessions() });
};
