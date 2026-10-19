const Meal = require('../models/mealModel');
const HttpError = require('../utils/HttpError');
const { requireDate, oneOf, requireText } = require('../utils/validate');
const { logActivity } = require('../utils/audit');

const TYPES = ['Breakfast', 'Lunch', 'Dinner', 'Snack'];

function cleanTags(value) {
  const list = Array.isArray(value) ? value : String(value || '').split(',');
  const tags = [...new Set(list.map((t) => String(t).trim()).filter(Boolean))];
  if (!tags.length) throw new HttpError(400, 'Add at least one dietary tag (for example: Regular, Vegetarian, No nuts).');
  if (tags.length > 10 || tags.some((t) => t.length > 30)) throw new HttpError(400, 'Use up to 10 dietary tags of 30 characters each.');
  return tags.join(', ');
}

function clean(body) {
  if (!body.meal_type) throw new HttpError(400, 'Meal type is required.');
  if (!body.scheduled_date) throw new HttpError(400, 'Scheduled date is required.');
  return {
    meal_type: oneOf(body.meal_type, TYPES, 'Meal type'),
    menu_description: requireText(body.menu_description, 'Description is required.', 2000),
    scheduled_date: requireDate(body.scheduled_date, 'Scheduled date'),
    dietary_tags: cleanTags(body.dietary_tags),
  };
}

exports.list = async (req, res) => {
  const from = requireDate(req.query.from, 'from');
  const to = requireDate(req.query.to, 'to');
  res.json({ success: true, data: await Meal.list({ from, to, search: req.query.q }) });
};

exports.create = async (req, res) => {
  const id = await Meal.create({ ...clean(req.body), logged_by: req.user.user_id });
  await logActivity(req, 'CREATE_MEAL', `Meal #${id}`);
  res.status(201).json({ success: true, data: await Meal.findById(id) });
};

exports.update = async (req, res) => {
  if (!(await Meal.findById(req.params.id))) throw new HttpError(404, 'Meal not found.');
  await Meal.update(req.params.id, { ...clean(req.body), logged_by: req.user.user_id });
  await logActivity(req, 'UPDATE_MEAL', `Meal #${req.params.id}`);
  res.json({ success: true, data: await Meal.findById(req.params.id) });
};

exports.remove = async (req, res) => {
  if (!(await Meal.findById(req.params.id))) throw new HttpError(404, 'Meal not found.');
  const reason = String(req.body?.reason || req.query.reason || '').trim().slice(0, 500) || 'Removed from the meal plan';
  await Meal.archive(req.params.id, req.user.user_id, reason);
  await logActivity(req, 'DELETE_MEAL (archived)', `Meal #${req.params.id}`);
  res.json({ success: true, message: 'Meal removed. It is kept in the archive.' });
};
