const Visitor = require('../models/visitorModel');
const HttpError = require('../utils/HttpError');
const { requireDate, toBool, requireText } = require('../utils/validate');
const { logActivity } = require('../utils/audit');

// Manual visitor log (no QR passes). Times come from <input type="datetime-local"> in the server's local time.
function localNow() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function cleanTime(value, label) {
  if (value === undefined || value === null || String(value).trim() === '') return null;
  const m = String(value).trim().match(/^(\d{4}-\d{2}-\d{2})[T ](\d{2}):(\d{2})(?::\d{2})?$/);
  if (!m || Number(m[2]) > 23 || Number(m[3]) > 59) throw new HttpError(400, `${label} must be a valid date and time.`);
  requireDate(m[1], label);
  const t = `${m[1]} ${m[2]}:${m[3]}:00`;
  if (t > localNow()) throw new HttpError(400, `${label} cannot be in the future.`);
  return t;
}

function cleanContact(value) {
  const s = requireText(value, 'Contact number is required.', 30);
  if (!/^[+\d][\d\s-]{6,19}$/.test(s)) throw new HttpError(400, 'Enter a valid contact number.');
  return s;
}

exports.list = async (req, res) => {
  const date = req.query.date ? requireDate(req.query.date, 'date') : undefined;
  res.json({ success: true, data: await Visitor.list({ date, openOnly: toBool(req.query.open), search: req.query.q }) });
};

/** POST /api/visitors { visitor_name, contact_number, purpose, check_in_time? } */
exports.checkIn = async (req, res) => {
  const id = await Visitor.create({
    visitor_name: requireText(req.body.visitor_name, 'Visitor name is required.', 100),
    contact_number: cleanContact(req.body.contact_number),
    purpose: requireText(req.body.purpose, 'Purpose of visit is required.', 1000),
    check_in_time: cleanTime(req.body.check_in_time, 'Time in'),
    logged_by: req.user.user_id,
  });
  await logActivity(req, 'VISITOR_CHECK_IN', `Visitor #${id}`);
  res.status(201).json({ success: true, data: await Visitor.findById(id) });
};

/** PUT /api/visitors/:id { visitor_name, contact_number, purpose, check_in_time, check_out_time } */
exports.update = async (req, res) => {
  const visitor = await Visitor.findById(req.params.id);
  if (!visitor) throw new HttpError(404, 'Visitor record not found.');
  const b = req.body;
  const fields = {};
  if (b.visitor_name !== undefined) fields.visitor_name = requireText(b.visitor_name, 'Visitor name is required.', 100);
  if (b.contact_number !== undefined) fields.contact_number = cleanContact(b.contact_number);
  if (b.purpose !== undefined) fields.purpose = requireText(b.purpose, 'Purpose of visit is required.', 1000);
  if (b.check_in_time !== undefined) {
    fields.check_in_time = cleanTime(b.check_in_time, 'Time in');
    if (!fields.check_in_time) throw new HttpError(400, 'Time in is required.');
  }
  if (b.check_out_time !== undefined) fields.check_out_time = cleanTime(b.check_out_time, 'Time out');
  const timeIn = fields.check_in_time || visitor.check_in_time;
  const timeOut = fields.check_out_time !== undefined ? fields.check_out_time : visitor.check_out_time;
  if (timeOut && timeOut < timeIn) throw new HttpError(400, 'Time out cannot be earlier than time in.');
  await Visitor.update(visitor.visitor_id, fields);
  await logActivity(req, 'UPDATE_VISITOR', `Visitor #${visitor.visitor_id}`);
  res.json({ success: true, data: await Visitor.findById(visitor.visitor_id) });
};

/** PUT /api/visitors/:id/check-out { check_out_time? } */
exports.checkOut = async (req, res) => {
  const visitor = await Visitor.findById(req.params.id);
  if (!visitor) throw new HttpError(404, 'Visitor record not found.');
  if (visitor.check_out_time) throw new HttpError(409, 'This visitor has already checked out.');
  const time = cleanTime(req.body?.check_out_time, 'Time out');
  if (time && time < visitor.check_in_time) throw new HttpError(400, 'Time out cannot be earlier than time in.');
  await Visitor.checkOut(visitor.visitor_id, time);
  await logActivity(req, 'VISITOR_CHECK_OUT', `Visitor #${visitor.visitor_id}`);
  res.json({ success: true, data: await Visitor.findById(visitor.visitor_id) });
};

exports.remove = async (req, res) => {
  const visitor = await Visitor.findById(req.params.id);
  if (!visitor) throw new HttpError(404, 'Visitor record not found.');
  await Visitor.remove(req.params.id);
  await logActivity(req, 'DELETE_VISITOR', `Visitor #${req.params.id}`);
  res.json({ success: true, message: 'Visitor record deleted.' });
};
