/**
 * In-app notifications for Admin, Staff and Donor (one system; wording in config/notificationEvents.js).
 *
 * emit() is always called with the connection of the transaction that made the change, so the change
 * and its notification are saved together or not at all. A group key makes events idempotent
 * ("once": a repeat is ignored) or grouped ("count" / "set": one row per user whose count updates).
 * Every read and change is limited to the signed-in user's own rows.
 */
const { pool } = require('../config/db');
const HttpError = require('../utils/HttpError');
const { CATEGORIES, EVENTS, storedCategories } = require('../config/notificationEvents');
const { pageInfo } = require('../utils/pagination');

const clip = (s, n) => String(s ?? '').slice(0, n);

/**
 * Creates (or updates, for grouped events) one user's notification.
 * opts: { userId, params, entityType, entityId, applicationId, groupKey, mode: 'once' | 'count' | 'set' }
 */
async function emit(conn, type, opts) {
  const cfg = EVENTS[type];
  if (!cfg) throw new Error(`Unknown notification type ${type}`);
  const [[u]] = await conn.query('SELECT r.role_name, u.is_active FROM tbl_users u JOIN tbl_roles r ON r.role_id = u.role_id WHERE u.user_id = ?', [opts.userId]);
  if (!u) return;
  if (!cfg.critical) {
    const [[pref]] = await conn.query('SELECT enabled FROM tbl_notification_preferences WHERE user_id = ? AND category = ?', [opts.userId, cfg.category]);
    if (pref && !pref.enabled) return; // the user turned this category off
  }
  const params = { ...(opts.params || {}) };
  const priority = cfg.priority || 'info';
  const priorityFinal = type === 'admin_unlock_started' && params.unusual ? 'warning' : priority;
  const build = () => [clip(cfg.title(params), 150), clip(cfg.body(params), 300), clip(cfg.link(params), 255)];

  if (opts.groupKey) {
    const [[cur]] = await conn.query(
      'SELECT notification_id, is_read, dismissed_at, group_count FROM tbl_notifications WHERE user_id = ? AND group_key = ? FOR UPDATE', [opts.userId, opts.groupKey]);
    if (cur && (opts.mode || 'once') === 'once') return; // idempotent: already notified
    if (opts.mode === 'count') params.count = cur && !cur.is_read && !cur.dismissed_at ? cur.group_count + 1 : 1;
    const [title, body, link] = build();
    if (cur) {
      await conn.query(
        `UPDATE tbl_notifications SET title = ?, body = ?, link = ?, priority = ?, group_count = ?, is_read = FALSE, read_at = NULL,
                dismissed_at = NULL, created_at = NOW() WHERE notification_id = ?`,
        [title, body, link, priorityFinal, params.count || 1, cur.notification_id]);
      return;
    }
    await conn.query(
      `INSERT INTO tbl_notifications (user_id, role, kind, type, category, priority, application_id, title, body, link, entity_type, entity_id, group_key, group_count)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [opts.userId, u.role_name, type, type, cfg.category, priorityFinal, opts.applicationId || null, title, body, link,
        opts.entityType || null, opts.entityId != null ? String(opts.entityId) : null, opts.groupKey, params.count || 1]);
    return;
  }
  const [title, body, link] = build();
  await conn.query(
    `INSERT INTO tbl_notifications (user_id, role, kind, type, category, priority, application_id, title, body, link, entity_type, entity_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [opts.userId, u.role_name, type, type, cfg.category, priorityFinal, opts.applicationId || null, title, body, link,
      opts.entityType || null, opts.entityId != null ? String(opts.entityId) : null]);
}

async function activeIds(conn, role, exceptUserId) {
  const [rows] = await conn.query(
    'SELECT u.user_id FROM tbl_users u JOIN tbl_roles r ON r.role_id = u.role_id WHERE r.role_name = ? AND u.is_active = TRUE AND u.user_id <> ?',
    [role, exceptUserId || 0]);
  return rows.map((r) => r.user_id);
}

/** One notification per active Admin, each with its own read state. */
async function toAdmins(conn, type, opts = {}) {
  for (const id of await activeIds(conn, 'Admin', opts.exceptUserId)) await emit(conn, type, { ...opts, userId: id });
}
async function toStaff(conn, type, opts = {}) {
  for (const id of await activeIds(conn, 'Staff', opts.exceptUserId)) await emit(conn, type, { ...opts, userId: id });
}

/** Adoption stage change for the applicant (reference and stage only; never remarks or notes). */
const STAGE_EVENTS = {
  'Initial review': 'application_under_review', 'Home study scheduled': 'interview_scheduled', 'Cleared for matching': 'application_approved',
  Declined: 'application_declined', Withdrawn: 'application_withdrawn', Submitted: 'application_submitted',
};
async function adoptionStatus(conn, { applicantId, applicationId, reference, status, documentsRequested = false, historyId }) {
  const type = documentsRequested ? 'documents_requested' : STAGE_EVENTS[status] || 'application_status';
  await emit(conn, type, {
    userId: applicantId, applicationId, entityType: 'application', entityId: applicationId,
    params: { id: applicationId, ref: reference || 'your application', status },
    groupKey: historyId ? `${type}:history:${historyId}` : undefined,
  });
}

// ---------------------------------------------------------------- reading

const STATUS = ['all', 'unread', 'read'];
const DATE_PRESETS = { today: 0, '7d': 7, '30d': 30 };
const SORTS = ['newest', 'oldest', 'priority'];
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Validated filters -> SQL. Every query starts with "user_id = <the signed-in user>". */
function where(user, q = {}) {
  const role = user.role;
  const allowed = CATEGORIES[role] || [];
  const w = ['n.user_id = ?', 'n.dismissed_at IS NULL'];
  const p = [user.user_id];
  const status = q.status || 'all';
  if (!STATUS.includes(status)) throw new HttpError(400, 'Unknown status filter.');
  if (status === 'unread') w.push('n.is_read = FALSE');
  if (status === 'read') w.push('n.is_read = TRUE');
  const cats = String(q.category || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (cats.length) {
    const bad = cats.filter((c) => !allowed.some((a) => a.key === c));
    if (bad.length) throw new HttpError(400, 'Unknown category filter.');
    const parts = [];
    const real = cats.filter((c) => !allowed.find((a) => a.key === c).priority);
    if (real.length) { parts.push('n.category IN (?)'); p.push(real); }
    for (const c of cats) { const pr = allowed.find((a) => a.key === c).priority; if (pr) { parts.push('n.priority = ?'); p.push(pr); } }
    w.push(`(${parts.join(' OR ')})`);
  }
  if (q.priority) {
    if (role !== 'Admin') throw new HttpError(400, 'Priority filter is for administrators.');
    const pr = String(q.priority).split(',').filter(Boolean);
    if (pr.some((x) => !['action', 'warning', 'info'].includes(x))) throw new HttpError(400, 'Unknown priority filter.');
    w.push('n.priority IN (?)'); p.push(pr);
  }
  if (q.date) {
    if (q.date === 'custom') {
      if (q.from && !DATE.test(q.from)) throw new HttpError(400, 'from must be YYYY-MM-DD.');
      if (q.to && !DATE.test(q.to)) throw new HttpError(400, 'to must be YYYY-MM-DD.');
      if (q.from) { w.push('DATE(n.created_at) >= ?'); p.push(q.from); }
      if (q.to) { w.push('DATE(n.created_at) <= ?'); p.push(q.to); }
    } else if (q.date in DATE_PRESETS) {
      w.push('DATE(n.created_at) >= CURDATE() - INTERVAL ? DAY'); p.push(DATE_PRESETS[q.date]);
    } else if (q.date !== 'all') throw new HttpError(400, 'Unknown date filter.');
  }
  if (q.q) {
    const s = String(q.q).trim().slice(0, 100);
    if (s) { w.push('(n.title LIKE ? OR n.body LIKE ?)'); const like = `%${s.replace(/[\\%_]/g, (c) => `\\${c}`)}%`; p.push(like, like); }
  }
  return { sql: w.join(' AND '), params: p };
}

const COLS = 'n.notification_id, n.type, n.category, n.priority, n.title, n.body, n.link, n.is_read, n.group_count, n.created_at';
const shape = (r) => ({ ...r, is_read: !!r.is_read });

async function list(user, q = {}, paging = { page: 1, limit: 20 }) {
  const w = where(user, q);
  const sort = q.sort || 'newest';
  if (!SORTS.includes(sort)) throw new HttpError(400, 'Unknown sort.');
  if (sort === 'priority' && user.role !== 'Admin') throw new HttpError(400, 'Priority sort is for administrators.');
  const order = sort === 'oldest' ? 'n.created_at ASC, n.notification_id ASC'
    : sort === 'priority' ? "FIELD(n.priority, 'action', 'warning', 'info'), n.created_at DESC" : 'n.created_at DESC, n.notification_id DESC';
  const [[{ total }]] = await pool.query(`SELECT COUNT(*) AS total FROM tbl_notifications n WHERE ${w.sql}`, w.params);
  const info = pageInfo(paging, Number(total));
  const [rows] = await pool.query(`SELECT ${COLS} FROM tbl_notifications n WHERE ${w.sql} ORDER BY ${order} LIMIT ? OFFSET ?`, [...w.params, info.limit, info.offset]);
  return { rows: rows.map(shape), pagination: { page: info.page, limit: info.limit, total: info.total, total_pages: info.total_pages } };
}

/** Unread counts per chip, in one grouped query (index user_id, category, is_read). */
async function counts(user) {
  const [rows] = await pool.query(
    `SELECT category, priority, COUNT(*) AS n FROM tbl_notifications
      WHERE user_id = ? AND is_read = FALSE AND dismissed_at IS NULL GROUP BY category, priority`, [user.user_id]);
  const out = { all: 0 };
  for (const c of CATEGORIES[user.role] || []) out[c.key] = 0;
  for (const r of rows) {
    const n = Number(r.n);
    out.all += n;
    if (r.category in out) out[r.category] += n;
    if (r.priority === 'action' && 'action_required' in out) out.action_required += n;
    if (r.priority === 'warning' && 'warnings' in out) out.warnings += n;
  }
  return out;
}

async function unreadCount(userId) {
  const [[r]] = await pool.query('SELECT COUNT(*) AS n FROM tbl_notifications WHERE user_id = ? AND is_read = FALSE AND dismissed_at IS NULL', [userId]);
  return Number(r.n);
}

const cleanIds = (ids) => {
  const list = (Array.isArray(ids) ? ids : []).map(Number).filter((n) => Number.isInteger(n) && n > 0);
  if (!list.length || list.length > 200) throw new HttpError(400, 'Choose 1 to 200 notifications.');
  return [...new Set(list)];
};
/** Read / unread / dismiss for the user's own notifications only (other IDs are simply not matched). */
async function setRead(userId, ids, read) {
  const [r] = await pool.query(`UPDATE tbl_notifications SET is_read = ?, read_at = ${read ? 'NOW()' : 'NULL'} WHERE user_id = ? AND notification_id IN (?)`, [read ? 1 : 0, userId, cleanIds(ids)]);
  return r.affectedRows;
}
async function dismiss(userId, ids) {
  const [r] = await pool.query('UPDATE tbl_notifications SET dismissed_at = NOW(), is_read = TRUE, read_at = COALESCE(read_at, NOW()) WHERE user_id = ? AND notification_id IN (?)', [userId, cleanIds(ids)]);
  return r.affectedRows;
}
/** Marks as read what the given filters show (all of the user's unread when no filter). */
async function markAllRead(user, q = {}) {
  const w = where(user, { ...q, status: 'unread' });
  const [r] = await pool.query(`UPDATE tbl_notifications n SET n.is_read = TRUE, n.read_at = NOW() WHERE ${w.sql}`, w.params);
  return r.affectedRows;
}
async function markApplicationRead(userId, applicationId) {
  await pool.query('UPDATE tbl_notifications SET is_read = TRUE, read_at = NOW() WHERE user_id = ? AND application_id = ? AND is_read = FALSE', [userId, applicationId]);
}
/** Unread application notifications per application (My applications badges). */
async function unreadByApplication(userId) {
  const [rows] = await pool.query(
    `SELECT application_id, COUNT(*) AS n FROM tbl_notifications
      WHERE user_id = ? AND is_read = FALSE AND dismissed_at IS NULL AND application_id IS NOT NULL GROUP BY application_id`, [userId]);
  return Object.fromEntries(rows.map((r) => [r.application_id, Number(r.n)]));
}

/**
 * Opening a notification: marks it read, then checks the record it points to still exists and the
 * user may open it. Returns { link } or { message } (never an error page).
 */
async function open(user, id) {
  const [[n]] = await pool.query('SELECT notification_id, link, entity_type, entity_id FROM tbl_notifications WHERE notification_id = ? AND user_id = ?', [id, user.user_id]);
  if (!n) throw new HttpError(404, 'Notification not found.');
  await pool.query('UPDATE tbl_notifications SET is_read = TRUE, read_at = COALESCE(read_at, NOW()) WHERE notification_id = ?', [id]);
  const gone = { message: 'This record is no longer available, or you no longer have access to it.' };
  if (n.entity_type === 'application') {
    const [[a]] = await pool.query('SELECT applicant_id, status FROM tbl_adoption_applications WHERE application_id = ?', [n.entity_id]);
    if (!a) return gone;
    if (user.role === 'Donor' && a.applicant_id !== user.user_id) return gone;
  } else if (n.entity_type === 'transition_review') {
    const [[t]] = await pool.query('SELECT review_id FROM tbl_transition_reviews WHERE review_id = ?', [n.entity_id]);
    if (!t || user.role === 'Donor') return gone;
  }
  // Links only go to pages the role can open (Donor links start with /applications, /donations/history or /notifications).
  const link = String(n.link || '/notifications');
  if (user.role === 'Donor' && !/^\/(applications|donations\/history|notifications)/.test(link)) return gone;
  return { link };
}

// ---------------------------------------------------------------- preferences and retention

async function preferences(user) {
  const cats = (CATEGORIES[user.role] || []).filter((c) => !c.priority);
  const [rows] = await pool.query('SELECT category, enabled FROM tbl_notification_preferences WHERE user_id = ?', [user.user_id]);
  const set = Object.fromEntries(rows.map((r) => [r.category, !!r.enabled]));
  return cats.map((c) => ({ key: c.key, label: c.label, enabled: set[c.key] ?? true, always_on: critLabel(user.role, c.key) }));
}
function critLabel(role, key) {
  if (role === 'Admin' && key === 'security') return 'Security warnings are always sent.';
  if (role === 'Donor' && key === 'applications') return 'Documents requested and decisions are always sent.';
  if (role === 'Donor' && key === 'account') return 'Password and account changes are always sent.';
  return null;
}
async function setPreference(user, category, enabled) {
  if (!storedCategories(user.role).includes(category)) throw new HttpError(400, 'Unknown category.');
  await pool.query(
    'INSERT INTO tbl_notification_preferences (user_id, category, enabled) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE enabled = VALUES(enabled)',
    [user.user_id, category, enabled ? 1 : 0]);
}

async function retentionDays() {
  const [[r]] = await pool.query("SELECT setting_value FROM tbl_settings WHERE setting_key = 'notification_retention_days'");
  const n = Number(r?.setting_value);
  return Number.isInteger(n) && n >= 30 ? n : 90;
}
/** Read or dismissed notifications older than the retention period (all users). */
async function cleanupPreview() {
  const days = await retentionDays();
  const [[r]] = await pool.query('SELECT COUNT(*) AS n FROM tbl_notifications WHERE (is_read = TRUE OR dismissed_at IS NOT NULL) AND created_at < NOW() - INTERVAL ? DAY', [days]);
  return { days, count: Number(r.n) };
}
async function cleanupRun() {
  const days = await retentionDays();
  const [r] = await pool.query('DELETE FROM tbl_notifications WHERE (is_read = TRUE OR dismissed_at IS NOT NULL) AND created_at < NOW() - INTERVAL ? DAY', [days]);
  return { days, deleted: r.affectedRows };
}

/**
 * Low stock: when an item drops to or below its threshold, every Admin and Staff member gets (or has
 * updated) one grouped notification with the current number of low items.
 */
async function lowStock(conn) {
  const [[r]] = await conn.query('SELECT COUNT(*) AS n FROM tbl_inventory WHERE quantity <= min_threshold');
  const count = Number(r.n);
  if (!count) return;
  await toAdmins(conn, 'admin_low_stock', { params: { count }, groupKey: 'low_stock', mode: 'set' });
  await toStaff(conn, 'staff_low_stock', { params: { count }, groupKey: 'low_stock', mode: 'set' });
}

module.exports = {
  lowStock, emit, toAdmins, toStaff, adoptionStatus, list, counts, unreadCount, setRead, dismiss, markAllRead, markApplicationRead,
  unreadByApplication, open, preferences, setPreference, cleanupPreview, cleanupRun, retentionDays,
};
