const crypto = require('crypto');

/**
 * AES-256-GCM authenticated encryption.
 * Output format: base64url(iv).base64url(authTag).base64url(ciphertext)
 * Tampering with any part makes decryption throw.
 */
function encrypt(plaintext, key) {
  if (plaintext === null || plaintext === undefined || plaintext === '') return null;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv, tag, ciphertext].map((b) => b.toString('base64url')).join('.');
}

function decrypt(payload, key) {
  if (!payload) return null;
  const parts = String(payload).split('.');
  if (parts.length !== 3) throw new Error('Malformed ciphertext');
  const [iv, tag, ciphertext] = parts.map((p) => Buffer.from(p, 'base64url'));
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}

const sha256 = (value) => crypto.createHash('sha256').update(String(value)).digest('hex');

const hmac = (value, key) => crypto.createHmac('sha256', key).update(String(value)).digest('base64url');

/** Constant-time string comparison. */
function safeEqual(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
}

const randomCode = (bytes = 8) => crypto.randomBytes(bytes).toString('hex').toUpperCase();

/** AES-256-GCM for binary files: output = iv(12) | tag(16) | ciphertext. */
function encryptBuffer(buffer, key) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(buffer), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]);
}

function decryptBuffer(payload, key) {
  const iv = payload.subarray(0, 12);
  const tag = payload.subarray(12, 28);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(payload.subarray(28)), decipher.final()]);
}

module.exports = { encrypt, decrypt, encryptBuffer, decryptBuffer, sha256, hmac, safeEqual, randomCode };
