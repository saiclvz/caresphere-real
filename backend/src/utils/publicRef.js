const crypto = require('crypto');

/** Random, non-sequential QR reference: 12 characters, no look-alikes (no 0, O, 1, I, L). */
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
function newPublicRef() {
  let s = '';
  for (let i = 0; i < 12; i += 1) s += ALPHABET[crypto.randomInt(ALPHABET.length)];
  return s;
}
const isPublicRef = (v) => /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{12}$/.test(String(v || ''));
/** Accepts the printed form with dashes or lowercase: k7qm-3xdp-9war */
const normalizePublicRef = (v) => String(v || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
const formatPublicRef = (v) => (v ? v.match(/.{1,4}/g).join('-') : null);

/** Gives every row without a public_ref a new unique one (safe to repeat). */
async function backfill(conn) {
  let n = 0;
  for (const [table, key] of [['tbl_adoption_applications', 'application_id'], ['tbl_children', 'child_id']]) {
    const [rows] = await conn.query(`SELECT ${key} AS id FROM ${table} WHERE public_ref IS NULL`);
    for (const r of rows) {
      for (let attempt = 0; attempt < 5; attempt += 1) {
        try { await conn.query(`UPDATE ${table} SET public_ref = ? WHERE ${key} = ? AND public_ref IS NULL`, [newPublicRef(), r.id]); n += 1; break; } catch (err) {
          if (err.code !== 'ER_DUP_ENTRY') throw err;
        }
      }
    }
  }
  return n;
}

module.exports = { newPublicRef, isPublicRef, normalizePublicRef, formatPublicRef, backfill, ALPHABET };
