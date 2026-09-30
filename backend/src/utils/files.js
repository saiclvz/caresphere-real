const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const env = require('../config/env');
const HttpError = require('./HttpError');
const { encryptBuffer, decryptBuffer } = require('./crypto');

/**
 * Encrypted file storage for uploads (child photos, adoption documents).
 * Files arrive as base64 in JSON, are checked by their real content (magic
 * bytes, not just the file name), encrypted with AES-256-GCM using the PHI key,
 * and written under backend/uploads/<folder>/ with random names. They are never
 * served statically: every download goes through an authorised route.
 */
const TYPES = {
  pdf: { mime: 'application/pdf', ext: 'pdf', test: (b) => b.subarray(0, 5).toString('latin1') === '%PDF-' },
  png: { mime: 'image/png', ext: 'png', test: (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  jpg: { mime: 'image/jpeg', ext: 'jpg', test: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
};

function detectType(buffer, allowed) {
  for (const key of allowed) if (TYPES[key].test(buffer)) return TYPES[key];
  return null;
}

/**
 * @param {{data: string, name?: string}} file  base64 (optionally a data: URL)
 * @param {{folder: string, allowed: string[], maxBytes: number, label: string}} opts
 */
function saveUpload(file, { folder, allowed, maxBytes, label }) {
  if (!file || typeof file.data !== 'string' || !file.data) throw new HttpError(400, `${label}: choose a file to upload.`);
  const base64 = file.data.includes(',') ? file.data.slice(file.data.indexOf(',') + 1) : file.data;
  const buffer = Buffer.from(base64, 'base64');
  if (!buffer.length) throw new HttpError(400, `${label}: the file is empty.`);
  if (buffer.length > maxBytes) {
    throw new HttpError(400, `${label}: the file is larger than ${Math.round(maxBytes / (1024 * 1024))} MB.`);
  }
  const type = detectType(buffer, allowed);
  if (!type) throw new HttpError(400, `${label}: only ${allowed.map((a) => a.toUpperCase()).join(', ')} files are accepted.`);

  const dir = path.join(env.uploadDir, folder);
  fs.mkdirSync(dir, { recursive: true });
  const key = `${folder}/${crypto.randomBytes(16).toString('hex')}.${type.ext}.enc`;
  fs.writeFileSync(path.join(env.uploadDir, key), encryptBuffer(buffer, env.phiKey), { mode: 0o600 });

  const original = String(file.name || `upload.${type.ext}`).replace(/[^\w.\- ]+/g, '_').slice(0, 200);
  return { storage_key: key, mime_type: type.mime, size_bytes: buffer.length, original_name: original };
}

function resolveKey(key) {
  const full = path.resolve(env.uploadDir, key);
  if (!full.startsWith(path.resolve(env.uploadDir) + path.sep)) throw new HttpError(400, 'Invalid file reference.');
  return full;
}

function readUpload(key) {
  const full = resolveKey(key);
  if (!fs.existsSync(full)) throw new HttpError(404, 'The file could not be found on the server.');
  return decryptBuffer(fs.readFileSync(full), env.phiKey);
}

function deleteUpload(key) {
  if (!key) return;
  try { fs.unlinkSync(resolveKey(key)); } catch { /* already gone */ }
}

function mimeFromKey(key) {
  if (key.includes('.pdf.')) return 'application/pdf';
  if (key.includes('.png.')) return 'image/png';
  return 'image/jpeg';
}

const MB = 1024 * 1024;

module.exports = { saveUpload, readUpload, deleteUpload, mimeFromKey, MB };
