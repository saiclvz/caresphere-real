const Schedule = require('../models/scheduleModel');
const User = require('../models/userModel');
const HttpError = require('../utils/HttpError');
const { requireFields, requireDate, requireTime, toInt } = require('../utils/validate');
const { logActivity } = require('../utils/audit');

async function clean(body) {
  requireFields(body, ['user_id', 'shift_date', 'start_time', 'end_time', 'assignment']);
  const userId = toInt(body.user_id, 'user_id', { min: 1 });
  const user = await User.findById(userId);
  if (!user || !['Staff', 'Admin'].includes(user.role)) throw new HttpError(400, 'Shifts can only be assigned to staff or admin accounts.');
  const s = {
    user_id: userId,
    shift_date: requireDate(body.shift_date, 'Shift date'),
    start_time: requireTime(body.start_time, 'Start time'),
    end_time: requireTime(body.end_time, 'End time'),
    assignment: String(body.assignment).trim().slice(0, 150),
  };
  if (s.end_time <= s.start_time) throw new HttpError(400, 'End time must be after start time. Split overnight shifts into two entries.');
  return s;
}

function range(req) {
  return { from: requireDate(req.query.from, 'from'), to: requireDate(req.query.to, 'to') };
}

exports.list = async (req, res) => {
  const userId = req.query.user_id ? toInt(req.query.user_id, 'user_id', { min: 1 }) : undefined;
  res.json({ success: true, data: await Schedule.list({ ...range(req), userId }) });
};

exports.mine = async (req, res) => {
  res.json({ success: true, data: await Schedule.list({ ...range(req), userId: req.user.user_id }) });
};

exports.create = async (req, res) => {
  const s = await clean(req.body);
  if (await Schedule.hasOverlap(s)) throw new HttpError(409, 'This person already has a shift that overlaps these hours.');
  const id = await Schedule.create({ ...s, created_by: req.user.user_id });
  await logActivity(req, 'CREATE_SHIFT', `Schedule #${id}`);
  res.status(201).json({ success: true, data: await Schedule.findById(id) });
};

exports.update = async (req, res) => {
  if (!(await Schedule.findById(req.params.id))) throw new HttpError(404, 'Shift not found.');
  const s = await clean(req.body);
  if (await Schedule.hasOverlap({ ...s, excludeId: req.params.id })) {
    throw new HttpError(409, 'This person already has a shift that overlaps these hours.');
  }
  await Schedule.update(req.params.id, s);
  await logActivity(req, 'UPDATE_SHIFT', `Schedule #${req.params.id}`);
  res.json({ success: true, data: await Schedule.findById(req.params.id) });
};

exports.remove = async (req, res) => {
  if (!(await Schedule.findById(req.params.id))) throw new HttpError(404, 'Shift not found.');
  await Schedule.remove(req.params.id);
  await logActivity(req, 'DELETE_SHIFT', `Schedule #${req.params.id}`);
  res.json({ success: true, message: 'Shift deleted.' });
};
