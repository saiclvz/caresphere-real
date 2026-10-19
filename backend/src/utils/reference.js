/**
 * Transfer reference numbers (donor reports, staff verification, statement lines).
 * Normalized: trimmed, upper case, spaces and dashes removed. Only the normalized form is compared and indexed.
 * Logs never hold a full reference or account number: mask() keeps the last 4 characters.
 */
const HttpError = require('./HttpError');

const normalizeReference = (v) => String(v ?? '').trim().toUpperCase().replace(/[\s-]+/g, '');

/** Validates a reference typed by a donor or staff member and returns { raw, norm }. */
function readReference(v, field = 'Reference number') {
  const raw = String(v ?? '').trim().replace(/\s+/g, ' ');
  if (!raw) throw new HttpError(422, `${field} is required.`, { errors: { reference: `${field} is required.` } });
  if (raw.length > 60) throw new HttpError(422, `${field} is too long.`, { errors: { reference: 'Up to 60 characters.' } });
  const norm = normalizeReference(raw);
  if (!/^[A-Z0-9]{4,40}$/.test(norm)) {
    throw new HttpError(422, `${field}: use the letters and numbers shown in your app (4 to 40).`, { errors: { reference: 'Use only the letters and numbers shown in your app (4 to 40).' } });
  }
  return { raw, norm };
}

/** "****1234": for logs, notifications and lists without the Donor directory duty. */
function mask(v) {
  const s = String(v ?? '').replace(/\s+/g, '');
  if (!s) return '';
  return `****${s.slice(-4)}`;
}

module.exports = { normalizeReference, readReference, mask };
