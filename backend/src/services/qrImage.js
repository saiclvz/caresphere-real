/**
 * Payment QR images (Settings > Payment QR).
 *  - Content check: PNG or JPG by file signature, at most 1 MB, at most 4000 x 4000 pixels.
 *  - Decoded on this server (jsQR). An image that doesn't decode is refused.
 *  - QR Ph: a payload in the EMVCo merchant-presented format (tags "00".."63", CRC16 in tag 63) is parsed; the
 *    merchant / account name (tag 59) is compared with the account name typed by the Admin (masked names such as
 *    "JU*N D*** C." from GCash and Maya are compared letter by letter, with * matching any letter).
 *  - Re-encoded as PNG with sharp, which drops EXIF, GPS and other metadata. Only this re-encoded copy is stored
 *    (encrypted, random name) and shown to donors. No third-party QR generator, hotlink or external URL is used.
 */
const crypto = require('crypto');
const HttpError = require('../utils/HttpError');

const MAX_BYTES = 1024 * 1024;
const MAX_SIDE = 4000;

function readImage(file) {
  if (!file || typeof file.data !== 'string' || !file.data) throw new HttpError(422, 'Choose the QR image (PNG or JPG).', { errors: { image: 'Choose the QR image.' } });
  const base64 = file.data.includes(',') ? file.data.slice(file.data.indexOf(',') + 1) : file.data;
  const buf = Buffer.from(base64, 'base64');
  if (!buf.length) throw new HttpError(422, 'The image is empty.', { errors: { image: 'The image is empty.' } });
  if (buf.length > MAX_BYTES) throw new HttpError(422, 'The QR image must be 1 MB or smaller.', { errors: { image: 'Up to 1 MB.' } });
  const png = buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  const jpg = buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
  if (!png && !jpg) throw new HttpError(422, 'Only PNG or JPG images are accepted.', { errors: { image: 'PNG or JPG only.' } });
  return buf;
}

// ---------------------------------------------------------------- EMV / QR Ph
/** CRC-16/CCITT-FALSE (poly 0x1021, init 0xFFFF), as EMVCo specifies for tag 63. */
function crc16(str) {
  let crc = 0xffff;
  for (const byte of Buffer.from(str, 'utf8')) {
    crc ^= byte << 8;
    for (let i = 0; i < 8; i += 1) crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}

/** "000201..." -> [{ tag, value }] or null when it isn't valid TLV. */
function tlv(s) {
  const out = [];
  let i = 0;
  while (i < s.length) {
    if (i + 4 > s.length) return null;
    const tag = s.slice(i, i + 2); const len = Number(s.slice(i + 2, i + 4));
    if (!/^\d{2}$/.test(tag) || !/^\d{2}$/.test(s.slice(i + 2, i + 4)) || i + 4 + len > s.length) return null;
    out.push({ tag, value: s.slice(i + 4, i + 4 + len) });
    i += 4 + len;
  }
  return out;
}

/**
 * Parses an EMV merchant-presented payload. Returns { valid, crc_ok, name, city, country, currency, accounts } or
 * null when the text isn't EMV at all.
 */
function parseEmv(text) {
  const s = String(text || '');
  if (!s.startsWith('000201')) return null;
  const fields = tlv(s);
  if (!fields) return { valid: false, crc_ok: false };
  const get = (t) => fields.find((f) => f.tag === t)?.value || null;
  const crcField = get('63');
  const crcOk = !!crcField && s.endsWith(`6304${crcField}`) && crc16(s.slice(0, -4)) === crcField.toUpperCase();
  const accounts = fields.filter((f) => Number(f.tag) >= 26 && Number(f.tag) <= 51).map((f) => {
    const sub = tlv(f.value) || [];
    return { tag: f.tag, guid: sub.find((x) => x.tag === '00')?.value || null, fields: sub.filter((x) => x.tag !== '00').map((x) => x.tag) };
  });
  return { valid: true, crc_ok: crcOk, name: get('59'), city: get('60'), country: get('58'), currency: get('53'), accounts };
}

const letters = (v) => String(v || '').toUpperCase().replace(/[^A-Z0-9*]+/g, ' ').trim().split(/\s+/).filter(Boolean);
/**
 * True when a QR name (possibly masked with *) fits the account name: same number of words or fewer, and each QR word
 * matches the start of the corresponding account word letter by letter, * matching anything.
 */
function namesMatch(qrName, accountName) {
  const q = letters(qrName); const a = letters(accountName).map((w) => w.replace(/\*/g, ''));
  if (!q.length || !a.length) return false;
  let j = 0;
  for (const w of q) {
    let ok = false;
    while (j < a.length && !ok) {
      const target = a[j]; const word = w.replace(/\.$/, '');
      ok = word.length <= target.length + 0 && [...word].every((c, k) => c === '*' || c === target[k]);
      if (!ok && word.length === 1) ok = target[0] === word; // initials, e.g. "C."
      j += 1;
    }
    if (!ok) return false;
  }
  return true;
}

// ---------------------------------------------------------------- decode and re-encode
async function decodeAndClean(buf) {
  const sharp = require('sharp');
  let meta;
  try { meta = await sharp(buf).metadata(); } catch { throw new HttpError(422, "The image couldn't be read. Upload the QR as PNG or JPG.", { errors: { image: "The image couldn't be read." } }); }
  if (!meta.width || !meta.height || meta.width > MAX_SIDE || meta.height > MAX_SIDE) throw new HttpError(422, `The image must be at most ${MAX_SIDE} x ${MAX_SIDE} pixels.`, { errors: { image: 'The image is too large.' } });
  // Re-encode: rotation applied, metadata dropped (sharp keeps none unless asked).
  const clean = await sharp(buf).rotate().png({ compressionLevel: 9 }).toBuffer();
  const jsQR = require('jsqr');
  let text = null;
  for (const width of [Math.min(meta.width, 1200), 800, 500]) {
    // Always 4 channels (RGBA), whatever the source (greyscale or palette PNGs would otherwise give 1 or 2).
    const { data, info } = await sharp(clean).resize({ width, withoutEnlargement: true }).toColourspace('srgb').ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    if (info.channels !== 4) continue;
    const r = jsQR(new Uint8ClampedArray(data.buffer, data.byteOffset, data.length), info.width, info.height, { inversionAttempts: 'attemptBoth' });
    if (r?.data) { text = r.data; break; }
  }
  if (!text) throw new HttpError(422, "No QR code could be read from this image. Upload a clear image of the home's official QR.", { errors: { image: 'No QR code could be read.' } });
  if (text.length > 2000) throw new HttpError(422, 'This QR code holds too much data to be a payment QR.', { errors: { image: 'Not a payment QR.' } });
  if (/^(https?:|www\.)/i.test(text.trim())) throw new HttpError(422, 'This QR code is a web link, not a payment QR. Upload the QR from the e-wallet or bank app.', { errors: { image: 'A web link, not a payment QR.' } });
  const emv = parseEmv(text);
  if (emv && (!emv.valid || !emv.crc_ok)) throw new HttpError(422, 'This QR Ph code is damaged (its check digits are wrong). Download the QR again from the e-wallet or bank app.', { errors: { image: 'Damaged QR Ph code.' } });
  return { clean, text, emv, sha256: crypto.createHash('sha256').update(clean).digest('hex'), payloadSha256: crypto.createHash('sha256').update(text).digest('hex') };
}

module.exports = { readImage, decodeAndClean, parseEmv, crc16, namesMatch, MAX_BYTES };
