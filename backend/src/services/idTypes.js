/**
 * ID type rules (tbl_id_type_rules, edited by Admin in Settings): number format, required fields per side,
 * date formats, expiry, which side carries a QR code or MRZ, and the verification adapter. Cached for a
 * minute. If the table is missing or empty (before migration 027), the built-in list in
 * config/verificationRules.js is used so nothing breaks.
 */
const { pool } = require('../config/db');
const R = require('../config/verificationRules');

const CACHE_MS = 60 * 1000;
let cache = null;
let cachedAt = 0;

const json = (v, fallback) => {
  if (v == null) return fallback;
  if (typeof v !== 'string') return v;
  try { return JSON.parse(v); } catch { return fallback; }
};
const toRegex = (src) => { if (!src) return null; try { return new RegExp(src); } catch { return null; } };

function fromRow(r) {
  return {
    key: r.type_key, label: r.label, numberRegex: toRegex(r.number_regex), numberRegexSource: r.number_regex || null, example: r.number_example,
    expires: !!r.expires, needsBack: !!r.needs_back, frontFields: json(r.front_fields, []), backFields: json(r.back_fields, []),
    frontKeywords: json(r.front_keywords, []), backKeywords: json(r.back_keywords, []), dateFormats: json(r.date_formats, []),
    machine: r.machine_readable || 'none', machineSide: r.machine_side || 'back', adapter: r.adapter || 'manual', active: !!r.active,
  };
}

/** Built-in fallback from the old static list. */
function fallback() {
  return Object.entries(R.ID_TYPES).map(([key, t]) => ({
    key, label: key, numberRegex: t.format || null, numberRegexSource: t.format ? t.format.source : null, example: t.example, expires: !!t.expires,
    needsBack: key !== 'Passport', frontFields: ['full_name', 'date_of_birth'], backFields: [], frontKeywords: t.keywords || [], backKeywords: [],
    dateFormats: [], machine: key === 'Passport' ? 'mrz' : key === 'PhilSys National ID' ? 'qr' : 'none', machineSide: key === 'Passport' ? 'front' : 'back',
    adapter: key === 'PhilSys National ID' ? 'philsys_check' : key === 'Passport' ? 'mrz_consistency' : 'manual', active: true,
  }));
}

/**
 * Keeps the application form in step with the rules: the ID type dropdown lists the active types (plus
 * "Other"), and the ID expiry date is asked for the types that expire. Applied to the shared form config,
 * so the browser and the server's validation see the same list.
 */
function applyToForm(rules) {
  try {
    const { FIELDS, OPTIONS } = require('../config/adoptionForm');
    const active = rules.filter((t) => t.active);
    if (!active.length || !FIELDS?.id_type) return;
    FIELDS.id_type.options = [...active.map((t) => t.key), 'Other'];
    if (OPTIONS) OPTIONS.id_type = FIELDS.id_type.options;
    if (FIELDS.id_expiry?.when && !Array.isArray(FIELDS.id_expiry.when)) FIELDS.id_expiry.when.in = [...active.filter((t) => t.expires).map((t) => t.key), 'Other'];
  } catch { /* the built-in lists stay */ }
}

async function all({ includeInactive = false } = {}) {
  if (!cache || Date.now() - cachedAt > CACHE_MS) {
    try {
      const [rows] = await pool.query('SELECT * FROM tbl_id_type_rules ORDER BY label');
      cache = rows.length ? rows.map(fromRow) : fallback();
    } catch { cache = fallback(); }
    cachedAt = Date.now();
    applyToForm(cache);
  }
  return includeInactive ? cache : cache.filter((t) => t.active);
}

async function get(key) {
  return (await all({ includeInactive: true })).find((t) => t.key === key) || null;
}

function invalidate() { cache = null; }

/** Synchronous read of the last loaded rules (for form validation); null until the cache has been filled once. */
const cachedRule = (key) => (cache ? cache.find((t) => t.key === key) || null : null);

/** The part of a rule the applicant's browser needs (no regex internals beyond the example). */
const publicView = (t) => ({ key: t.key, label: t.label, needs_back: t.needsBack, expires: t.expires, example: t.example, machine: t.machine, machine_side: t.machineSide });

module.exports = { all, get, invalidate, publicView, fromRow, cachedRule };
