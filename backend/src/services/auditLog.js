/**
 * The Activity log: one read-only view over tbl_activity_logs, tbl_health_data_access_logs and
 * tbl_unlock_events (UNION ALL; nothing is copied or edited). Category, record type and "how it
 * ended" are worked out from each entry's code with config/auditCategories.js.
 */
const { pool } = require('../config/db');
const HttpError = require('../utils/HttpError');
const C = require('../config/auditCategories');
const { DOCUMENTS, STAGE_DOCUMENTS } = require('../config/adoptionForm');

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const lit = (s) => `'${s}'`; // config prefixes are validated to [A-Z0-9_] at load

const likeAny = (col, prefixes) => `(${prefixes.map((p) => `${col} LIKE ${lit(`${p}%`)}`).join(' OR ')})`;

const CATEGORY_SQL = `CASE WHEN x.src IN ('health', 'unlock') THEN 'sensitive' ${C.RULES.map(([cat, codes]) => `WHEN ${likeAny('x.code', codes)} THEN ${lit(cat)}`).join(' ')} ELSE ${lit(C.DEFAULT_CATEGORY)} END`;

const TYPE_SQL = `CASE
  WHEN x.src = 'health' THEN 'health'
  WHEN x.src = 'unlock' THEN CASE x.rec_type WHEN 'adoption_application' THEN 'adoption' WHEN 'transition_review' THEN 'transition' ELSE 'health' END
  WHEN x.code LIKE 'VIEW_HEALTH_RECORD%' OR x.code LIKE 'UPDATE_HEALTH_RECORD%' OR x.code LIKE 'UPDATE_CASE_FILES%' THEN 'health'
  WHEN x.target LIKE 'Application #%' THEN 'adoption'
  WHEN x.target LIKE 'Transition review #%' THEN 'transition'
  WHEN x.target LIKE 'Child %' THEN 'child'
  WHEN x.target LIKE 'Donation #%' OR x.target LIKE 'Payment #%' THEN 'donation'
  WHEN x.target LIKE 'Inventory #%' THEN 'inventory'
  WHEN x.target LIKE 'User #%' THEN 'user'
  WHEN x.target LIKE 'Schedule #%' THEN 'schedule'
  ELSE NULL END`;

const ENDED_SQL = `CASE ${C.ENDED.map((e) => `WHEN ${likeAny('x.code', e.codes)} THEN ${lit(e.key)}`).join(' ')} ELSE NULL END`;

/**
 * The union. Date limits are applied inside each part so the indexes on the time columns are used.
 * reference = application reference, transition case number or child case number (never a name).
 */
function unionSql(from, to) {
  const d = (col) => `${from ? ` AND DATE(${col}) >= ?` : ''}${to ? ` AND DATE(${col}) <= ?` : ''}`;
  const params = [];
  const add = () => { if (from) params.push(from); if (to) params.push(to); };
  add(); add(); add();
  const sql = `
    SELECT 'activity' AS src, l.log_id AS id, l.timestamp AS at, l.user_id, l.user_role AS role, l.action_performed AS code, l.target_entity AS target,
           NULL AS detail, NULL AS purpose, l.device_type AS device, l.ip_address AS ip, NULL AS rec_type,
           COALESCE(a.application_id, trv.review_id, IF(l.target_entity LIKE 'Child %', SUBSTRING(l.target_entity, 7), NULL),
                    IF(l.target_entity REGEXP '^(Donation|Payment|Inventory|User|Schedule) #[0-9]+', CAST(SUBSTRING(l.target_entity, LOCATE('#', l.target_entity) + 1) AS UNSIGNED), NULL)) AS rec_id,
           COALESCE(a.reference_no, trv.child_id, IF(l.target_entity LIKE 'Child %', SUBSTRING(l.target_entity, 7), NULL)) AS reference
      FROM tbl_activity_logs l
      LEFT JOIN tbl_adoption_applications a ON l.target_entity LIKE 'Application #%' AND a.application_id = CAST(SUBSTRING(l.target_entity, 14) AS UNSIGNED)
      LEFT JOIN tbl_transition_reviews trv ON l.target_entity LIKE 'Transition review #%' AND trv.review_id = CAST(SUBSTRING(l.target_entity, 20) AS UNSIGNED)
     WHERE 1 = 1${d('l.timestamp')}
    UNION ALL
    SELECT 'health', h.log_id, h.created_at, h.user_id, NULL, CONCAT('HEALTH_', h.event), CONCAT('Child ', h.child_id),
           h.detail, NULL, NULL, h.ip_address, 'health', h.child_id, h.child_id
      FROM tbl_health_data_access_logs h WHERE 1 = 1${d('h.created_at')}
    UNION ALL
    SELECT 'unlock', e.event_id, e.created_at, e.user_id, e.user_role, CONCAT('UNLOCK_', UPPER(e.event)), NULL,
           e.detail, e.purpose, e.device_type, e.ip_address, e.record_type, e.record_id,
           COALESCE(a2.reference_no, trv2.child_id, IF(e.record_type IN ('health', 'child'), e.record_id, NULL))
      FROM tbl_unlock_events e
      LEFT JOIN tbl_adoption_applications a2 ON e.record_type = 'adoption_application' AND a2.application_id = e.record_id
      LEFT JOIN tbl_transition_reviews trv2 ON e.record_type = 'transition_review' AND trv2.review_id = e.record_id
     WHERE 1 = 1${d('e.created_at')}`;
  return { sql, params };
}

/** Validates the query and returns { from, to, where, params } for the outer query. */
function readFilters(q, { forCounts = false } = {}) {
  const from = q.from ? String(q.from) : '';
  const to = q.to ? String(q.to) : '';
  if (from && !DATE.test(from)) throw new HttpError(400, 'From must be a date (YYYY-MM-DD).');
  if (to && !DATE.test(to)) throw new HttpError(400, 'To must be a date (YYYY-MM-DD).');
  if (from && to && from > to) throw new HttpError(400, 'From must be on or before To.');
  const where = [];
  const params = [];
  if (forCounts) return { from, to, where, params };
  if (q.category) {
    if (!C.CATEGORIES.some((c) => c.key === q.category)) throw new HttpError(400, 'Unknown category.');
    where.push('y.category = ?'); params.push(q.category);
  }
  if (q.type) {
    if (!C.RECORD_TYPES.some((t) => t.key === q.type)) throw new HttpError(400, 'Unknown record type.');
    where.push('y.rtype = ?'); params.push(q.type);
  }
  if (q.ended) {
    if (q.category !== 'sensitive') throw new HttpError(400, '"How it ended" applies to Sensitive record access only.');
    if (!C.ENDED.some((e) => e.key === q.ended)) throw new HttpError(400, 'Unknown "how it ended" value.');
    where.push('y.ended = ?'); params.push(q.ended);
  }
  if (q.user_id) {
    const id = Number(q.user_id);
    if (!Number.isInteger(id) || id < 1) throw new HttpError(400, 'Unknown user.');
    where.push('y.user_id = ?'); params.push(id);
  }
  if (q.event) {
    const ev = C.EVENTS.find((e) => e.key === q.event);
    if (!ev) throw new HttpError(400, 'Unknown event.');
    where.push(likeAny('y.code', ev.codes));
  }
  if (q.q) {
    const s = String(q.q).trim().slice(0, 100);
    if (s) {
      const like = `%${s.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
      where.push('(y.reference LIKE ? OR y.user_name LIKE ?)'); params.push(like, like);
    }
  }
  return { from, to, where, params };
}

function outer(f) {
  const u = unionSql(f.from, f.to);
  const sql = `SELECT * FROM (
      SELECT x.*, us.full_name AS user_name, COALESCE(x.role, ur.role_name) AS user_role, ${CATEGORY_SQL} AS category, ${TYPE_SQL} AS rtype, ${ENDED_SQL} AS ended
        FROM (${u.sql}) x LEFT JOIN tbl_users us ON us.user_id = x.user_id LEFT JOIN tbl_roles ur ON ur.role_id = us.role_id
    ) y ${f.where.length ? `WHERE ${f.where.join(' AND ')}` : ''}`;
  return { sql, params: [...u.params, ...f.params] };
}

// ---------------------------------------------------------------- readable rows

const DOC_LABELS = Object.fromEntries([...Object.entries(DOCUMENTS), ...Object.entries(STAGE_DOCUMENTS)].map(([k, v]) => [k, v.label]));
const minutes = (s) => { const n = Math.round(Number(s) / 60); return `${n} minute${n === 1 ? '' : 's'}`; };
const ENDED_TEXT = {
  locked: 'Access ended: locked by the user', expired: 'Access ended: expired', revoked: 'Access ended: revoked by Admin',
  replaced: 'Access ended: replaced by a new token', auto: 'Access ended: revoked automatically', unknown: 'Access ended: reason unknown',
};

/** Detail text without names, emails, note text or token values; codes become friendly words. */
function readableDetail(r) {
  const parts = [];
  const inner = r.src === 'activity' ? (/\((.*)\)\s*$/.exec(r.code || '')?.[1] || '') : '';
  let text = r.src === 'activity' ? inner : String(r.detail || '');
  text = text
    .replace(/\.?\s*Note: .*/i, ', note added')
    .replace(/,?\s*session #\d+( of user #\d+)?/gi, '')
    .replace(/ADMIN_FULL_ACCESS/g, 'Admin full access')
    .replace(/\b(\d+)\s?s\b/g, (_, s) => minutes(s))
    .replace(/\b[a-z]+(?:_[a-z]+)+\b/g, (w) => DOC_LABELS[w] || w.replace(/_/g, ' '))
    .replace(/[^\s@]+@[^\s@]+\.[^\s@]+/g, '[email hidden]')
    .replace(/\b(computer|phone|tablet)\b,?\s?/gi, '')
    .replace(/,\s*$/, '').trim();
  // Status changes and similar are already in the label; keep the rest.
  if (text && !/->/.test(text) && !/^(included|locked|sensitive sections (included|locked))$/i.test(text)) parts.push(text);
  if (r.purpose) parts.push(`Purpose: ${r.purpose}`);
  if (r.ended) parts.push(ENDED_TEXT[r.ended]);
  return parts.join(' · ') || null;
}

const LINKS = {
  adoption: (id) => `/adoptions/${id}`, transition: (id) => `/transition-reviews/${id}`, child: (id) => `/children/${encodeURIComponent(id)}`,
  health: (id) => `/children/${encodeURIComponent(id)}`, donation: (id) => `/donations?donation=${id}`, inventory: () => '/inventory',
  user: () => '/users', schedule: () => '/schedules',
};
function recordOf(r) {
  if (!r.rtype || r.rec_id == null) return null;
  const label = r.reference
    || { donation: `Donation ${String(r.rec_id).padStart(6, '0')}`, inventory: `Item #${r.rec_id}`, user: `User #${r.rec_id}`, schedule: `Shift #${r.rec_id}` }[r.rtype]
    || null;
  if (!label) return null;
  // Payment entries point to the payment, not a donation: no link.
  const link = r.target && /^Payment #/.test(r.target) ? null : LINKS[r.rtype]?.(r.rec_id) || null;
  return { label, link };
}

function shape(r) {
  return {
    key: `${r.src}-${r.id}`, at: r.at, user_id: r.user_id, user_name: r.user_name, user_role: r.user_role, category: r.category,
    sensitive: r.category === 'sensitive', label: C.friendlyLabel(r.src, r.code), code: r.code, record_type: r.rtype,
    record: recordOf(r), device: r.device || null, detail: readableDetail(r), ended: r.ended,
  };
}

// ---------------------------------------------------------------- queries

async function list(q, { page, limit }) {
  const f = readFilters(q);
  const o = outer(f);
  const [[{ total }]] = await pool.query(`SELECT COUNT(*) AS total FROM (${o.sql}) z`, o.params);
  const totalPages = Math.max(1, Math.ceil(Number(total) / limit));
  const current = Math.min(page, totalPages);
  const [rows] = await pool.query(`${o.sql} ORDER BY y.at DESC, y.id DESC LIMIT ? OFFSET ?`, [...o.params, limit, (current - 1) * limit]);
  return { rows: rows.map(shape), pagination: { page: current, limit, total: Number(total), total_pages: totalPages } };
}

/** Entry counts per category for the selected date range (the Category dropdown). */
async function categoryCounts(q) {
  const f = readFilters(q, { forCounts: true });
  const o = outer(f);
  const [rows] = await pool.query(`SELECT y.category, COUNT(*) AS n FROM (${o.sql}) y GROUP BY y.category`, o.params);
  const out = { all: 0 };
  for (const c of C.CATEGORIES) out[c.key] = 0;
  for (const r of rows) { out[r.category] = Number(r.n); out.all += Number(r.n); }
  return out;
}

/** Users who appear in the log, with their role. */
async function users() {
  const [rows] = await pool.query(
    `SELECT u.user_id, u.full_name, r.role_name AS role FROM tbl_users u JOIN tbl_roles r ON r.role_id = u.role_id
      WHERE u.user_id IN (SELECT user_id FROM tbl_activity_logs UNION SELECT user_id FROM tbl_health_data_access_logs UNION SELECT user_id FROM tbl_unlock_events)
      ORDER BY u.full_name`);
  return rows;
}

/** All matching rows for the Excel export (capped). */
async function all(q, cap = 20000) {
  const o = outer(readFilters(q));
  const [rows] = await pool.query(`${o.sql} ORDER BY y.at DESC, y.id DESC LIMIT ?`, [...o.params, cap]);
  return rows.map(shape);
}

/** Readable summary of the filters (for export logs and report headers): values only, never names. */
function describeFilters(q) {
  const out = [];
  if (q.category) out.push(`category=${q.category}`);
  if (q.type) out.push(`type=${q.type}`);
  if (q.ended) out.push(`ended=${q.ended}`);
  if (q.user_id) out.push(`user=#${Number(q.user_id)}`);
  if (q.event) out.push(`event=${q.event}`);
  if (q.from) out.push(`from=${q.from}`);
  if (q.to) out.push(`to=${q.to}`);
  if (q.q) out.push('search');
  return out.join(', ') || 'no filters';
}

module.exports = { list, categoryCounts, users, all, describeFilters, readFilters };
