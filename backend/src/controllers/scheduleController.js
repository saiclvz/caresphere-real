const { pool } = require('../config/db');
const Schedule = require('../models/scheduleModel');
const S = require('../services/scheduleService');
const HttpError = require('../utils/HttpError');
const { requireDate, toInt } = require('../utils/validate');
const { logActivity } = require('../utils/audit');

const range = (req) => ({ from: requireDate(req.query.from, 'from'), to: requireDate(req.query.to, 'to') });

/** GET /api/schedules?from=&to= (Admin) - the week, with flags and assigned-area icons (no record details). */
exports.list = async (req, res) => {
  const userId = req.query.user_id ? toInt(req.query.user_id, 'user_id', { min: 1 }) : undefined;
  const rows = await Schedule.list({ ...range(req), userId });
  const areas = await Schedule.assignedAreas([...new Set(rows.map((r) => r.user_id))]);
  res.json({ success: true, data: rows.map((r) => ({ ...r, assigned_areas: areas[r.user_id] || null })) });
};

/** GET /api/schedules/mine (Admin, Staff) - the signed-in user's own shifts, read-only. */
exports.mine = async (req, res) => {
  res.json({ success: true, data: await Schedule.list({ ...range(req), userId: req.user.user_id }) });
};

/** POST /api/schedules and PUT /api/schedules/:id (Admin) { user_id, shift_date, start_time, end_time, ends_next_day, area_id, note, confirm } */
exports.create = async (req, res) => {
  const id = await S.saveOne(req, null, req.body || {});
  res.status(201).json({ success: true, data: await Schedule.findById(id) });
};
exports.update = async (req, res) => {
  const id = await S.saveOne(req, toInt(req.params.id, 'id', { min: 1 }), req.body || {});
  res.json({ success: true, data: await Schedule.findById(id) });
};
/** DELETE /api/schedules/:id (Admin) */
exports.remove = async (req, res) => {
  await S.removeOne(req, toInt(req.params.id, 'id', { min: 1 }));
  res.json({ success: true, message: 'Shift deleted.' });
};

/** PUT /api/schedules/day/:date (Admin) { rows: [...], removed: [ids], confirm } - the whole day in one transaction. */
exports.saveDay = async (req, res) => {
  res.json({ success: true, data: await S.saveDay(req, req.params.date, req.body || {}) });
};
/** POST /api/schedules/bulk (Admin) { user_ids, dates, start_time, end_time, ends_next_day, area_id, note, on_conflict, preview, confirm } */
exports.bulk = async (req, res) => {
  res.json({ success: true, data: await S.bulkCreate(req, req.body || {}) });
};
/** POST /api/schedules/copy (Admin) { mode: day|week, from, to_dates | week_start, on_conflict, preview, confirm } */
exports.copy = async (req, res) => {
  res.json({ success: true, data: await S.copy(req, req.body || {}) });
};
/** POST /api/schedules/batches/:id/undo (Admin) - the Admin's most recent bulk action, within 30 minutes. */
exports.undo = async (req, res) => {
  res.json({ success: true, data: await S.undo(req, toInt(req.params.id, 'id', { min: 1 })) });
};

// ---------- areas (Settings) ----------
/** GET /api/schedule-areas (Admin, Staff) */
exports.areas = async (req, res) => { res.json({ success: true, data: await S.areas() }); };

/** POST /api/schedule-areas and PUT /api/schedule-areas/:id (Admin) { name, is_active, sort_order } */
function cleanArea(b) {
  const name = String(b?.name || '').trim().replace(/\s+/g, ' ');
  if (name.length < 2 || name.length > 60) throw new HttpError(400, 'Area name must be 2 to 60 characters.');
  return { name, is_active: b?.is_active === false ? 0 : 1, sort_order: Math.max(0, Math.min(999, Number(b?.sort_order) || 0)) };
}
const dupName = async (name, exceptId = 0) => (await pool.query('SELECT area_id FROM tbl_schedule_areas WHERE LOWER(name) = LOWER(?) AND area_id <> ?', [name, exceptId]))[0].length > 0;
exports.createArea = async (req, res) => {
  const a = cleanArea(req.body);
  if (await dupName(a.name)) throw new HttpError(409, 'That area already exists.');
  await pool.query('INSERT INTO tbl_schedule_areas (name, is_active, sort_order) VALUES (?, ?, ?)', [a.name, a.is_active, a.sort_order]);
  await logActivity(req, `CREATE_SCHEDULE_AREA (${a.name})`, 'Schedule areas');
  res.status(201).json({ success: true, data: await S.areas() });
};
exports.updateArea = async (req, res) => {
  const id = toInt(req.params.id, 'id', { min: 1 });
  const a = cleanArea(req.body);
  const [[old]] = await pool.query('SELECT name FROM tbl_schedule_areas WHERE area_id = ?', [id]);
  if (!old) throw new HttpError(404, 'Area not found.');
  if (await dupName(a.name, id)) throw new HttpError(409, 'That area already exists.');
  await pool.query('UPDATE tbl_schedule_areas SET name = ?, is_active = ?, sort_order = ? WHERE area_id = ?', [a.name, a.is_active, a.sort_order, id]);
  await logActivity(req, `UPDATE_SCHEDULE_AREA (${old.name} -> ${a.name}${a.is_active ? '' : ', hidden'})`, 'Schedule areas');
  res.json({ success: true, data: await S.areas() });
};
/** GET /api/schedule-areas/unmapped (Admin) - shift area texts that match no area, with how many shifts use each. */
exports.unmapped = async (req, res) => {
  const [rows] = await pool.query(
    "SELECT TRIM(assignment) AS text, COUNT(*) AS shifts FROM tbl_staff_schedules WHERE area_id IS NULL GROUP BY TRIM(assignment) ORDER BY shifts DESC");
  res.json({ success: true, data: rows.map((r) => ({ ...r, shifts: Number(r.shifts) })) });
};
/** POST /api/schedule-areas/map (Admin) { text, area_id } - links those shifts to an area. Their original text is kept. */
exports.mapArea = async (req, res) => {
  const text = String(req.body?.text ?? '').trim();
  const areaId = toInt(req.body?.area_id, 'area_id', { min: 1 });
  const [[area]] = await pool.query('SELECT name FROM tbl_schedule_areas WHERE area_id = ?', [areaId]);
  if (!area) throw new HttpError(404, 'Area not found.');
  const [r] = await pool.query('UPDATE tbl_staff_schedules SET area_id = ? WHERE area_id IS NULL AND TRIM(assignment) = ?', [areaId, text]);
  await logActivity(req, `MAP_SCHEDULE_AREA ("${text.slice(0, 60)}" -> ${area.name}, ${r.affectedRows} shifts)`, 'Schedule areas');
  res.json({ success: true, data: { mapped: r.affectedRows } });
};
