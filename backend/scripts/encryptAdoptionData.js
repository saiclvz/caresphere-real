/**
 * Encrypts sensitive adoption fields that are still plain text (RA 10173).
 * Runs automatically at the end of `npm run migrate`; safe to run again (already encrypted
 * values are skipped). Can also be run alone: node scripts/encryptAdoptionData.js
 */
require('dotenv').config();

const TARGETS = [
  { table: 'tbl_applicant_details', key: 'application_id', columns: ['date_of_birth', 'contact_number', 'house_unit', 'street', 'subdivision', 'barangay',
    'province', 'city', 'postal_code', 'id_type', 'id_type_other', 'living_conditions', 'caregiving_experience'] },
  { table: 'tbl_applicant_spouse', key: 'application_id', columns: ['details'] },
  { table: 'tbl_household_members', key: 'member_id', columns: ['full_name', 'age', 'relationship'] },
  { table: 'tbl_adoption_applications', key: 'application_id', columns: ['reason_for_adoption', 'legacy_address', 'legacy_employment_details',
    'legacy_spouse_details', 'legacy_household_members', 'legacy_living_conditions', 'legacy_caregiving_experience'] },
];

async function run(conn) {
  const { encField, isEncrypted } = require('../src/utils/fieldCrypto');
  let changed = 0;
  for (const t of TARGETS) {
    const [cols] = await conn.query(
      'SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?', [t.table]);
    const present = new Set(cols.map((c) => c.COLUMN_NAME));
    const columns = t.columns.filter((c) => present.has(c));
    if (!columns.length) continue;
    const [rows] = await conn.query(`SELECT ${t.key}, ${columns.join(', ')} FROM ${t.table}`);
    for (const row of rows) {
      const set = {};
      for (const c of columns) {
        const v = row[c];
        if (v === null || v === undefined || v === '') continue;
        const s = v instanceof Date ? v.toISOString().slice(0, 10) : String(v);
        if (!isEncrypted(s)) set[c] = encField(s);
      }
      const keys = Object.keys(set);
      if (!keys.length) continue;
      await conn.query(`UPDATE ${t.table} SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE ${t.key} = ?`, [...keys.map((k) => set[k]), row[t.key]]);
      changed += 1;
    }
  }
  return changed;
}

module.exports = { run };

if (require.main === module) {
  (async () => {
    const mysql = require('mysql2/promise');
    const conn = await mysql.createConnection({
      host: process.env.DB_HOST || '127.0.0.1', port: Number(process.env.DB_PORT) || 3306,
      user: process.env.DB_USER || 'root', password: process.env.DB_PASSWORD || '', database: process.env.DB_NAME || 'caresphere_db',
    });
    try { console.log(`[encrypt] ${await run(conn)} row(s) encrypted.`); } finally { await conn.end(); }
  })().catch((err) => { console.error(`[encrypt] Failed: ${err.message}`); process.exitCode = 1; });
}
