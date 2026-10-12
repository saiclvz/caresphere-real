/**
 * Settings > ID types and scanning rules (Admin). The rules live in tbl_id_type_rules, so a type can be
 * added or fixed without redeploying: number format (a regular expression), required fields per side,
 * date formats, expiry, which side has a QR code or MRZ, and the verification adapter.
 */
const { pool } = require('../config/db');
const HttpError = require('../utils/HttpError');
const { logActivity } = require('../utils/audit');
const IdTypes = require('../services/idTypes');
const Adapters = require('../services/verificationAdapters');

const FIELDS = ['full_name', 'date_of_birth', 'id_number', 'address', 'date_issued', 'expiry_date'];
const list = (v, name, allowed = null) => {
  if (v == null || v === '') return [];
  const arr = Array.isArray(v) ? v : String(v).split(',');
  const out = [...new Set(arr.map((x) => String(x).trim()).filter(Boolean))];
  if (allowed && out.some((x) => !allowed.includes(x))) throw new HttpError(400, `${name}: use only ${allowed.join(', ')}.`);
  if (out.some((x) => x.length > 80) || out.length > 20) throw new HttpError(400, `${name}: up to 20 items of 80 characters.`);
  return out;
};

/** GET /api/id-types (Admin) */
exports.list = async (req, res) => {
  const all = await IdTypes.all({ includeInactive: true });
  res.json({ success: true, data: { types: all.map((t) => ({ ...t, numberRegex: undefined, number_regex: t.numberRegexSource })), adapters: Adapters.KEYS.map((k) => ({ key: k, label: Adapters.labelOf(k) })), fields: FIELDS } });
};

/** PUT /api/id-types/:key (Admin) - create or update one ID type rule. */
exports.save = async (req, res) => {
  const key = String(req.params.key || '').trim();
  if (!key || key.length > 60) throw new HttpError(400, 'Enter the ID type name (up to 60 characters).');
  const b = req.body || {};
  const label = String(b.label || key).trim().slice(0, 80);
  const regex = b.number_regex ? String(b.number_regex).trim() : null;
  if (regex) { try { new RegExp(regex); } catch { throw new HttpError(400, 'The number format is not a valid regular expression.'); } }
  if (regex && regex.length > 255) throw new HttpError(400, 'The number format is too long.');
  const machine = ['none', 'qr', 'mrz'].includes(b.machine) ? b.machine : 'none';
  const machineSide = ['front', 'back'].includes(b.machine_side) ? b.machine_side : 'back';
  const adapter = Adapters.KEYS.includes(b.adapter) ? b.adapter : 'manual';
  const row = [key, label, regex, b.number_example ? String(b.number_example).slice(0, 80) : null, b.expires ? 1 : 0, b.needs_back === false ? 0 : 1,
    JSON.stringify(list(b.front_fields, 'Front fields', FIELDS)), JSON.stringify(list(b.back_fields, 'Back fields', FIELDS)),
    JSON.stringify(list(b.front_keywords, 'Front keywords')), JSON.stringify(list(b.back_keywords, 'Back keywords')), JSON.stringify(list(b.date_formats, 'Date formats')),
    machine, machineSide, adapter, b.active === false ? 0 : 1, req.user.user_id];
  const [[existing]] = await pool.query('SELECT type_key FROM tbl_id_type_rules WHERE type_key = ?', [key]);
  await pool.query(
    `INSERT INTO tbl_id_type_rules (type_key, label, number_regex, number_example, expires, needs_back, front_fields, back_fields, front_keywords, back_keywords, date_formats,
       machine_readable, machine_side, adapter, active, updated_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE label = VALUES(label), number_regex = VALUES(number_regex), number_example = VALUES(number_example), expires = VALUES(expires),
       needs_back = VALUES(needs_back), front_fields = VALUES(front_fields), back_fields = VALUES(back_fields), front_keywords = VALUES(front_keywords),
       back_keywords = VALUES(back_keywords), date_formats = VALUES(date_formats), machine_readable = VALUES(machine_readable), machine_side = VALUES(machine_side),
       adapter = VALUES(adapter), active = VALUES(active), updated_by = VALUES(updated_by)`, row);
  IdTypes.invalidate();
  await logActivity(req, `${existing ? 'UPDATE' : 'CREATE'}_ID_TYPE_RULE (${key})`, 'ID types');
  res.json({ success: true, data: await IdTypes.get(key) });
};
