/**
 * Child record access: Care card, the Access tab (assignments, requests, emergency access, access history),
 * access requests, emergency access, monitoring visits, settings, the "would be blocked" report and privacy
 * concerns. Every handler goes through the one policy (services/childAccess.js).
 */
const { pool, withTransaction } = require('../config/db');
const HttpError = require('../utils/HttpError');
const { logActivity, logActivityWith } = require('../utils/audit');
const Policy = require('../services/childAccess');
const Assign = require('../services/assignment');
const L = require('../config/childRecordLevels');

const ok = (res, data, extra = {}) => res.json({ success: true, data, ...extra });
const toId = (v) => { const n = Number.parseInt(v, 10); if (!(n > 0)) throw new HttpError(400, 'Invalid id.'); return n; };

// ---------------------------------------------------------------- Care card
/** GET /api/children/:id/care-card - minimum necessary for daily care. Every view is logged. */
exports.getCareCard = async (req, res) => {
  const d = await Policy.check(req, req.params.id, 'care_card', 'view Care card');
  await logActivity(req, 'CRA_CARE_CARD_VIEWED', `Child ${d.child_id}`);
  const card = await Policy.careCard(d.child_id);
  // Staff who aren't assigned don't learn who the case worker is (the Care card is edited by the case worker).
  if (req.user.role !== 'Admin' && !d.edit_care_card) { card.last_reviewed_by_name = null; card.updated_by_name = null; }
  ok(res, { ...card, can_edit: d.edit_care_card && !d.read_only });
};
/** PUT /api/children/:id/care-card - the assigned case worker and Admin only. */
exports.saveCareCard = async (req, res) => {
  const d = await Policy.check(req, req.params.id, 'edit_care_card', 'edit Care card');
  ok(res, { ...(await Policy.saveCareCard(req, d.child_id, req.body)), can_edit: true }, { message: 'Care card saved.' });
};
/** POST /api/children/:id/care-card/review - "Reviewed, no changes". */
exports.reviewCareCard = async (req, res) => {
  const d = await Policy.check(req, req.params.id, 'edit_care_card', 'review Care card');
  ok(res, { ...(await Policy.reviewCareCard(req, d.child_id)), can_edit: true }, { message: 'Marked as reviewed.' });
};

// ---------------------------------------------------------------- Access tab
/** GET /api/children/:id/access - Admin and the case worker: assignments, requests, emergency access, access history. */
exports.accessTab = async (req, res) => {
  const d = await Policy.check(req, req.params.id, 'access_tab', 'open Access tab');
  const [assignments, requests, emergency] = await Promise.all([
    Assign.history(pool, 'child', d.child_id), Policy.requestList({ childId: d.child_id }), Policy.emergencyList({ childId: d.child_id })]);
  const [history] = await pool.query(
    `SELECT l.timestamp AS created_at, u.full_name AS user_name, l.user_role, l.action_performed FROM tbl_activity_logs l LEFT JOIN tbl_users u ON u.user_id = l.user_id
      WHERE l.target_entity = ? AND (l.action_performed LIKE 'CRA_%' OR l.action_performed LIKE 'VIEW_%' OR l.action_performed LIKE 'UPDATE_%')
      ORDER BY l.log_id DESC LIMIT 100`, [`Child ${d.child_id}`]);
  const [sessions] = await pool.query(
    `SELECT s.session_id, s.user_id, u.full_name AS user_name, s.purpose, s.started_at, s.expires_at, s.ended_at, s.end_reason
       FROM tbl_unlock_sessions s JOIN tbl_users u ON u.user_id = s.user_id WHERE s.record_type = 'health' AND s.record_id = ? ORDER BY s.started_at DESC LIMIT 50`, [d.child_id]);
  const { friendlyLabel } = require('../config/auditCategories');
  const [flags] = await pool.query("SELECT reason, flagged_at FROM tbl_reassignment_flags WHERE record_type = 'child' AND record_id = ? AND cleared_at IS NULL", [d.child_id]);
  await logActivity(req, 'CRA_ACCESS_TAB_VIEWED', `Child ${d.child_id}`);
  // Staff (the case worker) see their own assignment rows; other assigned staff stay unnamed (Admin information).
  const shownAssignments = req.user.role === 'Admin' ? assignments
    : assignments.map((a) => (a.user_id === req.user.user_id ? a : { ...a, user_name: 'Another staff member', user_id: null }));
  ok(res, {
    assignments: shownAssignments, requests, emergency, needs_reassignment: flags,
    // only assigned staff can unlock, so other people's sessions would name them: Staff see their own only
    unlock_sessions: req.user.role === 'Admin' ? sessions : sessions.filter((x) => x.user_id === req.user.user_id),
    history: history.map((h) => ({ ...h, label: friendlyLabel('activity', h.action_performed) })),
    can_manage: req.user.role === 'Admin' && !d.read_only,
    initial_access: (await pool.query('SELECT i.starts_at, i.ends_at, i.ended_at, i.end_reason, u.full_name AS user_name FROM tbl_child_initial_access i JOIN tbl_users u ON u.user_id = i.user_id WHERE i.child_id = ?', [d.child_id]))[0][0] || null,
  });
};

/** GET /api/assignments/staff?record_type=child (Admin) - active Staff who may hold this kind of assignment. */
exports.assignableStaff = async (req, res) => {
  const type = String(req.query.record_type || 'child');
  const duty = (Assign.TABLES[type] || Assign.TABLES.child).duty;
  const [rows] = await pool.query(
    `SELECT u.user_id, u.full_name FROM tbl_users u JOIN tbl_roles r ON r.role_id = u.role_id JOIN tbl_staff_duties sd ON sd.user_id = u.user_id AND sd.duty = ?
      WHERE r.role_name = 'Staff' AND u.is_active = TRUE ORDER BY u.full_name`, [duty]);
  ok(res, rows);
};

/** POST /api/children/:id/assignments (Admin) { user_id, type, starts_at?, ends_at?, note? } */
exports.addAssignment = async (req, res) => {
  const d = await Policy.check(req, req.params.id, 'admin', 'assign staff');
  const b = req.body || {};
  await withTransaction((conn) => Assign.add(conn, req, 'child', d.child_id, { userId: b.user_id, type: b.type, startsAt: b.starts_at, endsAt: b.ends_at, note: b.note, reference: d.child_id }));
  ok(res, await Assign.history(pool, 'child', d.child_id), { message: 'Assignment saved.' });
};

/** POST /api/assignments/bulk (Admin) { record_type, ids[], user_id, type, ends_at? } */
exports.bulkAssign = async (req, res) => {
  const b = req.body || {};
  const type = String(b.record_type || 'child');
  if (!Assign.TABLES[type]) throw new HttpError(400, 'Unknown record type.');
  const n = await Assign.bulk(req, type, b.ids, { userId: b.user_id, type: b.type, startsAt: b.starts_at, endsAt: b.ends_at, note: b.note });
  ok(res, { changed: n }, { message: `${n} record${n === 1 ? '' : 's'} assigned.` });
};

/** PUT /api/assignments/:id (Admin) { ends_at } - change when a temporary cover ends. */
exports.changeAssignment = async (req, res) => {
  const row = await withTransaction((conn) => Assign.change(conn, req, toId(req.params.id), { endsAt: req.body?.ends_at }));
  ok(res, await Assign.history(pool, row.record_type, row.record_id), { message: 'End date changed.' });
};

/** POST /api/assignments/:id/end (Admin) - end an assignment now (the person loses access at once). */
exports.endAssignment = async (req, res) => {
  const row = await withTransaction((conn) => Assign.end(conn, req, toId(req.params.id), 'unassigned'));
  ok(res, await Assign.history(pool, row.record_type, row.record_id), { message: 'Assignment ended.' });
};

// ---------------------------------------------------------------- access requests
/** POST /api/children/:id/access-requests (Staff) { reason } */
exports.requestAccess = async (req, res) => {
  await Policy.requestAccess(req, req.params.id, req.body);
  res.status(201).json({ success: true, message: 'Request sent to the Admin and the case worker.' });
};
/** GET /api/access-requests?status=pending (Admin) */
exports.listRequests = async (req, res) => ok(res, await Policy.requestList({ pending: req.query.status === 'pending' }));
/** POST /api/access-requests/:id/decision (Admin) { decision: assign | temporary_cover | deny, type?, ends_at?, note? } */
exports.decideRequest = async (req, res) => {
  await Policy.decideRequest(req, toId(req.params.id), req.body);
  ok(res, await Policy.requestList({ pending: true }), { message: 'Decision saved.' });
};

// Emergency access was removed (no routes). Earlier uses are listed read-only in the Access tab (Admin).

// ---------------------------------------------------------------- monitoring visits
exports.startMonitoring = async (req, res) => { res.status(201).json({ success: true, data: await Policy.startMonitoring(req, req.body) }); };
exports.currentMonitoring = async (req, res) => ok(res, await Policy.monitoringOf(req));
exports.endMonitoring = async (req, res) => {
  const m = await Policy.monitoringOf(req);
  if (m) await Policy.endMonitoring(req, m.monitoring_id, 'ended');
  ok(res, null, { message: 'Monitoring visit ended.' });
};

// ---------------------------------------------------------------- settings, overview, report
const DPO = ['dpo_name', 'dpo_email', 'dpo_phone'];

async function settingsView() {
  const keys = [...Object.keys(L.SETTINGS), ...DPO];
  const [rows] = await pool.query(
    `SELECT s.setting_key, s.setting_value, s.updated_at, u.full_name AS updated_by_name FROM tbl_settings s LEFT JOIN tbl_users u ON u.user_id = s.updated_by
      WHERE s.setting_key IN (?)`, [keys]);
  const raw = Object.fromEntries(rows.map((r) => [r.setting_key, r]));
  const values = await Policy.settings();
  const out = {};
  for (const k of keys) {
    out[k] = { value: k in values ? values[k] : (raw[k]?.setting_value ?? ''), updated_at: raw[k]?.updated_by_name ? raw[k].updated_at : null, updated_by_name: raw[k]?.updated_by_name || null,
      label: L.SETTINGS[k]?.label || { dpo_name: 'DPO name', dpo_email: 'DPO email', dpo_phone: 'DPO phone' }[k] };
  }
  const [staff] = await pool.query(
    `SELECT u.user_id, u.full_name FROM tbl_users u JOIN tbl_roles r ON r.role_id = u.role_id JOIN tbl_staff_duties sd ON sd.user_id = u.user_id AND sd.duty = 'children'
      WHERE r.role_name = 'Staff' AND u.is_active = TRUE ORDER BY u.full_name`);
  const checklist = require('../config/admission').CHECKLIST.map((c) => ({ key: c.key, label: c.label, condition: c.condition || null }));
  return { settings: out, staff, admission_checklist: checklist };
}

/** GET /api/child-access/settings (Admin) */
exports.getSettings = async (req, res) => ok(res, await settingsView());

/** PUT /api/child-access/settings (Admin) - each change logged with old and new values; Enforce needs confirm: true. */
exports.saveSettings = async (req, res) => {
  const b = req.body || {};
  const current = await settingsView();
  const errors = {};
  const changes = [];
  for (const [k, def] of Object.entries(L.SETTINGS)) {
    if (b[k] === undefined) continue;
    let v = String(b[k]).trim();
    if (def.options && !def.options.includes(v)) { errors[k] = 'Choose one of the options.'; continue; }
    if (typeof def.def === 'number') {
      if (!/^\d{1,4}$/.test(v) || Number(v) < def.min || Number(v) > def.max) { errors[k] = `Enter ${def.min} to ${def.max}.`; continue; }
      v = String(Number(v));
    }
    if (def.list) { // admission_required_documents: checklist keys, comma separated
      const keys = [...new Set(v.split(',').map((x) => x.trim()).filter(Boolean))];
      const known = require('../config/admission').CHECKLIST.map((c) => c.key);
      if (keys.some((x) => !known.includes(x))) { errors[k] = 'Choose documents from the admission checklist.'; continue; }
      v = known.filter((x) => keys.includes(x)).join(',');
    }
    if (k === 'child_default_case_worker_id' && v) {
      if (!current.staff.some((s) => String(s.user_id) === v)) { errors[k] = 'Choose an active Staff member with the Child records duty.'; continue; }
    }
    if (String(current.settings[k].value) !== v) changes.push([k, String(current.settings[k].value), v]);
  }
  for (const k of DPO) {
    if (b[k] === undefined) continue;
    const v = String(b[k]).trim();
    if (v.length > 150) { errors[k] = 'Up to 150 characters.'; continue; }
    if (k === 'dpo_email' && v && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v)) { errors[k] = 'Enter a valid email.'; continue; }
    if (String(current.settings[k].value) !== v) changes.push([k, String(current.settings[k].value), v]);
  }
  if (Object.keys(errors).length) throw new HttpError(422, Object.values(errors)[0], { errors });
  const toEnforce = changes.find(([k, , v]) => k === 'child_access_mode' && v === 'enforce');
  if (toEnforce && b.confirm !== true) {
    throw new HttpError(409, 'Switching to Enforce starts blocking Staff from records they are not assigned to. Confirm to continue.', { needs_confirmation: true });
  }
  if (changes.length) {
    await withTransaction(async (conn) => {
      for (const [k, , v] of changes) {
        await conn.query(`INSERT INTO tbl_settings (setting_key, setting_value, updated_by) VALUES (?, ?, ?)
          ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value), updated_by = VALUES(updated_by)`, [k, v, req.user.user_id]);
      }
      for (const [k, o, v] of changes) {
        const show = (x) => (k === 'child_default_case_worker_id' ? (x ? `user #${x}` : 'none') : k.startsWith('dpo_') ? (x ? 'set' : 'empty') : x || 'empty');
        await logActivityWith(conn, req, `UPDATE_SETTINGS (${k}: ${show(o)} -> ${show(v)})`, 'Child record access');
      }
    });
    Policy.invalidate();
  }
  ok(res, await settingsView(), { message: changes.length ? 'Settings saved.' : 'Nothing changed.' });
};

/** GET /api/child-access/overview (Admin) - counts for the alerts strip. */
exports.overview = async (req, res) => ok(res, await Policy.overview());

/** GET /api/child-access/would-block?days=30 (Admin) - Log only report, by staff member and by child. */
exports.wouldBlock = async (req, res) => {
  await logActivity(req, 'CRA_WOULD_BLOCK_REPORT_VIEWED', 'Child record access');
  ok(res, await Policy.wouldBlock({ days: req.query.days }));
};

/** GET /api/child-access/me - what the signed-in user can do (monitoring visit, mode). */
exports.me = async (req, res) => {
  const s = await Policy.settings();
  ok(res, { mode: s.child_access_mode, monitoring: await Policy.monitoringOf(req), assignment_types: L.ASSIGNMENT_TYPES,
    monitoring_orgs: L.MONITORING_ORGS, privacy_topics: L.PRIVACY_TOPICS });
};

/** GET /api/reassignment-flags (Admin) */
exports.flags = async (req, res) => ok(res, await Assign.openFlags(pool, req.query.record_type || null));

// ---------------------------------------------------------------- privacy concerns
exports.reportConcern = async (req, res) => {
  await Policy.reportConcern(req, req.body);
  res.status(201).json({ success: true, message: 'Thank you. The Admin and the Data Protection Officer were notified.' });
};
exports.listConcerns = async (req, res) => ok(res, await Policy.concernList());
exports.reviewConcern = async (req, res) => {
  const id = toId(req.params.id);
  const [r] = await pool.query("UPDATE tbl_privacy_concerns SET status = 'Reviewed', reviewed_by = ?, reviewed_at = NOW() WHERE concern_id = ? AND status = 'Open'", [req.user.user_id, id]);
  if (!r.affectedRows) throw new HttpError(409, 'Already reviewed.');
  await logActivity(req, `CRA_PRIVACY_CONCERN_REVIEWED (#${id})`, 'Data protection');
  ok(res, await Policy.concernList());
};
