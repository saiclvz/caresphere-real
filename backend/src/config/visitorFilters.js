/**
 * Meal periods for the Visitors log filter, by time of day (24-hour clock, check-in time).
 * Edit these ranges to match the home's meal schedule. A visit belongs to a period when its
 * time in falls between start and end (inclusive). Times outside every period appear only under All.
 */
const MEAL_PERIODS = {
  breakfast: { label: 'Breakfast', start: '06:00', end: '09:59' },
  lunch: { label: 'Lunch', start: '11:00', end: '13:59' },
  snack: { label: 'Snack', start: '14:00', end: '16:59' },
  dinner: { label: 'Dinner', start: '17:00', end: '20:59' },
};

module.exports = { MEAL_PERIODS };
