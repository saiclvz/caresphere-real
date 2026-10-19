/** Limits for QR donations, read from Settings (tbl_settings) with safe defaults and ranges (config/donationClaims.js). */
const { pool } = require('../config/db');
const { SETTINGS } = require('../config/donationClaims');

async function limits(conn = pool) {
  const [rows] = await conn.query('SELECT setting_key, setting_value FROM tbl_settings WHERE setting_key IN (?)', [Object.keys(SETTINGS)]);
  const got = Object.fromEntries(rows.map((r) => [r.setting_key, r.setting_value]));
  const out = {};
  for (const [k, cfg] of Object.entries(SETTINGS)) {
    const n = Number(got[k]);
    out[k] = Number.isFinite(n) && n >= cfg.min && n <= cfg.max ? n : cfg.def;
  }
  return out;
}

/** Validates one setting value from the Settings form. Returns the cleaned string or throws a message. */
function clean(key, value) {
  const cfg = SETTINGS[key];
  const s = String(value ?? '').trim();
  if (!/^\d{1,9}$/.test(s) || Number(s) < cfg.min || Number(s) > cfg.max) return { error: `${cfg.label}: enter a whole number from ${cfg.min} to ${cfg.max}.` };
  return { value: String(Number(s)) };
}

module.exports = { limits, clean };
