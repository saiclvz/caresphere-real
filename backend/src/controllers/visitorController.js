const Visitor = require('../models/visitorModel');
const HttpError = require('../utils/HttpError');
const { pool } = require('../config/db');
const { requireDate, toBool, requireText } = require('../utils/validate');
const { logActivity } = require('../utils/audit');
const { readDateFilter, readTimeFilter } = require('../config/listFilters');
const { MEAL_PERIODS } = require('../config/visitorFilters');
const { readPagination } = require('../utils/pagination');
const { deleteVisit } = require('../services/visitorDonationService');

const TYPES = ['visit', 'donation'];

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

/**
 * GET /api/visitors?date=today|yesterday|last7|all|custom&date_from=&date_to=
 *                  &time=any|morning|afternoon|evening|custom&time_from=&time_to=
 *                  &type=visit|donation&open=1&q=
 * Every filter is combined with AND. Date defaults to today.
 * Returns the rows plus counts per visit type (using every filter except the type).
 */
exports.list = async (req, res) => {
  const q = req.query;
  const dates = readDateFilter(q, 'today');
  const times = readTimeFilter(q);
  const type = q.type ? String(q.type) : undefined;
  if (type && !TYPES.includes(type)) throw new HttpError(400, 'Visit type must be visit or donation.');
  const mealKey = q.meal ? String(q.meal) : 'all';
  if (mealKey !== 'all' && !MEAL_PERIODS[mealKey]) throw new HttpError(400, `Meal must be one of: all, ${Object.keys(MEAL_PERIODS).join(', ')}.`);
  const { rows, counts, pagination } = await Visitor.list({
    dateFrom: dates.from, dateTo: dates.to, timeFrom: times.from, timeTo: times.to, meal: MEAL_PERIODS[mealKey],
    type, openOnly: toBool(q.open), search: q.q, paging: readPagination(q),
  });
  res.json({ success: true, data: rows, counts, ...(pagination ? { pagination: { page: pagination.page, limit: pagination.limit, total: pagination.total, total_pages: pagination.total_pages } } : {}) });
};

/** GET /api/visitors/filter-options - the meal periods (from config/visitorFilters.js) for the filter. */
exports.filterOptions = async (req, res) => {
  res.json({ success: true, data: { meal_periods: Object.entries(MEAL_PERIODS).map(([key, p]) => ({ key, ...p })) } });
};

/**
 * POST /api/visitors { visitor_name, contact_number, purpose, check_in_time? }
 * Only logs the visit. The Visitors page never creates a donation by itself: a donation is
 * recorded through the shared donation form (POST /api/donations with visit_id).
 */
exports.checkIn = async (req, res) => {
  const id = await Visitor.insertWith(pool, {
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
  // Staff can clear "Needs review" when a flagged visit turns out to be a plain visit.
  if (b.needs_review !== undefined) {
    if (toBool(b.needs_review)) throw new HttpError(400, 'A visit can only be marked as reviewed here.');
    fields.needs_review = 0;
  }
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

/**
 * DELETE /api/visitors/:id?donation=keep|void&reason=&note= (Admin)
 * A visit with a donation needs an explicit choice: keep the donation (it stays on the Donations page,
 * unlinked) or void it (with a reason; in-kind stock is reversed). Donations are never deleted.
 */
exports.remove = async (req, res) => {
  const visitor = await Visitor.findById(req.params.id);
  if (!visitor) throw new HttpError(404, 'Visitor record not found.');
  let choice = req.query.donation ? String(req.query.donation) : undefined;
  if (choice === 'remove') choice = 'void'; // older pages
  if (visitor.donation_id && !['keep', 'void'].includes(choice)) {
    throw new HttpError(409, 'This visit has a linked donation. Choose whether to keep or void the donation.', { needs_donation_choice: true });
  }
  const voidBody = { reason: req.query.reason ? String(req.query.reason) : 'Entered by mistake', note: req.query.note ? String(req.query.note).slice(0, 500) : '',
    archive_reason: req.query.archive_reason ? String(req.query.archive_reason).slice(0, 500) : undefined };
  const result = await deleteVisit(req, visitor.visitor_id, choice, voidBody);
  if (result.donationId) {
    await logActivity(req, `DELETE_VISITOR (donation ${choice === 'void' ? 'voided' : 'kept'})`, `Visitor #${visitor.visitor_id}`);
    await logActivity(req, `UNLINK_DONATION (visit #${visitor.visitor_id} deleted${choice === 'void' ? ', donation voided' : ', donation kept'})`, `Donation #${result.donationId}`);
  } else {
    await logActivity(req, 'DELETE_VISITOR', `Visitor #${visitor.visitor_id}`);
  }
  res.json({ success: true, message: result.donationId
    ? (choice === 'void' ? 'Visitor record removed (kept in the archive). The donation was voided and stays on the Donations page.' : 'Visitor record removed (kept in the archive). The donation was kept on the Donations page.')
    : 'Visitor record removed. It is kept in the archive.' });
};
