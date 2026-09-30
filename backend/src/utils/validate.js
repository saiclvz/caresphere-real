const HttpError = require('./HttpError');

const isBlank = (v) => v === undefined || v === null || String(v).trim() === '';

function requireFields(body, fields) {
  const missing = fields.filter((f) => isBlank(body[f]));
  if (missing.length) throw new HttpError(400, `Missing required field(s): ${missing.join(', ')}`);
}

function oneOf(value, allowed, field) {
  if (!allowed.includes(value)) {
    throw new HttpError(400, `${field} must be one of: ${allowed.join(', ')}`);
  }
  return value;
}

function isEmail(v) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(v));
}

function toInt(value, field, { min = -Infinity, max = Infinity } = {}) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < min || n > max) {
    throw new HttpError(400, `${field} must be a whole number${min > -Infinity ? ` of at least ${min}` : ''}.`);
  }
  return n;
}

function toMoney(value, field) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0 || n >= 100000000) {
    throw new HttpError(400, `${field} must be a positive amount below 100,000,000.`);
  }
  return Math.round(n * 100) / 100;
}

function isDate(v) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(v))) return false;
  // Parse as UTC so the round-trip check is not shifted by the server's timezone
  // (e.g. Asia/Manila is UTC+8, which made every date fail).
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}

/** Today's date (YYYY-MM-DD) in the server's local timezone. */
function localToday() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function requireDate(v, field) {
  if (!isDate(v)) throw new HttpError(400, `${field} must be a valid date (YYYY-MM-DD).`);
  return v;
}

function requireTime(v, field) {
  if (!/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/.test(String(v))) {
    throw new HttpError(400, `${field} must be a valid time (HH:MM).`);
  }
  return String(v).length === 5 ? `${v}:00` : v;
}

function trimOrNull(v, max = 5000) {
  if (isBlank(v)) return null;
  const s = String(v).trim();
  if (s.length > max) throw new HttpError(400, `Text is too long (max ${max} characters).`);
  return s;
}

function toBool(v) {
  return v === true || v === 1 || v === '1' || v === 'true';
}

/** Required free text: rejects missing, blank and whitespace-only values. */
function requireText(v, message, max = 5000) {
  if (isBlank(v)) throw new HttpError(400, message);
  const s = String(v).trim();
  if (s.length > max) throw new HttpError(400, `Text is too long (max ${max} characters).`);
  return s;
}

/** Whole years between a YYYY-MM-DD birth date and a YYYY-MM-DD reference date. */
function ageOn(dob, onDate = localToday()) {
  const [by, bm, bd] = dob.split('-').map(Number);
  const [ty, tm, td] = onDate.split('-').map(Number);
  let age = ty - by;
  if (tm < bm || (tm === bm && td < bd)) age -= 1;
  return age;
}

/** Escape % and _ so user input is matched literally inside LIKE. */
function likeParam(v) {
  return `%${String(v).trim().replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

module.exports = {
  requireText, ageOn, likeParam,
  isBlank, requireFields, oneOf, isEmail, toInt, toMoney, isDate,
  requireDate, requireTime, trimOrNull, toBool, localToday,
};
