/**
 * Money: PHP only, two decimals, never floating point for storage or comparison. Amounts are parsed from text into
 * whole centavos (an integer) and written back to the database as a DECIMAL(12,2) string.
 */
const HttpError = require('./HttpError');

const CURRENCY = 'PHP';
const MAX_CENTS = 9999999999; // DECIMAL(12,2) limit: 99,999,999.99

/**
 * '1,234.5' | 1234.5 -> 123450 (centavos). Rejects zero, negatives, more than 2 decimals, exponents, NaN and
 * anything above `max` pesos.
 */
function toCents(value, field = 'Amount', { min = 1, max = 100000 } = {}) {
  const s = typeof value === 'number' ? (Number.isFinite(value) ? String(value) : '') : String(value ?? '').trim().replace(/,/g, '');
  if (!s) throw new HttpError(422, `${field} is required.`, { errors: { amount: `${field} is required.` } });
  if (!/^\d{1,11}(\.\d{1,2})?$/.test(s)) throw new HttpError(422, `${field}: enter an amount in pesos with up to 2 decimals.`, { errors: { amount: 'Enter an amount in pesos with up to 2 decimals.' } });
  const [whole, frac = ''] = s.split('.');
  const cents = Number(whole) * 100 + Number(frac.padEnd(2, '0'));
  if (!Number.isSafeInteger(cents) || cents > MAX_CENTS) throw new HttpError(422, `${field} is too large.`, { errors: { amount: 'The amount is too large.' } });
  if (cents < Math.round(min * 100)) throw new HttpError(422, `${field} must be at least ₱${Number(min).toFixed(2)}.`, { errors: { amount: `The minimum is ₱${Number(min).toFixed(2)}.` } });
  if (cents > Math.round(max * 100)) throw new HttpError(422, `${field} can be at most ₱${Number(max).toLocaleString('en-PH', { minimumFractionDigits: 2 })}.`, { errors: { amount: `The maximum is ₱${Number(max).toLocaleString('en-PH', { minimumFractionDigits: 2 })}.` } });
  return cents;
}

/** 123450 -> '1234.50' (for DECIMAL columns). */
const centsToDecimal = (c) => `${Math.trunc(c / 100)}.${String(Math.abs(c) % 100).padStart(2, '0')}`;
/** A DECIMAL value read from the database ('1234.50', 1234.5) -> 123450. */
function dbToCents(v) {
  if (v === null || v === undefined) return null;
  const s = String(v);
  const m = /^(-?)(\d+)(?:\.(\d{1,2})\d*)?$/.exec(s);
  if (m) return (m[1] ? -1 : 1) * (Number(m[2]) * 100 + Number((m[3] || '').padEnd(2, '0')));
  return Math.round(Number(v) * 100);
}
const formatPeso = (c) => `₱${(c / 100).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

module.exports = { CURRENCY, toCents, centsToDecimal, dbToCents, formatPeso };
