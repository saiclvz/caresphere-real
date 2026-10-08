/**
 * Shared list filters for the Visitors and Donations pages.
 * Dates use the server's local calendar (the LAN server's clock is the authority).
 */
const HttpError = require('../utils/HttpError');
const { requireDate } = require('../utils/validate');

const pad = (n) => String(n).padStart(2, '0');
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
function daysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return ymd(d);
}

/** Date presets. Each returns { from, to } (inclusive YYYY-MM-DD) or {} for no date filter. */
const DATE_PRESETS = {
  all: () => ({}),
  today: () => ({ from: daysAgo(0), to: daysAgo(0) }),
  yesterday: () => ({ from: daysAgo(1), to: daysAgo(1) }),
  last7: () => ({ from: daysAgo(6), to: daysAgo(0) }), // today and the 6 days before it
};

/** "Time in" presets (24-hour, inclusive start and end, by minute). */
const TIME_PRESETS = {
  morning: { from: '00:00', to: '11:59' },   // 12:00 AM to 11:59 AM
  afternoon: { from: '12:00', to: '17:59' }, // 12:00 PM to 5:59 PM
  evening: { from: '18:00', to: '23:59' },   // 6:00 PM onward
};

const CLOCK = /^([01]\d|2[0-3]):([0-5]\d)$/;

/**
 * Reads ?date=<preset|custom>&date_from=&date_to= into { from, to }.
 * `defaultPreset` applies when no date is given.
 */
function readDateFilter(query, defaultPreset = 'all') {
  const preset = String(query.date || defaultPreset);
  if (preset === 'custom') {
    const from = query.date_from ? requireDate(query.date_from, 'From date') : undefined;
    const to = query.date_to ? requireDate(query.date_to, 'To date') : undefined;
    if (from && to && from > to) throw new HttpError(400, 'The From date must be on or before the To date.');
    return { from, to };
  }
  // A plain YYYY-MM-DD is still accepted (older links): one day.
  if (/^\d{4}-\d{2}-\d{2}$/.test(preset)) { const d = requireDate(preset, 'Date'); return { from: d, to: d }; }
  const fn = DATE_PRESETS[preset];
  if (!fn) throw new HttpError(400, `Date must be one of: ${[...Object.keys(DATE_PRESETS), 'custom'].join(', ')}`);
  return fn();
}

/** Reads ?time=<preset|custom>&time_from=&time_to= into { from, to } (HH:MM) or {}. */
function readTimeFilter(query) {
  const preset = String(query.time || 'any');
  if (preset === 'any') return {};
  if (preset === 'custom') {
    const from = query.time_from ? String(query.time_from) : undefined;
    const to = query.time_to ? String(query.time_to) : undefined;
    if (from && !CLOCK.test(from)) throw new HttpError(400, 'From time must be a time like 08:30.');
    if (to && !CLOCK.test(to)) throw new HttpError(400, 'To time must be a time like 17:30.');
    return { from, to };
  }
  const p = TIME_PRESETS[preset];
  if (!p) throw new HttpError(400, `Time must be one of: any, ${Object.keys(TIME_PRESETS).join(', ')}, custom`);
  return { ...p };
}

module.exports = { DATE_PRESETS, TIME_PRESETS, readDateFilter, readTimeFilter };
