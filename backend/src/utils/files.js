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
/** Width and height of a PNG or JPEG from its header, or null if it can't be read. */
function imageSize(buf) {
  if (buf.length > 24 && buf.readUInt32BE(0) === 0x89504e47) return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
  if (buf.length > 4 && buf[0] === 0xff && buf[1] === 0xd8) {
    let i = 2;
    while (i + 9 < buf.length) {
      if (buf[i] !== 0xff) { i += 1; continue; }
      const marker = buf[i + 1];
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0xff) { i += marker === 0xff ? 1 : 2; continue; }
      const isSof = marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker);
      if (isSof) return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) };
      i += 2 + buf.readUInt16BE(i + 2);
    }
  }
  return null;
}

/**
 * Validates and stores an upload: type by file signature, size, optional square shape
 * (cropped profile photos), random file name, encrypted at rest.
 */
function saveUpload(file, { folder, allowed, maxBytes, label, square = false }) {
  if (!file || typeof file.data !== 'string' || !file.data) throw new HttpError(400, `${label}: choose a file to upload.`);
  const base64 = file.data.includes(',') ? file.data.slice(file.data.indexOf(',') + 1) : file.data;
  const buffer = Buffer.from(base64, 'base64');
  if (!buffer.length) throw new HttpError(400, `${label}: the file is empty.`);
  if (buffer.length > maxBytes) {
    throw new HttpError(400, `${label}: the file is larger than ${Math.round(maxBytes / (1024 * 1024))} MB.`);
  }
  const type = detectType(buffer, allowed);
  if (!type) throw new HttpError(400, `${label}: only ${allowed.map((a) => a.toUpperCase()).join(', ')} files are accepted.`);
  if (square) {
    const dims = imageSize(buffer);
    if (!dims || !dims.width || !dims.height) throw new HttpError(400, `${label}: the image could not be read. Choose another JPG or PNG.`);
    if (Math.abs(dims.width - dims.height) > Math.max(2, Math.round(Math.max(dims.width, dims.height) * 0.01))) {
      throw new HttpError(400, `${label}: crop the photo to a square before uploading.`);
    }
  }

  const dir = path.join(env.uploadDir, folder);
  fs.mkdirSync(dir, { recursive: true });
  const key = `${folder}/${crypto.randomBytes(16).toString('hex')}.${type.ext}.enc`;
  fs.writeFileSync(path.join(env.uploadDir, key), encryptBuffer(buffer, env.phiKey), { mode: 0o600 });

  const original = String(file.name || `upload.${type.ext}`).replace(/[^\w.\- ]+/g, '_').slice(0, 200);
  // SHA-256 of the original file (RA 8792 integrity check: re-hashed when the file is opened).
  const sha256 = crypto.createHash('sha256').update(buffer).digest('hex');
  return { storage_key: key, mime_type: type.mime, size_bytes: buffer.length, original_name: original, sha256 };
}

/** True / false when the stored file still matches its recorded SHA-256; null when no hash was recorded. */
function verifyUpload(key, expectedSha256) {
  if (!expectedSha256) return null;
  try {
    const actual = crypto.createHash('sha256').update(readUpload(key)).digest('hex');
    return actual === expectedSha256;
  } catch {
    return false;
  }
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

/**
 * Secure disposal (Data protection > Archived documents): the stored file is overwritten with random bytes,
 * flushed, then removed. Returns true when a file was removed, false when it was already gone.
 */
function secureDeleteUpload(key) {
  if (!key) return false;
  const full = resolveKey(key);
  let fd;
  try {
    const { size } = fs.statSync(full);
    fd = fs.openSync(full, 'r+');
    const chunk = 64 * 1024;
    for (let pos = 0; pos < size; pos += chunk) fs.writeSync(fd, require('crypto').randomBytes(Math.min(chunk, size - pos)), 0, Math.min(chunk, size - pos), pos);
    fs.fsyncSync(fd);
  } catch (err) {
    if (err.code === 'ENOENT') return false;
    throw err;
  } finally { if (fd !== undefined) fs.closeSync(fd); }
  fs.unlinkSync(full);
  return true;
}

function mimeFromKey(key) {
  if (key.includes('.pdf.')) return 'application/pdf';
  if (key.includes('.png.')) return 'image/png';
  return 'image/jpeg';
}

const MB = 1024 * 1024;

module.exports = {
  imageSize, verifyUpload, saveUpload, readUpload, deleteUpload, secureDeleteUpload, mimeFromKey, MB };
