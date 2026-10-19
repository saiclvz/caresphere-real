/**
 * Staff schedules (Admin): validation, overlap and long-shift warnings, whole-day saves, bulk create,
 * copy day / week with Skip or Replace, and undo of the last bulk action. Every write runs in one
 * transaction with its audit entries and the staff members' notifications (date, time, area only).
 */
const { pool, withTransaction } = require('../config/db');
const HttpError = require('../utils/HttpError');
const { logActivityWith } = require('../utils/audit');
const Notify = require('./notifications');

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/;
const LONG_HOURS = 12;
const UNDO_MINUTES = 30;

const hm = (t) => String(t || '').slice(0, 5);
const ymd = (d) => String(d instanceof Date ? d.toISOString() : d).slice(0, 10);
const addDays = (date, n) => { const d = new Date(`${date}T00:00:00`); d.setDate(d.getDate() + n); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const minutes = (t) => { const [h, m] = hm(t).split(':').map(Number); return h * 60 + m; };

/** A shift as a time range in minutes from the start of its date (end may pass 24:00 when it ends the next day). */
function rangeOf(s) {
  const start = minutes(s.start_time);
  const end = minutes(s.end_time) + (s.ends_next_day ? 1440 : 0);
  return { start, end, day: ymd(s.shift_date) };
}
/** Do two shifts overlap? Works across midnight and across neighbouring dates. */
function overlaps(a, b) {
  const ra = rangeOf(a);
  const rb = rangeOf(b);
  const offset = Math.round((new Date(`${rb.day}T00:00:00`) - new Date(`${ra.day}T00:00:00`)) / 60000);
  return ra.start < rb.end + offset && rb.start + offset < ra.end;
}
const describe = (s, areaName) => `${ymd(s.shift_date)} ${hm(s.start_time)}-${hm(s.end_time)}${s.ends_next_day ? ' (+1 day)' : ''} ${areaName || s.area_name || s.assignment || ''}`.trim();

async function areas(conn = pool) {
  const [rows] = await conn.query('SELECT area_id, name, is_active, sort_order FROM tbl_schedule_areas ORDER BY sort_order, name');
  return rows.map((r) => ({ ...r, is_active: !!r.is_active }));
}
async function activeStaff(conn = pool) {
  const [rows] = await conn.query("SELECT u.user_id, u.full_name FROM tbl_users u JOIN tbl_roles r ON r.role_id = u.role_id WHERE r.role_name = 'Staff' AND u.is_active = TRUE");
  return new Map(rows.map((r) => [r.user_id, r.full_name]));
}

/** Validates one row; returns { value } or { error }. Only active Staff and active areas. */
function validateRow(row, ctx) {
  const userId = Number(row?.user_id);
  if (!ctx.staff.has(userId)) return { error: 'Choose an active Staff account.' };
  const date = String(row?.shift_date || '');
  if (!DATE.test(date)) return { error: 'Choose a valid date.' };
  const start = String(row?.start_time || '');
  const end = String(row?.end_time || '');
  if (!TIME.test(start) || !TIME.test(end)) return { error: 'Enter start and end times.' };
  const next = row?.ends_next_day === true || row?.ends_next_day === 1 || row?.ends_next_day === '1';
  if (!next && minutes(end) <= minutes(start)) return { error: 'End time must be after the start time. Tick "Ends the next day" for an overnight shift.' };
  if (next && minutes(end) >= minutes(start)) return { error: 'An overnight shift ends earlier on the next day than it starts. Check the times, or untick "Ends the next day".' };
  const area = ctx.areas.find((a) => a.area_id === Number(row?.area_id) && a.is_active);
  if (!area) return { error: 'Choose an area.' };
  const note = String(row?.note || '').trim();
  if (note.length > 300) return { error: 'The note can be up to 300 characters.' };
  return { value: { user_id: userId, shift_date: date, start_time: hm(start), end_time: hm(end), ends_next_day: next, area_id: area.area_id, area_name: area.name, note: note || null } };
}

/** Existing shifts that could touch these dates (the day before and after, for overnight shifts). */
async function existingAround(conn, userIds, dates) {
  if (!userIds.length || !dates.length) return [];
  const sorted = [...dates].sort();
  const [rows] = await conn.query(
    `SELECT s.schedule_id, s.user_id, s.shift_date, s.start_time, s.end_time, s.ends_next_day, s.area_id, s.note, s.assignment, s.batch_id, a.name AS area_name
       FROM tbl_staff_schedules s LEFT JOIN tbl_schedule_areas a ON a.area_id = s.area_id
      WHERE s.archived_at IS NULL AND s.user_id IN (?) AND s.shift_date BETWEEN ? AND ?`, [userIds, addDays(sorted[0], -1), addDays(sorted[sorted.length - 1], 1)]);
  return rows.map((r) => ({ ...r, shift_date: ymd(r.shift_date), ends_next_day: !!r.ends_next_day }));
}

/** Warnings for a set of planned rows: overlaps (with each other or with kept shifts) and long shifts. */
function warningsFor(rows, kept, staff) {
  const out = [];
  rows.forEach((r, i) => {
    const r0 = rangeOf(r);
    if (r0.end - r0.start > LONG_HOURS * 60) out.push({ row: i, kind: 'long', message: `${staff.get(r.user_id)}: a ${Math.round((r0.end - r0.start) / 6) / 10}-hour shift on ${r.shift_date}.` });
    for (const k of kept) if (k.user_id === r.user_id && overlaps(r, k)) out.push({ row: i, kind: 'overlap', message: `${staff.get(r.user_id)} already has ${describe(k)}.` });
    rows.forEach((o, j) => { if (j > i && o.user_id === r.user_id && overlaps(r, o)) out.push({ row: i, kind: 'overlap', message: `${staff.get(r.user_id)} has two overlapping shifts on ${r.shift_date}.` }); });
  });
  return out;
}

async function notifyShift(conn, type, s) {
  const [[u]] = await conn.query('SELECT r.role_name FROM tbl_users u JOIN tbl_roles r ON r.role_id = u.role_id WHERE u.user_id = ?', [s.user_id]);
  if (u?.role_name !== 'Staff') return;
  await Notify.emit(conn, type, { userId: s.user_id, entityType: 'schedule',
    params: { date: ymd(s.shift_date), time: `${hm(s.start_time)} to ${hm(s.end_time)}${s.ends_next_day ? ' (next day)' : ''}`, area: s.area_name || s.assignment || 'no area set' } });
}

async function insertShift(conn, req, s, batchId = null) {
  const [r] = await conn.query(
    `INSERT INTO tbl_staff_schedules (user_id, shift_date, start_time, end_time, ends_next_day, assignment, area_id, note, batch_id, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [s.user_id, s.shift_date, s.start_time, s.end_time, s.ends_next_day ? 1 : 0, s.area_name || s.assignment, s.area_id, s.note, batchId, req.user.user_id]);
  await logActivityWith(conn, req, `CREATE_SHIFT (user #${s.user_id}: ${describe(s)})`, `Schedule #${r.insertId}`);
  await notifyShift(conn, 'shift_created', s);
  return r.insertId;
}
/** Shifts are never deleted (migration 034): removing one archives it, with the reason, and it leaves every list. */
async function deleteShift(conn, req, before, why = '', reason = null) {
  await conn.query('UPDATE tbl_staff_schedules SET archived_at = NOW(), archived_by = ?, archive_reason = ? WHERE schedule_id = ? AND archived_at IS NULL',
    [req.user.user_id, String(reason || why.replace(/^[,;\s(]+|[)\s]+$/g, '') || 'Removed from the schedule').slice(0, 500), before.schedule_id]);
  await logActivityWith(conn, req, `DELETE_SHIFT (archived; user #${before.user_id}: ${describe(before)}${why})`, `Schedule #${before.schedule_id}`);
  await notifyShift(conn, 'shift_removed', before);
}
async function updateShift(conn, req, before, s) {
  await conn.query(
    'UPDATE tbl_staff_schedules SET user_id = ?, shift_date = ?, start_time = ?, end_time = ?, ends_next_day = ?, assignment = ?, area_id = ?, note = ? WHERE schedule_id = ?',
    [s.user_id, s.shift_date, s.start_time, s.end_time, s.ends_next_day ? 1 : 0, s.area_name, s.area_id, s.note, before.schedule_id]);
  await logActivityWith(conn, req, `UPDATE_SHIFT (user #${before.user_id}: ${describe(before)} -> user #${s.user_id}: ${describe(s)})`, `Schedule #${before.schedule_id}`);
  if (before.user_id !== s.user_id) { await notifyShift(conn, 'shift_removed', before); await notifyShift(conn, 'shift_created', s); } else await notifyShift(conn, 'shift_changed', s);
}

/** Throws 409 with warnings unless the Admin confirmed them. */
function requireConfirm(warnings, confirm) {
  if (warnings.length && !confirm) throw new HttpError(409, 'Check the warnings, then confirm to save.', { needs_confirm: true, warnings });
}

// ---------------------------------------------------------------- single shift

async function saveOne(req, id, body) {
  return withTransaction(async (conn) => {
    const ctx = { staff: await activeStaff(conn), areas: await areas(conn) };
    const v = validateRow(body, ctx);
    if (v.error) throw new HttpError(400, v.error);
    const kept = (await existingAround(conn, [v.value.user_id], [v.value.shift_date])).filter((k) => k.schedule_id !== Number(id));
    requireConfirm(warningsFor([v.value], kept, ctx.staff), body.confirm === true);
    if (!id) return insertShift(conn, req, v.value);
    const [[before]] = await conn.query('SELECT s.*, a.name AS area_name FROM tbl_staff_schedules s LEFT JOIN tbl_schedule_areas a ON a.area_id = s.area_id WHERE s.schedule_id = ? AND s.archived_at IS NULL FOR UPDATE', [id]);
    if (!before) throw new HttpError(404, 'Shift not found.');
    await updateShift(conn, req, { ...before, shift_date: ymd(before.shift_date), ends_next_day: !!before.ends_next_day }, v.value);
    return Number(id);
  });
}

async function removeOne(req, id, reason = null) {
  await withTransaction(async (conn) => {
    const [[before]] = await conn.query('SELECT s.*, a.name AS area_name FROM tbl_staff_schedules s LEFT JOIN tbl_schedule_areas a ON a.area_id = s.area_id WHERE s.schedule_id = ? AND s.archived_at IS NULL FOR UPDATE', [id]);
    if (!before) throw new HttpError(404, 'Shift not found.');
    await deleteShift(conn, req, { ...before, shift_date: ymd(before.shift_date) }, '', reason);
  });
}

// ---------------------------------------------------------------- whole day

/**
 * Saves every shift of one day at once: rows with schedule_id are updated, rows without are added,
 * and `removed` IDs are deleted. If any row is invalid nothing is saved and row_errors says which.
 */
async function saveDay(req, date, body) {
  if (!DATE.test(String(date))) throw new HttpError(400, 'Choose a valid date.');
  const rows = Array.isArray(body?.rows) ? body.rows : [];
  const removed = (Array.isArray(body?.removed) ? body.removed : []).map(Number).filter(Number.isInteger);
  if (rows.length > 100) throw new HttpError(400, 'Up to 100 shifts per day.');
  return withTransaction(async (conn) => {
    const ctx = { staff: await activeStaff(conn), areas: await areas(conn) };
    const [dayRows] = await conn.query('SELECT s.*, a.name AS area_name FROM tbl_staff_schedules s LEFT JOIN tbl_schedule_areas a ON a.area_id = s.area_id WHERE s.shift_date = ? AND s.archived_at IS NULL FOR UPDATE', [date]);
    const byId = new Map(dayRows.map((r) => [r.schedule_id, { ...r, shift_date: ymd(r.shift_date), ends_next_day: !!r.ends_next_day }]));
    const rowErrors = {};
    const values = rows.map((r, i) => {
      if (r.schedule_id && !byId.has(Number(r.schedule_id))) { rowErrors[i] = 'This shift no longer exists on this day. Reload the day.'; return null; }
      const v = validateRow({ ...r, shift_date: date }, ctx);
      if (v.error) { rowErrors[i] = v.error; return null; }
      return { ...v.value, schedule_id: r.schedule_id ? Number(r.schedule_id) : null };
    });
    for (const id of removed) if (!byId.has(id)) throw new HttpError(400, 'A shift to remove no longer exists on this day. Reload the day.');
    if (Object.keys(rowErrors).length) throw new HttpError(400, 'Fix the highlighted rows. Nothing was saved.', { row_errors: rowErrors });

    const touched = new Set([...removed, ...values.filter((v) => v.schedule_id).map((v) => v.schedule_id)]);
    const others = (await existingAround(conn, [...new Set(values.map((v) => v.user_id))], [date])).filter((k) => !touched.has(k.schedule_id));
    requireConfirm(warningsFor(values, others, ctx.staff), body.confirm === true);

    for (const id of removed) await deleteShift(conn, req, byId.get(id));
    let added = 0;
    let changed = 0;
    for (const v of values) {
      if (v.schedule_id) {
        const b = byId.get(v.schedule_id);
        const same = b.user_id === v.user_id && hm(b.start_time) === v.start_time && hm(b.end_time) === v.end_time && !!b.ends_next_day === v.ends_next_day && b.area_id === v.area_id && (b.note || null) === v.note;
        if (!same) { await updateShift(conn, req, b, v); changed += 1; }
      } else { await insertShift(conn, req, v); added += 1; }
    }
    return { added, changed, removed: removed.length };
  });
}

// ---------------------------------------------------------------- bulk, copy, undo

/**
 * Plans and (unless preview) applies a set of new shifts. Conflicts with existing shifts of the same
 * person follow on_conflict: "skip" (default) leaves the existing shift, "replace" removes it first,
 * "keep_both" creates the new shift beside the existing one (the overlap must be confirmed).
 * Applied actions are one batch, which the Admin can undo.
 */
async function applyPlan(req, kind, planned, { preview, onConflict, summaryLabel, confirm }) {
  if (!['skip', 'replace', 'keep_both'].includes(onConflict)) throw new HttpError(400, 'Choose what happens when a staff member already has a shift at that time.');
  return withTransaction(async (conn) => {
    const ctx = { staff: await activeStaff(conn), areas: await areas(conn) };
    const rowErrors = {};
    const values = planned.map((r, i) => { const v = validateRow(r, ctx); if (v.error) rowErrors[i] = v.error; return v.value; });
    if (Object.keys(rowErrors).length) throw new HttpError(400, 'Some shifts are invalid. Nothing was saved.', { row_errors: rowErrors });
    const existing = await existingAround(conn, [...new Set(values.map((v) => v.user_id))], [...new Set(values.map((v) => v.shift_date))]);
    const items = values.map((v) => ({ ...v, conflicts: existing.filter((e) => e.user_id === v.user_id && overlaps(v, e)) }));
    const toCreate = items.filter((it) => onConflict !== 'skip' || !it.conflicts.length);
    const replaced = onConflict === 'replace' ? [...new Map(items.flatMap((it) => it.conflicts).map((c) => [c.schedule_id, c])).values()] : [];
    const kept = existing.filter((e) => !replaced.some((r) => r.schedule_id === e.schedule_id));
    // Conflicts already shown in the plan aren't repeated as warnings, except with keep_both, where the overlap is confirmed.
    const warnings = warningsFor(toCreate, kept, ctx.staff).filter((w) => onConflict === 'keep_both' || w.kind === 'long' || !toCreate[w.row]?.conflicts.length);
    const result = {
      planned: items.map((it) => ({ user_id: it.user_id, name: ctx.staff.get(it.user_id), shift_date: it.shift_date, start_time: it.start_time, end_time: it.end_time,
        ends_next_day: it.ends_next_day, area: it.area_name, conflicts: it.conflicts.map((c) => describe(c)) })),
      create: toCreate.length, skip: items.length - toCreate.length, replace: replaced.length, warnings,
    };
    if (preview) return { preview: true, ...result };
    requireConfirm(warnings, confirm);
    if (!toCreate.length) return { ...result, batch_id: null, summary: `0 shifts created, ${result.skip} skipped` };
    const summary = `${toCreate.length} shift${toCreate.length === 1 ? '' : 's'} created${result.skip ? `, ${result.skip} skipped` : ''}${replaced.length ? `, ${replaced.length} replaced` : ''}`;
    const [b] = await conn.query('INSERT INTO tbl_schedule_batches (kind, summary, replaced, created_by) VALUES (?, ?, ?, ?)',
      [kind, `${summaryLabel}: ${summary}`, JSON.stringify(replaced), req.user.user_id]);
    for (const r of replaced) await deleteShift(conn, req, r, `; replaced by batch #${b.insertId}`);
    for (const it of toCreate) await insertShift(conn, req, it, b.insertId);
    await logActivityWith(conn, req, `SCHEDULE_BULK_${kind.toUpperCase()} (${summary})`, `Schedule batch #${b.insertId}`);
    return { ...result, batch_id: b.insertId, summary };
  });
}

/** One shift for several staff and/or several days. */
function bulkCreate(req, body) {
  const userIds = (Array.isArray(body?.user_ids) ? body.user_ids : []).map(Number).filter(Number.isInteger);
  const dates = (Array.isArray(body?.dates) ? body.dates : []).map(String).filter((d) => DATE.test(d));
  if (!userIds.length) throw new HttpError(400, 'Choose at least one staff member.');
  if (!dates.length) throw new HttpError(400, 'Choose at least one day.');
  if (userIds.length * dates.length > 200) throw new HttpError(400, 'Up to 200 shifts at once.');
  const base = { start_time: body.start_time, end_time: body.end_time, ends_next_day: body.ends_next_day, area_id: body.area_id, note: body.note };
  const planned = dates.flatMap((d) => userIds.map((u) => ({ ...base, user_id: u, shift_date: d })));
  return applyPlan(req, 'create', planned, { preview: body.preview === true, onConflict: body.on_conflict || 'skip', summaryLabel: 'Add shifts', confirm: body.confirm === true });
}

/** Copy one day to other days, or a whole week to the next week. */
async function copy(req, body) {
  const mode = String(body?.mode || '');
  let pairs;
  if (mode === 'day') {
    const from = String(body.from || '');
    const to = (Array.isArray(body.to_dates) ? body.to_dates : []).map(String).filter((d) => DATE.test(d) && d !== from);
    if (!DATE.test(from) || !to.length) throw new HttpError(400, 'Choose the day to copy and at least one other day.');
    pairs = to.map((d) => [from, d]);
  } else if (mode === 'week') {
    const start = String(body.week_start || '');
    if (!DATE.test(start)) throw new HttpError(400, 'Choose the week to copy.');
    pairs = [...Array(7)].map((_, i) => [addDays(start, i), addDays(start, i + 7)]);
  } else throw new HttpError(400, 'Choose what to copy.');
  const sources = [...new Set(pairs.map(([f]) => f))];
  const [rows] = await pool.query('SELECT user_id, shift_date, start_time, end_time, ends_next_day, area_id, note FROM tbl_staff_schedules WHERE archived_at IS NULL AND shift_date IN (?)', [sources]);
  const planned = pairs.flatMap(([f, t]) => rows.filter((r) => ymd(r.shift_date) === f).map((r) => ({ ...r, shift_date: t, ends_next_day: !!r.ends_next_day })));
  if (!planned.length) throw new HttpError(400, 'There are no shifts to copy.');
  return applyPlan(req, mode === 'day' ? 'copy_day' : 'copy_week', planned, {
    preview: body.preview === true, onConflict: body.on_conflict || 'skip', summaryLabel: mode === 'day' ? 'Copy day' : 'Copy week', confirm: body.confirm === true,
  });
}

/** Undo the Admin's last bulk action (within 30 minutes): its shifts are removed and replaced shifts come back. */
async function undo(req, batchId) {
  return withTransaction(async (conn) => {
    const [[b]] = await conn.query('SELECT * FROM tbl_schedule_batches WHERE batch_id = ? FOR UPDATE', [batchId]);
    if (!b || b.undone_at) throw new HttpError(404, 'Nothing to undo.');
    const [[latest]] = await conn.query('SELECT MAX(batch_id) AS id FROM tbl_schedule_batches WHERE created_by = ? AND undone_at IS NULL', [req.user.user_id]);
    if (b.created_by !== req.user.user_id || latest.id !== b.batch_id) throw new HttpError(409, 'Only your most recent bulk action can be undone.');
    if (Date.now() - new Date(b.created_at).getTime() > UNDO_MINUTES * 60000) throw new HttpError(409, `Undo is available for ${UNDO_MINUTES} minutes after a bulk action.`);
    const [created] = await conn.query('SELECT s.*, a.name AS area_name FROM tbl_staff_schedules s LEFT JOIN tbl_schedule_areas a ON a.area_id = s.area_id WHERE s.batch_id = ?', [batchId]);
    for (const c of created) await deleteShift(conn, req, { ...c, shift_date: ymd(c.shift_date) }, `; undo of batch #${batchId}`);
    const replaced = typeof b.replaced === 'string' ? JSON.parse(b.replaced || '[]') : (b.replaced || []);
    for (const r of replaced) await insertShift(conn, req, { ...r, shift_date: ymd(r.shift_date), start_time: hm(r.start_time), end_time: hm(r.end_time), area_name: r.area_name || r.assignment }, null);
    await conn.query('UPDATE tbl_schedule_batches SET undone_at = NOW() WHERE batch_id = ?', [batchId]);
    await logActivityWith(conn, req, `SCHEDULE_BULK_UNDO (${created.length} removed, ${replaced.length} restored)`, `Schedule batch #${batchId}`);
    return { removed: created.length, restored: replaced.length };
  });
}

module.exports = { areas, activeStaff, saveOne, removeOne, saveDay, bulkCreate, copy, undo, overlaps, validateRow, ymd };
