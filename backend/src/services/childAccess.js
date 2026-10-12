/**
 * THE policy for child records: one function decides what a viewer may see of a child, and every child
 * endpoint, file, search, list, report and notification goes through it (no screen has its own check).
 *
 *  - Admin: full access, no token; every view is logged. During a monitoring visit: read-only, selected records only.
 *  - Staff with the Children duty: Level 1 directory for every child; the Care card (setting: everyone with the
 *    duty, or only Staff on shift); Level 2 core record when assigned (primary, backup, temporary cover) or during
 *    their initial access as the registering Staff member; Level 3 only when assigned, through the existing unlock
 *    flow (purpose, QR token, 3-minute session), never through initial or emergency access.
 *  - Emergency access: the Care card plus a critical health summary for 30 minutes, nothing else.
 *
 * Rollout mode "log_only": the NEW limits (Care card and core record) are only recorded as "would be blocked" and
 * nothing is hidden yet; "enforce" applies them. Level 3, duties and Admin-only actions are always enforced.
 * Field levels: config/childRecordLevels.js, overridden by tbl_child_field_levels.
 */
const { pool, withTransaction } = require('../config/db');
const env = require('../config/env');
const HttpError = require('../utils/HttpError');
const { encrypt, decrypt } = require('../utils/crypto');
const { logActivity, logActivityWith, logSystemActivity } = require('../utils/audit');
const { localToday } = require('../utils/validate');
const L = require('../config/childRecordLevels');
const Notify = require('./notifications');

const DENIED = L.DENIED;
const ACTIVE_SQL = 'a.ended_at IS NULL AND a.starts_at <= NOW() AND (a.ends_at IS NULL OR a.ends_at > NOW())';
const Assign = () => require('./assignment');
const ADM = require('../config/admission');

// ---------------------------------------------------------------- settings and field levels (cached briefly)
let cache = { at: 0, settings: null, levels: null };
function invalidate() { cache = { at: 0, settings: null, levels: null }; }

async function load(conn = pool) {
  if (cache.settings && Date.now() - cache.at < 15000) return cache;
  const keys = Object.keys(L.SETTINGS);
  const [rows] = await conn.query('SELECT setting_key, setting_value FROM tbl_settings WHERE setting_key IN (?)', [keys]);
  const raw = Object.fromEntries(rows.map((r) => [r.setting_key, r.setting_value]));
  const settings = {};
  for (const [k, def] of Object.entries(L.SETTINGS)) {
    const v = raw[k];
    if (def.options) settings[k] = def.options.includes(v) ? v : def.def;
    else if (typeof def.def === 'number') settings[k] = Number.isFinite(Number(v)) && v !== '' && v !== undefined ? Math.min(def.max, Math.max(def.min, Number(v))) : def.def;
    else settings[k] = v ?? def.def;
  }
  let levels = { ...L.FIELDS };
  try {
    const [lv] = await conn.query('SELECT field_key, level FROM tbl_child_field_levels');
    for (const r of lv) if (L.LEVELS.includes(r.level)) levels[r.field_key] = r.level;
  } catch { /* table missing before migration 032: the file is used */ }
  cache = { at: Date.now(), settings, levels };
  return cache;
}
const settings = async (conn) => (await load(conn)).settings;

/** Which field a tbl_children column belongs to (unknown columns count as core: the safe default). */
const COLUMN_FIELD = {
  child_id: 'child_id', status: 'status', created_at: 'created_at', updated_at: 'updated_at', assigned_staff_id: 'case_worker', assigned_staff_name: 'case_worker',
  has_photo: 'photo', profile_photo_url: 'photo', cdclaa_number: 'cdclaa', cdclaa_date: 'cdclaa', cdclaa_verified_at: 'cdclaa',
  transition_status: 'transition_flag', transition_review_id: 'transition_flag',
};
const fieldOf = (col) => COLUMN_FIELD[col] || col;

// ---------------------------------------------------------------- viewer context (loaded once per request)
const displayName = (row) => (row?.first_name ? `${row.first_name} ${String(row.last_name || '').charAt(0).toUpperCase()}.` : row?.child_id);

/** Is the user on a shift right now (Staff schedules)? Overnight shifts count until they end. */
async function onShift(conn, userId) {
  const today = localToday();
  const d = new Date(); d.setDate(d.getDate() - 1);
  const yesterday = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const [rows] = await conn.query('SELECT shift_date, start_time, end_time FROM tbl_staff_schedules WHERE user_id = ? AND shift_date IN (?, ?)', [userId, today, yesterday]);
  const now = new Date();
  const hm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:00`;
  const day = (v) => (v instanceof Date ? `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, '0')}-${String(v.getDate()).padStart(2, '0')}` : String(v).slice(0, 10));
  return rows.some((r) => {
    const s = String(r.start_time).slice(0, 8); const e = String(r.end_time).slice(0, 8);
    if (day(r.shift_date) === today) return s <= e ? hm >= s && hm < e : hm >= s;
    return s > e && hm < e; // yesterday's overnight shift
  });
}

/** The Admin's monitoring visit in this sign-in, if one is running (an expired one is ended here). */
async function monitoringOf(req, conn = pool) {
  if (req.user?.role !== 'Admin') return null;
  if (req._monitoring !== undefined) return req._monitoring;
  const [[m]] = await conn.query(
    `SELECT m.monitoring_id, m.reviewer_name, m.reviewer_org, m.started_at, m.expires_at, (m.expires_at <= NOW()) AS expired
       FROM tbl_monitoring_sessions m WHERE m.admin_id = ? AND m.ended_at IS NULL AND (m.session_jti = ? OR m.session_jti IS NULL)
      ORDER BY m.monitoring_id DESC LIMIT 1`, [req.user.user_id, req.auth?.jti || null]).catch(() => [[null]]);
  if (!m) { req._monitoring = null; return null; }
  if (m.expired) {
    await endMonitoring(req, m.monitoring_id, 'expired', conn);
    req._monitoring = null;
    return null;
  }
  const [recs] = await conn.query('SELECT child_id FROM tbl_monitoring_records WHERE monitoring_id = ?', [m.monitoring_id]);
  req._monitoring = { ...m, expired: undefined, child_ids: recs.map((r) => r.child_id), admin_name: req.user.full_name };
  return req._monitoring;
}

/**
 * Everything the policy needs about the viewer, for some children (ids) or all (null), in a few queries.
 * Used by the list (many rows) and by decide() (one child).
 */
async function viewerContext(req, ids = null, conn = pool) {
  const { settings: s } = await load(conn);
  const u = req.user;
  const ctx = { user: u, role: u.role, mode: s.child_access_mode, enforced: s.child_access_mode === 'enforce', settings: s,
    assigned: new Map(), initial: new Map(), emergency: new Map(), onShift: false, monitoring: null };
  if (u.role === 'Admin') { ctx.monitoring = await monitoringOf(req, conn); return ctx; }
  if (u.role !== 'Staff' || (ids && !ids.length)) return ctx;
  const only = ids ? ' AND a.record_id IN (?)' : '';
  const args = ids ? [ids.map(String)] : [];
  const [asg] = await conn.query(
    `SELECT a.record_id, a.assignment_type, a.ends_at FROM tbl_record_assignments a
      WHERE a.record_type = 'child' AND a.user_id = ? AND ${ACTIVE_SQL}${only}`, [u.user_id, ...args]);
  for (const r of asg) if (!ctx.assigned.has(r.record_id) || r.assignment_type === 'primary') ctx.assigned.set(r.record_id, { type: r.assignment_type, ends_at: r.ends_at });
  // Children not converted yet: the old case worker field still counts.
  const [legacy] = await conn.query(
    `SELECT c.child_id FROM tbl_children c WHERE c.assigned_staff_id = ?${ids ? ' AND c.child_id IN (?)' : ''}
       AND NOT EXISTS (SELECT 1 FROM tbl_record_assignments a2 WHERE a2.record_type = 'child' AND a2.record_id = c.child_id)`, [u.user_id, ...args]);
  for (const r of legacy) if (!ctx.assigned.has(r.child_id)) ctx.assigned.set(r.child_id, { type: 'primary', ends_at: null, legacy: true });
  if (!(u.duties || []).includes('children')) return ctx; // assignments still count for level 3 (e.g. Transition Review)
  const [ini] = await conn.query(
    `SELECT child_id, ends_at, (ends_at <= NOW()) AS expired FROM tbl_child_initial_access WHERE user_id = ? AND ended_at IS NULL${ids ? ' AND child_id IN (?)' : ''}`, [u.user_id, ...args]);
  for (const r of ini) {
    if (Number(r.expired)) await endInitialAccess(conn, null, r.child_id, 'expired');
    else ctx.initial.set(r.child_id, { ends_at: r.ends_at });
  }
  const [em] = await conn.query(
    `SELECT emergency_id, child_id, expires_at, reason FROM tbl_emergency_access WHERE user_id = ? AND ended_at IS NULL AND expires_at > NOW()${ids ? ' AND child_id IN (?)' : ''}`, [u.user_id, ...args]);
  for (const r of em) ctx.emergency.set(r.child_id, { emergency_id: r.emergency_id, expires_at: r.expires_at, reason: r.reason });
  ctx.onShift = s.child_care_card_visibility === 'on_shift' ? await onShift(conn, u.user_id) : true;
  return ctx;
}

/** The decision for one child row (pure: uses only the context). */
function decideFor(ctx, child) {
  const id = String(child.child_id);
  const d = { child_id: id, role: ctx.role, mode: ctx.mode, enforced: ctx.enforced, level: 'none', label: 'No access', chip: null,
    directory: false, care_card: false, core: false, sensitive_assigned: false, edit_care_card: false, edit_photo: false, access_tab: false,
    assignment: null, initial: null, emergency: null, monitoring: null, read_only: false };
  if (ctx.role === 'Admin') {
    if (ctx.monitoring) {
      d.monitoring = { monitoring_id: ctx.monitoring.monitoring_id };
      if (!ctx.monitoring.child_ids.includes(id)) return { ...d, reason: 'monitoring' };
      return { ...d, level: 'full', label: 'Full (monitoring visit, read-only)', chip: 'full', directory: true, care_card: true, core: true, sensitive_assigned: true, access_tab: true, read_only: true };
    }
    return { ...d, level: 'full', label: 'Full', chip: 'full', directory: true, care_card: true, core: true, sensitive_assigned: true, edit_care_card: true, edit_photo: true, access_tab: true };
  }
  if (ctx.role !== 'Staff') return d;
  // Not admitted yet (migration 033): only Admin and the staff member who created the admission (Admission duty)
  // while it is open. Nobody else sees it, in either rollout mode; the creator never gets level 3.
  if (child.status === ADM.CHILD_STATUS) {
    const mine = Number(child.admission_created_by) === Number(ctx.user.user_id) && (ctx.user.duties || []).includes('admission')
      && ADM.OPEN.includes(child.admission_status);
    if (!mine) return { ...d, admission: true, reason: 'admission' };
    const editable = ADM.EDITABLE.includes(child.admission_status);
    return { ...d, admission: true, admission_creator: true, admission_editable: editable, level: 'core', chip: 'admission',
      label: 'Admission you created (ends when an Admin decides)', directory: true, core: true, edit_photo: editable };
  }
  const a = ctx.assigned.get(id) || null;
  if (!(ctx.user.duties || []).includes('children')) return { ...d, sensitive_assigned: Boolean(a), assignment: a }; // level 3 only, through the unlock flow
  const i = ctx.initial.get(id) || null;
  const e = null; // emergency access was removed: an earlier session no longer opens anything
  d.directory = true;
  d.assignment = a; d.initial = i; d.emergency = e;
  d.core = Boolean(a || i);
  d.care_card = Boolean(ctx.settings.child_care_card_visibility === 'children_duty' || ctx.onShift || a || i || e);
  d.sensitive_assigned = Boolean(a);
  d.edit_care_card = Boolean(a);
  d.edit_photo = Boolean(a || i);
  d.access_tab = Boolean(a);
  if (a) Object.assign(d, { level: 'core', label: 'Core record (unlock for health, adoption and transition)', chip: 'unlock' });
  else if (i) Object.assign(d, { level: 'core', label: 'Core record (temporary, as the registering staff member)', chip: 'temporary' });
  else Object.assign(d, { level: 'directory', label: 'Directory', chip: 'directory' });
  return d;
}

async function childRow(conn, childId) {
  const [[c]] = await conn.query(
    `SELECT c.child_id, c.first_name, c.last_name, c.status, c.assigned_staff_id, c.admission_status, adm.created_by AS admission_created_by
       FROM tbl_children c LEFT JOIN tbl_child_admissions adm ON adm.child_id = c.child_id WHERE c.child_id = ?`, [String(childId)]);
  if (!c) throw new HttpError(404, 'Child record not found.');
  return c;
}

/** The policy decision for one child. */
async function decide(req, childId, conn = pool) {
  const child = await childRow(conn, childId);
  const ctx = await viewerContext(req, [child.child_id], conn);
  return { ...decideFor(ctx, child), child, ctx };
}

const NEED = {
  directory: (d) => d.directory,
  care_card: (d) => d.care_card,
  core: (d) => d.core,
  sensitive: (d) => d.role === 'Admin' ? d.directory : d.sensitive_assigned,
  edit_care_card: (d) => d.edit_care_card,
  edit_photo: (d) => d.edit_photo,
  access_tab: (d) => d.access_tab,
  admin: (d) => d.role === 'Admin' && d.directory,
};
/** Limits that are new in this release: only recorded while the rollout mode is "Log only". */
const SHADOWED = ['care_card', 'core', 'edit_photo'];

async function shadow(conn, userId, childIds, level, action) {
  if (!childIds.length) return;
  const day = localToday();
  const values = childIds.map(() => '(?, ?, ?, ?, 1, ?, NOW())').join(', ');
  await conn.query(
    `INSERT INTO tbl_child_access_shadow (user_id, child_id, level, day, hits, last_action, last_at) VALUES ${values}
     ON DUPLICATE KEY UPDATE hits = hits + 1, last_action = VALUES(last_action), last_at = NOW()`,
    childIds.flatMap((id) => [userId, String(id), level, day, String(action || '').slice(0, 80)])).catch((e) => console.error('[child-access shadow]', e.message));
}

async function logDenied(req, childId, need, action) {
  await logActivity(req, `CRA_ACCESS_DENIED (${need}, ${action})`, `Child ${childId}`);
}

/**
 * THE gate. Every child endpoint calls check(req, childId, need, action) before reading or writing anything.
 * Returns the decision; refuses with "ACCESS DENIED" (logged) when the level isn't met. In "Log only" mode the
 * new limits are recorded as "would be blocked" and allowed.
 */
async function check(req, childId, need, action, conn = pool) {
  const d = await decide(req, childId, conn);
  if (d.monitoring && !d.directory) {
    await logDenied(req, d.child_id, 'monitoring', action);
    throw new HttpError(403, 'Only the records selected for this monitoring visit can be opened.', { monitoring: true });
  }
  if (NEED[need](d)) return { ...d, allowed: true };
  if (SHADOWED.includes(need) && !d.enforced && d.directory && !d.admission) {
    await shadow(conn, req.user.user_id, [d.child_id], need, action);
    return { ...d, allowed: true, shadow: true };
  }
  await logDenied(req, d.child_id, need, action);
  throw new HttpError(403, DENIED, { locked: need });
}

/** Level 3 for Staff: assigned AND a live unlock session for the child (the existing flow). Admin: always. */
async function sensitiveAccess(req, childId) {
  const d = await check(req, childId, 'sensitive', 'open level 3');
  if (req.user.role === 'Admin') return { unlocked: true, admin: true, decision: d };
  const s = await require('./unlockService').sessionFor(req, 'health', d.child_id);
  return { unlocked: Boolean(s), expires_at: s?.expires_at || null, remaining_seconds: s?.remaining_seconds || 0, purpose: s?.purpose || null, decision: d };
}

/** Is the user assigned to this record? (adoption application, transition review: its own OR the child's assignment) */
async function isAssigned(req, recordType, recordId, conn = pool) {
  if (req.user.role === 'Admin') return true;
  const A = Assign();
  if (recordType === 'health' || recordType === 'child') return Boolean(await A.assignmentOf(conn, 'child', recordId, req.user.user_id));
  if (await A.assignmentOf(conn, recordType, recordId, req.user.user_id)) return true;
  if (recordType === 'transition_review') {
    const [[r]] = await conn.query('SELECT child_id FROM tbl_transition_reviews WHERE review_id = ?', [recordId]);
    if (r) return Boolean(await A.assignmentOf(conn, 'child', r.child_id, req.user.user_id));
  }
  return false;
}

// ---------------------------------------------------------------- shaping (the server never sends a locked field)
function allowedLevels(d) {
  const lax = !d.enforced && d.directory && d.role === 'Staff' && !d.admission;
  return { directory: d.directory, care_card: d.care_card || lax, core: d.core || lax, sensitive: false };
}

/** A child row as this viewer may see it, plus its access chip. Returns [row, shadowLevels]. */
function shapeRow(row, d, levels) {
  const ok = allowedLevels(d);
  const out = {};
  const shadows = new Set();
  for (const [col, val] of Object.entries(row)) {
    const lvl = levels[fieldOf(col)] || 'core';
    if (lvl === 'sensitive') continue;
    if (!ok[lvl]) continue;
    if (lvl === 'core' && !d.core) shadows.add('core');
    if (lvl === 'care_card' && !d.care_card) shadows.add('care_card');
    out[col] = val;
  }
  out.child_id = row.child_id;
  out.display_name = d.role === 'Admin' || !row.first_name ? (row.full_name || displayName(row)) : displayName(row);
  if (!ok.core) { delete out.first_name; delete out.last_name; delete out.full_name; }
  if (d.role === 'Staff') out.full_name = ok.core ? row.full_name : undefined;
  // Who is assigned to a child is Admin information. Staff only learn that they themselves are assigned.
  if (d.role === 'Admin') out.case_worker = row.assigned_staff_id && row.assigned_staff_name ? { user_id: row.assigned_staff_id, name: row.assigned_staff_name } : null;
  else out.case_worker = d.assignment ? { you: true, type: d.assignment.type } : null;
  delete out.assigned_staff_name;
  if (d.role !== 'Admin') delete out.assigned_staff_id;
  out.access = { level: d.level, label: d.label, chip: d.chip, care_card: d.care_card, core: d.core, mode: d.mode, enforced: d.enforced,
    would_be_blocked: [...shadows] };
  return [out, [...shadows]];
}

/** Shapes many rows for a list and records "would be blocked" in one write per level. */
async function shapeList(req, rows, conn = pool) {
  const { levels } = await load(conn);
  const ctx = await viewerContext(req, rows.map((r) => r.child_id), conn);
  const shadows = { core: [], care_card: [] };
  const out = rows.map((r) => {
    const [row, sh] = shapeRow(r, decideFor(ctx, r), levels);
    for (const l of sh) shadows[l].push(r.child_id);
    return row;
  });
  if (req.user.role === 'Staff') for (const [lvl, ids] of Object.entries(shadows)) await shadow(conn, req.user.user_id, ids, lvl, 'children list');
  return out;
}

async function shapeOne(req, row, d, conn = pool) {
  const { levels } = await load(conn);
  const [out, sh] = shapeRow(row, d, levels);
  if (req.user.role === 'Staff') for (const l of sh) await shadow(conn, req.user.user_id, [row.child_id], l, 'child page');
  return out;
}

/** Name of a child for this viewer: full name with core access, otherwise first name and last initial. */
async function nameFor(req, row, conn = pool) {
  if (req.user.role === 'Admin') return row.full_name || displayName(row);
  const ctx = await viewerContext(req, [row.child_id], conn);
  const d = decideFor(ctx, row);
  return d.core || (!d.enforced && d.directory) ? (row.full_name || displayName(row)) : displayName(row);
}

// ---------------------------------------------------------------- initial access (registering Staff member)
async function grantInitialAccess(conn, req, childId) {
  const s = await settings(conn);
  await conn.query(
    `INSERT INTO tbl_child_initial_access (child_id, user_id, starts_at, ends_at) VALUES (?, ?, NOW(), NOW() + INTERVAL ? DAY)`,
    [childId, req.user.user_id, s.child_initial_access_days]);
  const [[r]] = await conn.query('SELECT ends_at FROM tbl_child_initial_access WHERE child_id = ?', [childId]);
  await logActivityWith(conn, req, `CRA_INITIAL_ACCESS_GRANTED (${s.child_initial_access_days} days)`, `Child ${childId}`);
  return r.ends_at;
}

/** Ends the registering Staff member's initial access (expired, intake complete, another case worker assigned). */
async function endInitialAccess(conn, req, childId, reason, newCaseWorkerId = null) {
  const [[r]] = await conn.query('SELECT user_id FROM tbl_child_initial_access WHERE child_id = ? AND ended_at IS NULL', [String(childId)]);
  if (!r) return false;
  if (reason === 'case_worker_assigned' && newCaseWorkerId === r.user_id) return false; // they became the case worker
  await conn.query('UPDATE tbl_child_initial_access SET ended_at = NOW(), end_reason = ? WHERE child_id = ? AND ended_at IS NULL', [reason, String(childId)]);
  const code = `CRA_INITIAL_ACCESS_ENDED (${reason})`;
  if (req?.user) await logActivityWith(conn, req, code, `Child ${childId}`);
  else await logSystemActivity(conn, r.user_id, `${code} [automatic]`, `Child ${childId}`);
  return true;
}

async function intakeComplete(req, childId) {
  return withTransaction(async (conn) => {
    const [[r]] = await conn.query('SELECT user_id FROM tbl_child_initial_access WHERE child_id = ? AND ended_at IS NULL FOR UPDATE', [String(childId)]);
    if (!r || r.user_id !== req.user.user_id) throw new HttpError(409, 'You have no temporary access to this record.');
    await endInitialAccess(conn, req, childId, 'intake_complete');
  });
}

// ---------------------------------------------------------------- duplicate check
const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z\s-]/g, '').replace(/[\s-]+/g, ' ').trim();
const DUP_MESSAGE = 'A matching record may exist. Ask the case worker or an Admin.';
const DUP_LIMIT = 10; const DUP_WINDOW_MIN = 15;

/** Possible duplicates by normalized name and date of birth. Rate-limited per user and logged. */
async function duplicateCheck(req, { first_name: first, last_name: last, dob }, { conn = pool, countAgainstLimit = true } = {}) {
  if (!first || !last || !/^\d{4}-\d{2}-\d{2}$/.test(String(dob || ''))) return { possible_match: false };
  if (countAgainstLimit) {
    const [[n]] = await conn.query(
      "SELECT COUNT(*) AS n FROM tbl_activity_logs WHERE user_id = ? AND action_performed LIKE 'CRA_DUPLICATE_CHECK%' AND `timestamp` > NOW() - INTERVAL ? MINUTE",
      [req.user.user_id, DUP_WINDOW_MIN]);
    if (Number(n.n) >= DUP_LIMIT) {
      await logActivity(req, 'CRA_DUPLICATE_CHECK_LIMITED', 'Children');
      throw new HttpError(429, `Too many duplicate checks. Wait ${DUP_WINDOW_MIN} minutes and try again.`);
    }
  }
  const [rows] = await conn.query('SELECT child_id, first_name, last_name, full_name, dob, status FROM tbl_children WHERE dob = ?', [String(dob)]);
  const f = norm(first); const l = norm(last);
  const hits = rows.filter((r) => norm(r.last_name) === l && (norm(r.first_name) === f || norm(r.first_name).startsWith(f) || f.startsWith(norm(r.first_name))));
  await logActivity(req, `CRA_DUPLICATE_CHECK (${hits.length ? 'possible match' : 'no match'})`, 'Children');
  if (!hits.length) return { possible_match: false };
  if (req.user.role !== 'Admin') return { possible_match: true, message: DUP_MESSAGE };
  return { possible_match: true, message: DUP_MESSAGE, matches: hits.map((r) => ({ child_id: r.child_id, full_name: r.full_name, dob: r.dob, status: r.status })) };
}

// ---------------------------------------------------------------- Care card
const CARE_FIELDS = ['allergies', 'dietary', 'daily_medications', 'emergency_contact', 'routine_notes', 'special_needs'];

async function careCard(childId, conn = pool) {
  const [[r]] = await conn.query(
    `SELECT cc.*, rb.full_name AS last_reviewed_by_name, ub.full_name AS updated_by_name FROM tbl_care_cards cc
       LEFT JOIN tbl_users rb ON rb.user_id = cc.last_reviewed_by LEFT JOIN tbl_users ub ON ub.user_id = cc.updated_by WHERE cc.child_id = ?`, [String(childId)]);
  const s = await settings(conn);
  const out = { child_id: String(childId), exists: Boolean(r), review_days: s.child_care_card_review_days };
  for (const f of CARE_FIELDS) out[f] = r ? decrypt(r[`${f}_enc`], env.phiKey) : null;
  out.last_reviewed_at = r?.last_reviewed_at || null;
  out.last_reviewed_by_name = r?.last_reviewed_by_name || null;
  out.updated_at = r?.updated_at || null;
  out.updated_by_name = r?.updated_by_name || null;
  const due = !r?.last_reviewed_at || (Date.now() - new Date(r.last_reviewed_at).getTime()) / 86400000 >= s.child_care_card_review_days;
  out.review_due = due;
  return out;
}

async function saveCareCard(req, childId, body) {
  const vals = CARE_FIELDS.map((f) => {
    const v = body?.[f] === undefined || body?.[f] === null ? '' : String(body[f]).trim();
    if (v.length > 2000) throw new HttpError(422, 'Each Care card field can be up to 2000 characters.', { errors: { [f]: 'Up to 2000 characters.' } });
    return v ? encrypt(v, env.phiKey) : null;
  });
  await withTransaction(async (conn) => {
    await conn.query(
      `INSERT INTO tbl_care_cards (child_id, ${CARE_FIELDS.map((f) => `${f}_enc`).join(', ')}, updated_at, updated_by, last_reviewed_at, last_reviewed_by)
       VALUES (?, ${CARE_FIELDS.map(() => '?').join(', ')}, NOW(), ?, NOW(), ?)
       ON DUPLICATE KEY UPDATE ${CARE_FIELDS.map((f) => `${f}_enc = VALUES(${f}_enc)`).join(', ')}, updated_at = NOW(), updated_by = VALUES(updated_by),
         last_reviewed_at = NOW(), last_reviewed_by = VALUES(last_reviewed_by), review_reminded_at = NULL`,
      [String(childId), ...vals, req.user.user_id, req.user.user_id]);
    await logActivityWith(conn, req, 'CRA_CARE_CARD_UPDATED', `Child ${childId}`);
  });
  return careCard(childId);
}

async function reviewCareCard(req, childId) {
  await withTransaction(async (conn) => {
    await conn.query(
      `INSERT INTO tbl_care_cards (child_id, last_reviewed_at, last_reviewed_by) VALUES (?, NOW(), ?)
       ON DUPLICATE KEY UPDATE last_reviewed_at = NOW(), last_reviewed_by = VALUES(last_reviewed_by), review_reminded_at = NULL`, [String(childId), req.user.user_id]);
    await logActivityWith(conn, req, 'CRA_CARE_CARD_REVIEWED', `Child ${childId}`);
  });
  return careCard(childId);
}

// ---------------------------------------------------------------- emergency access (break-glass)
/** Care card + critical health summary (allergies, medications, emergency contact). Nothing else. */
async function emergencySummary(childId, conn = pool) {
  const card = await careCard(childId, conn);
  const [[h]] = await conn.query('SELECT allergies, prescriptions FROM tbl_health_history WHERE child_id = ?', [String(childId)]);
  return {
    care_card: card,
    critical: {
      allergies: [card.allergies, h ? decrypt(h.allergies, env.phiKey) : null].filter(Boolean).join('\n') || null,
      medications: [card.daily_medications, h ? decrypt(h.prescriptions, env.phiKey) : null].filter(Boolean).join('\n') || null,
      emergency_contact: card.emergency_contact || null,
    },
  };
}

async function caseWorkerIds(conn, childId) {
  return (await Assign().active(conn, 'child', childId)).filter((a) => a.is_active).map((a) => a.user_id);
}

async function startEmergency(req, childId, body) {
  if (req.user.role !== 'Staff') throw new HttpError(400, 'Administrators have full access and do not need emergency access.');
  const d = await check(req, childId, 'directory', 'emergency access');
  const reason = String(body?.reason || '');
  const note = String(body?.note || '').trim();
  if (!L.EMERGENCY_REASONS.includes(reason)) throw new HttpError(422, 'Choose the reason.', { errors: { reason: 'Choose the reason.' } });
  if (reason === 'Other' && note.length < 5) throw new HttpError(422, 'Describe the emergency (at least 5 characters).', { errors: { note: 'Describe the emergency (at least 5 characters).' } });
  if (note.length > 500) throw new HttpError(422, 'The note can be up to 500 characters.', { errors: { note: 'Up to 500 characters.' } });
  const s = await settings();
  const id = await withTransaction(async (conn) => {
    const [[open]] = await conn.query('SELECT emergency_id FROM tbl_emergency_access WHERE child_id = ? AND user_id = ? AND ended_at IS NULL AND expires_at > NOW()', [d.child_id, req.user.user_id]);
    if (open) return open.emergency_id;
    const [[used]] = await conn.query('SELECT COUNT(*) AS n FROM tbl_emergency_access WHERE user_id = ? AND started_at >= CURDATE()', [req.user.user_id]);
    if (Number(used.n) >= s.child_emergency_uses_per_day) {
      await logActivityWith(conn, req, `CRA_EMERGENCY_ACCESS_LIMIT (${used.n} used today, limit ${s.child_emergency_uses_per_day})`, `Child ${d.child_id}`);
      await Notify.toAdmins(conn, 'admin_emergency_limit', { params: { limit: s.child_emergency_uses_per_day }, groupKey: `emergency_limit:${req.user.user_id}:${localToday()}` });
      return { limited: true };
    }
    const [ins] = await conn.query('INSERT INTO tbl_emergency_access (child_id, user_id, reason, note_enc, started_at, expires_at) VALUES (?, ?, ?, ?, NOW(), NOW() + INTERVAL ? MINUTE)',
      [d.child_id, req.user.user_id, reason, note ? encrypt(note, env.phiKey) : null, s.child_emergency_minutes]);
    await logActivityWith(conn, req, `CRA_EMERGENCY_ACCESS_STARTED (${reason}, ${s.child_emergency_minutes} min)`, `Child ${d.child_id}`);
    for (const uid of await caseWorkerIds(conn, d.child_id)) {
      if (uid !== req.user.user_id) await Notify.emit(conn, 'case_worker_emergency_access', { userId: uid, params: { ref: d.child_id, id: d.child_id }, entityType: 'child', entityId: d.child_id, groupKey: `emergency:${ins.insertId}:cw:${uid}` });
    }
    await Notify.toAdmins(conn, 'admin_emergency_access', { params: { ref: d.child_id, reason }, groupKey: `emergency:${ins.insertId}` });
    return ins.insertId;
  });
  if (id?.limited) throw new HttpError(429, `You have used emergency access ${s.child_emergency_uses_per_day} times today. Ask an Admin or the case worker.`);
  return currentEmergency(req, d.child_id);
}

async function currentEmergency(req, childId) {
  const [[e]] = await pool.query(
    `SELECT emergency_id, reason, started_at, expires_at, TIMESTAMPDIFF(SECOND, NOW(), expires_at) AS remaining FROM tbl_emergency_access
      WHERE child_id = ? AND user_id = ? AND ended_at IS NULL AND expires_at > NOW() ORDER BY emergency_id DESC LIMIT 1`, [String(childId), req.user.user_id]);
  if (!e) throw new HttpError(403, DENIED, { emergency: false });
  await logActivity(req, 'CRA_EMERGENCY_ACCESS_VIEWED', `Child ${childId}`);
  return { emergency_id: e.emergency_id, reason: e.reason, started_at: e.started_at, expires_at: e.expires_at, remaining_seconds: Math.max(0, Number(e.remaining)),
    ...(await emergencySummary(childId)) };
}

async function endEmergency(req, childId) {
  const [r] = await pool.query('UPDATE tbl_emergency_access SET ended_at = NOW() WHERE child_id = ? AND user_id = ? AND ended_at IS NULL', [String(childId), req.user.user_id]);
  if (r.affectedRows) await logActivity(req, 'CRA_EMERGENCY_ACCESS_ENDED (closed)', `Child ${childId}`);
}

async function emergencyList({ pending = false, childId = null } = {}, conn = pool) {
  const where = [];
  const args = [];
  if (pending) where.push('e.result IS NULL');
  if (childId) { where.push('e.child_id = ?'); args.push(String(childId)); }
  const [rows] = await conn.query(
    `SELECT e.emergency_id, e.child_id, e.user_id, u.full_name AS user_name, e.reason, e.note_enc, e.started_at, e.expires_at, e.ended_at,
            e.result, e.review_note, e.reviewed_at, rb.full_name AS reviewed_by_name
       FROM tbl_emergency_access e JOIN tbl_users u ON u.user_id = e.user_id LEFT JOIN tbl_users rb ON rb.user_id = e.reviewed_by
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY e.started_at DESC LIMIT 200`, args);
  return rows.map(({ note_enc: n, ...r }) => ({ ...r, note: n ? decrypt(n, env.phiKey) : null, active: !r.ended_at && new Date(r.expires_at) > new Date() }));
}

async function reviewEmergency(req, emergencyId, body) {
  const result = String(body?.result || '');
  const note = String(body?.note || '').trim();
  const errors = {};
  if (!['Justified', 'Not justified'].includes(result)) errors.result = 'Choose Justified or Not justified.';
  if (note.length < 3) errors.note = 'Add a note (at least 3 characters).';
  if (note.length > 500) errors.note = 'Up to 500 characters.';
  if (Object.keys(errors).length) throw new HttpError(422, Object.values(errors)[0], { errors });
  await withTransaction(async (conn) => {
    const [[e]] = await conn.query('SELECT * FROM tbl_emergency_access WHERE emergency_id = ? FOR UPDATE', [emergencyId]);
    if (!e) throw new HttpError(404, 'Emergency access not found.');
    if (e.result) throw new HttpError(409, 'This emergency access was already reviewed.');
    await conn.query('UPDATE tbl_emergency_access SET result = ?, review_note = ?, reviewed_by = ?, reviewed_at = NOW() WHERE emergency_id = ?', [result, note, req.user.user_id, emergencyId]);
    // "Not justified" is its own code so it stands out (flagged) in the Audit log.
    await logActivityWith(conn, req, result === 'Justified' ? `CRA_EMERGENCY_ACCESS_REVIEWED (Justified, #${emergencyId})` : `CRA_EMERGENCY_NOT_JUSTIFIED (flagged, #${emergencyId}, user #${e.user_id})`, `Child ${e.child_id}`);
  });
}

// ---------------------------------------------------------------- access requests
async function requestAccess(req, childId, body) {
  if (req.user.role !== 'Staff') throw new HttpError(400, 'Administrators already have full access.');
  const d = await check(req, childId, 'directory', 'request access');
  if (d.core) throw new HttpError(409, 'You already have access to this record.');
  const reason = String(body?.reason || '').trim();
  if (reason.length < 10) throw new HttpError(422, 'Explain why you need access (at least 10 characters).', { errors: { reason: 'At least 10 characters.' } });
  if (reason.length > 1000) throw new HttpError(422, 'Up to 1000 characters.', { errors: { reason: 'Up to 1000 characters.' } });
  return withTransaction(async (conn) => {
    const [[open]] = await conn.query("SELECT request_id FROM tbl_child_access_requests WHERE child_id = ? AND requested_by = ? AND status = 'Pending'", [d.child_id, req.user.user_id]);
    if (open) throw new HttpError(409, 'Your request is already waiting for an Admin.');
    const [ins] = await conn.query('INSERT INTO tbl_child_access_requests (child_id, requested_by, reason_enc) VALUES (?, ?, ?)', [d.child_id, req.user.user_id, encrypt(reason, env.phiKey)]);
    await logActivityWith(conn, req, `CRA_ACCESS_REQUESTED (#${ins.insertId})`, `Child ${d.child_id}`);
    await Notify.toAdmins(conn, 'admin_access_requested', { params: { ref: d.child_id, id: d.child_id }, entityType: 'child', entityId: d.child_id, groupKey: `access_request:${ins.insertId}` });
    for (const uid of await caseWorkerIds(conn, d.child_id)) {
      await Notify.emit(conn, 'case_worker_access_requested', { userId: uid, params: { ref: d.child_id, id: d.child_id }, entityType: 'child', entityId: d.child_id, groupKey: `access_request:${ins.insertId}:cw:${uid}` });
    }
    return ins.insertId;
  });
}

async function requestList({ childId = null, pending = false, userId = null } = {}, conn = pool) {
  const where = []; const args = [];
  if (childId) { where.push('r.child_id = ?'); args.push(String(childId)); }
  if (pending) where.push("r.status = 'Pending'");
  if (userId) { where.push('r.requested_by = ?'); args.push(userId); }
  const [rows] = await conn.query(
    `SELECT r.request_id, r.child_id, r.requested_by, u.full_name AS requested_by_name, r.reason_enc, r.status, r.decision, r.decision_note,
            r.decided_at, db.full_name AS decided_by_name, r.created_at
       FROM tbl_child_access_requests r JOIN tbl_users u ON u.user_id = r.requested_by LEFT JOIN tbl_users db ON db.user_id = r.decided_by
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY r.created_at DESC LIMIT 200`, args);
  return rows.map(({ reason_enc: x, ...r }) => ({ ...r, reason: decrypt(x, env.phiKey) }));
}

/** Admin: assign (primary or backup), grant a temporary cover (with an end date), or deny. */
async function decideRequest(req, requestId, body) {
  const decision = String(body?.decision || '');
  const note = String(body?.note || '').trim().slice(0, 500);
  if (!['assign', 'temporary_cover', 'deny'].includes(decision)) throw new HttpError(422, 'Choose assign, temporary cover or deny.', { errors: { decision: 'Choose a decision.' } });
  if (decision === 'deny' && note.length < 3) throw new HttpError(422, 'Give the reason for denying.', { errors: { note: 'Give the reason.' } });
  return withTransaction(async (conn) => {
    const [[r]] = await conn.query('SELECT * FROM tbl_child_access_requests WHERE request_id = ? FOR UPDATE', [requestId]);
    if (!r) throw new HttpError(404, 'Request not found.');
    if (r.status !== 'Pending') throw new HttpError(409, 'This request was already decided.');
    let assignmentId = null;
    if (decision !== 'deny') {
      const type = decision === 'temporary_cover' ? 'temporary' : (body?.type === 'primary' ? 'primary' : 'backup');
      assignmentId = await Assign().add(conn, req, 'child', r.child_id, { userId: r.requested_by, type, endsAt: body?.ends_at, source: 'access_request', note: `Access request #${requestId}`, reference: r.child_id });
    }
    await conn.query('UPDATE tbl_child_access_requests SET status = ?, decision = ?, decided_by = ?, decided_at = NOW(), decision_note = ?, assignment_id = ? WHERE request_id = ?',
      [decision === 'deny' ? 'Denied' : 'Approved', decision === 'assign' ? 'assigned' : decision === 'temporary_cover' ? 'temporary_cover' : 'denied', req.user.user_id, note || null, assignmentId, requestId]);
    await logActivityWith(conn, req, decision === 'deny' ? `CRA_ACCESS_REQUEST_DENIED (#${requestId})` : `CRA_ACCESS_REQUEST_APPROVED (#${requestId}, ${decision === 'assign' ? 'assigned' : 'temporary cover'})`, `Child ${r.child_id}`);
    await Notify.emit(conn, 'access_request_decided', { userId: r.requested_by, params: { ref: r.child_id, id: r.child_id, approved: decision !== 'deny' }, entityType: 'child', entityId: r.child_id });
  });
}

// ---------------------------------------------------------------- monitoring visits (Admin)
async function startMonitoring(req, body) {
  if (req.user.role !== 'Admin') throw new HttpError(403, DENIED);
  const errors = {};
  const reviewer = String(body?.reviewer_name || '').trim();
  const org = String(body?.reviewer_org || '');
  const minutes = Number(body?.minutes);
  const ids = [...new Set((Array.isArray(body?.child_ids) ? body.child_ids : []).map(String))];
  if (reviewer.length < 2 || reviewer.length > 150) errors.reviewer_name = "Enter the reviewer's name.";
  if (!L.MONITORING_ORGS.includes(org)) errors.reviewer_org = 'Choose NACC, DSWD or Other.';
  if (!Number.isInteger(minutes) || minutes < 15 || minutes > 480) errors.minutes = 'Choose 15 to 480 minutes.';
  if (!ids.length || ids.length > 100) errors.child_ids = 'Choose 1 to 100 records.';
  if (Object.keys(errors).length) throw new HttpError(422, Object.values(errors)[0], { errors });
  if (await monitoringOf(req)) throw new HttpError(409, 'A monitoring visit is already running. End it first.');
  const [found] = await pool.query('SELECT child_id FROM tbl_children WHERE child_id IN (?)', [ids]);
  if (found.length !== ids.length) throw new HttpError(422, 'Some records were not found.', { errors: { child_ids: 'Some records were not found.' } });
  await withTransaction(async (conn) => {
    const [m] = await conn.query('INSERT INTO tbl_monitoring_sessions (admin_id, reviewer_name, reviewer_org, session_jti, started_at, expires_at) VALUES (?, ?, ?, ?, NOW(), NOW() + INTERVAL ? MINUTE)',
      [req.user.user_id, reviewer, org, req.auth?.jti || null, minutes]);
    for (const id of ids) await conn.query('INSERT INTO tbl_monitoring_records (monitoring_id, child_id) VALUES (?, ?)', [m.insertId, id]);
    await logActivityWith(conn, req, `CRA_MONITORING_STARTED (#${m.insertId}, ${org}, ${ids.length} records, ${minutes} min)`, 'Monitoring visit');
  });
  req._monitoring = undefined;
  return monitoringOf(req);
}

async function endMonitoring(req, monitoringId, reason = 'ended', conn = pool) {
  const [r] = await conn.query('UPDATE tbl_monitoring_sessions SET ended_at = NOW(), end_reason = ? WHERE monitoring_id = ? AND ended_at IS NULL', [reason, monitoringId]);
  if (!r.affectedRows) return;
  const [[m]] = await conn.query('SELECT admin_id FROM tbl_monitoring_sessions WHERE monitoring_id = ?', [monitoringId]);
  if (req?.user) await logActivity(req, `CRA_MONITORING_ENDED (#${monitoringId}, ${reason})`, 'Monitoring visit');
  else await logSystemActivity(conn, m?.admin_id, `CRA_MONITORING_ENDED (#${monitoringId}, ${reason}) [automatic]`, 'Monitoring visit');
  if (req) req._monitoring = null;
}

async function endMonitoringForUser(userId, reason = 'signed_out') {
  const [rows] = await pool.query('SELECT monitoring_id FROM tbl_monitoring_sessions WHERE admin_id = ? AND ended_at IS NULL', [userId]).catch(() => [[]]);
  for (const r of rows) await endMonitoring(null, r.monitoring_id, reason);
}

async function monitoringRecordOpened(req, childId) {
  const m = await monitoringOf(req);
  if (!m) return;
  await pool.query('UPDATE tbl_monitoring_records SET open_count = open_count + 1, first_opened_at = COALESCE(first_opened_at, NOW()) WHERE monitoring_id = ? AND child_id = ?', [m.monitoring_id, String(childId)]);
  await logActivity(req, `CRA_MONITORING_RECORD_VIEWED (#${m.monitoring_id})`, `Child ${childId}`);
}

/** Paths an Admin may still use during a monitoring visit (everything else is refused; no changes, no downloads). */
const MONITORING_GET = [/^\/children(\/|$|\?)/, /^\/monitoring/, /^\/settings$/, /^\/notifications\/(unread-count|counts)/, /^\/unlock\/options/, /^\/child-access\/me/];
const MONITORING_POST = [/^\/monitoring\/end$/, /^\/children\/[^/]+\/health-access(\/revoke)?$/, /^\/unlock\/events$/, /^\/security\/capture-attempts$/];
const MONITORING_NO_DOWNLOAD = /(export|download|receipt|proof|sealed|\/file$|documents\/)/;

/** Middleware (after sign-in): Admin monitoring visits are read-only, limited to the chosen records, no downloads. */
async function monitoringGuard(req, res, next) {
  try {
    if (req.user?.role !== 'Admin') return next();
    const m = await monitoringOf(req);
    if (!m) return next();
    const path = req.path;
    if (req.method === 'GET' ? MONITORING_GET.some((r) => r.test(path)) && !MONITORING_NO_DOWNLOAD.test(path) : MONITORING_POST.some((r) => r.test(path))) return next();
    await logActivity(req, `CRA_MONITORING_BLOCKED (${req.method} ${path.split('/').slice(0, 3).join('/')})`, 'Monitoring visit');
    return next(new HttpError(403, req.method === 'GET' ? 'Only the selected records can be opened during a monitoring visit, and downloads are off.' : 'Monitoring mode is read-only. End the monitoring visit to make changes.', { monitoring: true }));
  } catch (err) { return next(err); }
}

// ---------------------------------------------------------------- Admin overview, report, sweep
async function overview(conn = pool) {
  const [[un]] = await conn.query(
    `SELECT COUNT(*) AS n FROM tbl_children c LEFT JOIN tbl_users u ON u.user_id = c.assigned_staff_id
      WHERE c.status = 'Active' AND (c.assigned_staff_id IS NULL OR u.is_active = FALSE)`);
  const [[flags]] = await conn.query('SELECT COUNT(*) AS n FROM (SELECT DISTINCT record_type, record_id FROM tbl_reassignment_flags WHERE cleared_at IS NULL) x');
  const [[covers]] = await conn.query(`SELECT COUNT(*) AS n FROM tbl_record_assignments a WHERE a.assignment_type = 'temporary' AND ${ACTIVE_SQL} AND a.ends_at <= NOW() + INTERVAL 3 DAY`);
  const [[reqs]] = await conn.query("SELECT COUNT(*) AS n FROM tbl_child_access_requests WHERE status = 'Pending'");
  const [[em]] = await conn.query('SELECT COUNT(*) AS n FROM tbl_emergency_access WHERE result IS NULL');
  const [[pc]] = await conn.query("SELECT COUNT(*) AS n FROM tbl_privacy_concerns WHERE status = 'Open'");
  const [[ad]] = await conn.query("SELECT COUNT(*) AS n FROM tbl_children WHERE admission_status = 'Pending Approval'").catch(() => [[{ n: 0 }]]);
  const s = await settings(conn);
  return { unassigned: Number(un.n), needs_reassignment: Number(flags.n), covers_ending: Number(covers.n), access_requests: Number(reqs.n),
    emergency_to_review: Number(em.n), privacy_concerns: Number(pc.n), admissions_to_review: Number(ad.n), mode: s.child_access_mode };
}

/** "Would be blocked" while in Log only: by staff member and by child (reference numbers only). */
async function wouldBlock({ days = 30 } = {}, conn = pool) {
  const d = Math.min(365, Math.max(1, Number(days) || 30));
  const [byStaff] = await conn.query(
    `SELECT s.user_id, u.full_name AS user_name, COUNT(DISTINCT s.child_id) AS children, SUM(s.hits) AS hits,
            SUM(s.level = 'core') AS core_rows, SUM(s.level = 'care_card') AS care_rows, MAX(s.last_at) AS last_at
       FROM tbl_child_access_shadow s JOIN tbl_users u ON u.user_id = s.user_id WHERE s.day >= CURDATE() - INTERVAL ? DAY
      GROUP BY s.user_id, u.full_name ORDER BY hits DESC`, [d]);
  const [byChild] = await conn.query(
    `SELECT s.child_id, COUNT(DISTINCT s.user_id) AS staff, SUM(s.hits) AS hits, MAX(s.last_at) AS last_at
       FROM tbl_child_access_shadow s WHERE s.day >= CURDATE() - INTERVAL ? DAY GROUP BY s.child_id ORDER BY hits DESC LIMIT 500`, [d]);
  const n = (rows) => rows.map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, typeof v === 'bigint' || (typeof v === 'string' && /^\d+$/.test(v) && k !== 'child_id') ? Number(v) : v])));
  return { days: d, by_staff: n(byStaff), by_child: n(byChild) };
}

/** Hourly: end what expired, alert Admin, remind case workers. Safe to run any time. */
async function sweep() {
  const A = Assign();
  const s = await settings();
  // 1. Initial access that ran out; alert when the child still has no case worker.
  const [ini] = await pool.query('SELECT child_id, user_id FROM tbl_child_initial_access WHERE ended_at IS NULL AND ends_at <= NOW()');
  for (const r of ini) {
    await withTransaction(async (conn) => {
      await endInitialAccess(conn, null, r.child_id, 'expired');
      const active = (await A.active(conn, 'child', r.child_id)).filter((a) => a.assignment_type === 'primary' && a.is_active);
      if (!active.length) {
        await A.flag(conn, 'child', r.child_id, null, 'no_case_worker');
        await Notify.toAdmins(conn, 'admin_child_no_case_worker', { params: { ref: r.child_id, id: r.child_id }, entityType: 'child', entityId: r.child_id, groupKey: `no_cw:${r.child_id}` });
      }
    });
  }
  // 2. Temporary covers that ended.
  const [ended] = await pool.query("SELECT * FROM tbl_record_assignments WHERE ended_at IS NULL AND ends_at IS NOT NULL AND ends_at <= NOW()");
  for (const row of ended) await withTransaction((conn) => A.endRow(conn, null, row, row.assignment_type === 'temporary' ? 'cover_ended' : 'ended'));
  // 3. Covers ending within a day: one alert each.
  const [ending] = await pool.query("SELECT assignment_id, record_type, record_id, ends_at FROM tbl_record_assignments WHERE ended_at IS NULL AND assignment_type = 'temporary' AND ends_at > NOW() AND ends_at <= NOW() + INTERVAL 1 DAY");
  for (const r of ending) {
    await Notify.toAdmins(pool, 'admin_cover_ending', { params: { ref: r.record_id, id: r.record_id, kind: r.record_type, when: new Date(r.ends_at).toLocaleString('en-PH', { dateStyle: 'medium', timeStyle: 'short' }) },
      groupKey: `cover_ending:${r.assignment_id}` });
  }
  // 4. Emergency access and monitoring visits past their time.
  const [em] = await pool.query('SELECT emergency_id, child_id, user_id FROM tbl_emergency_access WHERE ended_at IS NULL AND expires_at <= NOW()');
  for (const e of em) {
    await pool.query('UPDATE tbl_emergency_access SET ended_at = expires_at WHERE emergency_id = ? AND ended_at IS NULL', [e.emergency_id]);
    await logSystemActivity(pool, e.user_id, `CRA_EMERGENCY_ACCESS_ENDED (expired, #${e.emergency_id}) [automatic]`, `Child ${e.child_id}`);
  }
  const [ms] = await pool.query('SELECT monitoring_id FROM tbl_monitoring_sessions WHERE ended_at IS NULL AND expires_at <= NOW()');
  for (const m of ms) await endMonitoring(null, m.monitoring_id, 'expired');
  // 5. Active children without an active case worker (count only).
  const ov = await overview();
  // A new alert only when the number changes (no repeat every 15 minutes).
  if (ov.unassigned) await Notify.toAdmins(pool, 'admin_children_unassigned', { params: { count: ov.unassigned }, groupKey: `children_unassigned:${ov.unassigned}` });
  // 6. Care card review reminders to the primary case worker.
  const [due] = await pool.query(
    `SELECT c.child_id, c.assigned_staff_id FROM tbl_children c LEFT JOIN tbl_care_cards cc ON cc.child_id = c.child_id
      JOIN tbl_users u ON u.user_id = c.assigned_staff_id AND u.is_active = TRUE
      WHERE c.status = 'Active' AND cc.child_id IS NOT NULL AND (cc.last_reviewed_at IS NULL OR cc.last_reviewed_at <= NOW() - INTERVAL ? DAY)
        AND (cc.review_reminded_at IS NULL OR cc.review_reminded_at <= NOW() - INTERVAL ? DAY)`, [s.child_care_card_review_days, s.child_care_card_review_days]);
  for (const r of due) {
    await Notify.emit(pool, 'care_card_review_due', { userId: r.assigned_staff_id, params: { ref: r.child_id, id: r.child_id }, entityType: 'child', entityId: r.child_id });
    await pool.query('UPDATE tbl_care_cards SET review_reminded_at = NOW() WHERE child_id = ?', [r.child_id]);
  }
  return { initial_ended: ini.length, covers_ended: ended.length, emergency_ended: em.length, monitoring_ended: ms.length, reminders: due.length };
}

// ---------------------------------------------------------------- privacy concerns
async function reportConcern(req, body) {
  const topic = String(body?.topic || '');
  const details = String(body?.details || '').trim();
  if (!L.PRIVACY_TOPICS.includes(topic)) throw new HttpError(422, 'Choose what the concern is about.', { errors: { topic: 'Choose a topic.' } });
  if (details.length < 10 || details.length > 2000) throw new HttpError(422, 'Describe the concern (10 to 2000 characters).', { errors: { details: '10 to 2000 characters.' } });
  return withTransaction(async (conn) => {
    const [ins] = await conn.query('INSERT INTO tbl_privacy_concerns (reported_by, topic, details_enc) VALUES (?, ?, ?)', [req.user.user_id, topic, encrypt(details, env.phiKey)]);
    await logActivityWith(conn, req, `CRA_PRIVACY_CONCERN_REPORTED (#${ins.insertId})`, 'Data protection');
    await Notify.toAdmins(conn, 'admin_privacy_concern', { params: { id: ins.insertId }, groupKey: `privacy_concern:${ins.insertId}` });
    // The Data Protection Officer, when the DPO email is a CareSphere account.
    const [[dpo]] = await conn.query(
      `SELECT u.user_id FROM tbl_settings s JOIN tbl_users u ON LOWER(u.email) = LOWER(TRIM(s.setting_value)) AND u.is_active = TRUE
         JOIN tbl_roles r ON r.role_id = u.role_id AND r.role_name IN ('Admin', 'Staff') WHERE s.setting_key = 'dpo_email'`);
    if (dpo) await Notify.emit(conn, 'admin_privacy_concern', { userId: dpo.user_id, params: { id: ins.insertId }, groupKey: `privacy_concern:${ins.insertId}` });
    return ins.insertId;
  });
}

async function concernList(conn = pool) {
  const [rows] = await conn.query(
    `SELECT p.concern_id, p.topic, p.details_enc, p.status, p.created_at, u.full_name AS reported_by_name, p.reviewed_at, rb.full_name AS reviewed_by_name
       FROM tbl_privacy_concerns p JOIN tbl_users u ON u.user_id = p.reported_by LEFT JOIN tbl_users rb ON rb.user_id = p.reviewed_by
      ORDER BY p.status = 'Open' DESC, p.created_at DESC LIMIT 200`);
  return rows.map(({ details_enc: x, ...r }) => ({ ...r, details: decrypt(x, env.phiKey) }));
}

module.exports = {
  DENIED, DUP_MESSAGE, CARE_FIELDS, invalidate, load, settings, viewerContext, decideFor, decide, check, sensitiveAccess, isAssigned, shapeList, shapeOne,
  nameFor, displayName, grantInitialAccess, endInitialAccess, intakeComplete, duplicateCheck, careCard, saveCareCard, reviewCareCard,
  emergencySummary, startEmergency, currentEmergency, endEmergency, emergencyList, reviewEmergency, requestAccess, requestList, decideRequest,
  startMonitoring, endMonitoring, endMonitoringForUser, monitoringOf, monitoringRecordOpened, monitoringGuard, overview, wouldBlock, sweep,
  reportConcern, concernList, onShift,
};
