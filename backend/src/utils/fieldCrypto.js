/**
 * Encryption for sensitive adoption fields at rest (RA 10173). AES-256-GCM with the PHI key.
 * Stored values start with "e1:" so plain values from before encryption can still be read
 * (they are converted by scripts/encryptAdoptionData.js during `npm run migrate`).
 */
const env = require('../config/env');
const { encrypt, decrypt } = require('./crypto');

const PREFIX = 'e1:';

function encField(value) {
  if (value === null || value === undefined || value === '') return null;
  const s = String(value);
  return s.startsWith(PREFIX) ? s : PREFIX + encrypt(s, env.phiKey);
}

function decField(value) {
  if (value === null || value === undefined) return '';
  const s = String(value);
  if (!s.startsWith(PREFIX)) return s; // not converted yet
  try { return decrypt(s.slice(PREFIX.length), env.phiKey); } catch { return ''; }
}

const isEncrypted = (v) => typeof v === 'string' && v.startsWith(PREFIX);

module.exports = { encField, decField, isEncrypted, PREFIX };
