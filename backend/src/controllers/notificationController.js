const HttpError = require('../utils/HttpError');
const N = require('../services/notifications');
const { CATEGORIES } = require('../config/notificationEvents');
const { readPagination } = require('../utils/pagination');
const { logActivity } = require('../utils/audit');

const user = (req) => ({ user_id: req.user.user_id, role: req.user.role });
const FILTER_KEYS = ['status', 'category', 'priority', 'date', 'from', 'to', 'q', 'sort'];
const filters = (src) => Object.fromEntries(FILTER_KEYS.filter((k) => src?.[k] !== undefined && src[k] !== '').map((k) => [k, String(src[k])]));

/**
 * GET /api/notifications?status=&category=&priority=&date=&from=&to=&q=&sort=&page=&limit=
 * The signed-in user's own notifications, filtered, sorted and paged on the server.
 */
exports.list = async (req, res) => {
  const paging = readPagination(req.query) || { page: 1, limit: 10 };
  const [result, counts] = await Promise.all([N.list(user(req), filters(req.query), paging), N.counts(user(req))]);
  res.json({ success: true, data: result.rows, pagination: result.pagination, counts, unread: counts.all, categories: CATEGORIES[req.user.role] || [] });
};

/** GET /api/notifications/counts - unread per chip (one grouped query). */
exports.counts = async (req, res) => {
  res.json({ success: true, data: await N.counts(user(req)) });
};

/** GET /api/notifications/unread-count - for polling. */
exports.unreadCount = async (req, res) => {
  const counts = await N.counts(user(req));
  res.json({ success: true, data: { unread: counts.all, counts } });
};

/** POST /api/notifications/:id/open - marks read and returns the link (or a friendly message). */
exports.open = async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) throw new HttpError(404, 'Notification not found.');
  res.json({ success: true, data: await N.open(user(req), id) });
};

/** POST /api/notifications/:id/read and /:id/unread */
exports.markRead = async (req, res) => {
  if (!(await N.setRead(req.user.user_id, [req.params.id], true))) throw new HttpError(404, 'Notification not found.');
  res.json({ success: true, data: { unread: await N.unreadCount(req.user.user_id) } });
};
exports.markUnread = async (req, res) => {
  if (!(await N.setRead(req.user.user_id, [req.params.id], false))) throw new HttpError(404, 'Notification not found.');
  res.json({ success: true, data: { unread: await N.unreadCount(req.user.user_id) } });
};

/** POST /api/notifications/bulk { ids, action: read | unread | dismiss } - own notifications only. */
exports.bulk = async (req, res) => {
  const action = String(req.body?.action || '');
  let changed;
  if (action === 'read' || action === 'unread') changed = await N.setRead(req.user.user_id, req.body?.ids, action === 'read');
  else if (action === 'dismiss') changed = await N.dismiss(req.user.user_id, req.body?.ids);
  else throw new HttpError(400, 'Choose read, unread or dismiss.');
  res.json({ success: true, data: { changed, unread: await N.unreadCount(req.user.user_id) } });
};

/** POST /api/notifications/read-all { filters? } - marks what the filters show (everything when empty). */
exports.markAllRead = async (req, res) => {
  const changed = await N.markAllRead(user(req), filters(req.body?.filters || {}));
  res.json({ success: true, data: { changed, unread: await N.unreadCount(req.user.user_id) } });
};

/** POST /api/notifications/read-application/:applicationId - opening an application marks its notifications read. */
exports.markApplicationRead = async (req, res) => {
  const id = Number(req.params.applicationId);
  if (!Number.isInteger(id)) throw new HttpError(404, 'Not found.');
  await N.markApplicationRead(req.user.user_id, id);
  res.json({ success: true, data: { unread: await N.unreadCount(req.user.user_id) } });
};

/** GET / PUT /api/notifications/preferences { category, enabled } */
exports.preferences = async (req, res) => {
  res.json({ success: true, data: await N.preferences(user(req)) });
};
exports.setPreference = async (req, res) => {
  await N.setPreference(user(req), String(req.body?.category || ''), req.body?.enabled !== false);
  res.json({ success: true, data: await N.preferences(user(req)) });
};

/** GET /api/notifications/cleanup (Admin) - how many read notifications are past the retention period. */
exports.cleanupPreview = async (req, res) => {
  res.json({ success: true, data: await N.cleanupPreview() });
};
/** POST /api/notifications/cleanup (Admin) - deletes them, after the Admin confirmed; written to the audit log. */
exports.cleanupRun = async (req, res) => {
  const r = await N.cleanupRun();
  await logActivity(req, `NOTIFICATION_CLEANUP (${r.deleted} read notifications older than ${r.days} days)`, 'Notifications');
  res.json({ success: true, data: r });
};
