/**
 * QR codes on the back of an ID (PhilID card, ePhilID). Decodes the QR on this server (jsQR) and reads
 * the holder's details for the consistency checks: name, date of birth and card number.
 *
 * The PhilSys QR carries a digital signature, but the PSA does not publish the key or a verification API
 * for private systems, so the signature is NOT checked here. Decoding a QR proves nothing about whether
 * the ID is genuine; that is what the PhilSys Check step (verify.philsys.gov.ph) is for. The raw QR text
 * is never stored, only the fields read from it.
 *
 * Formats handled (both seen on PhilSys documents; anything else is reported as "not a recognised format"):
 *  - JSON text with a "subject" object (lName, fName, mName, DOB, PCN ...), signed with "alg"/"signature".
 *  - "PH1:" + Base45 + zlib + CBOR (ePhilID).
 */
const zlib = require('zlib');
const jsQR = require('jsqr');

/** Tries to find a QR code in RGBA pixels, at full and half size. Returns the text or null. */
function decode({ data, width, height }) {
  const first = jsQR(data, width, height, { inversionAttempts: 'attemptBoth' });
  if (first?.data) return first.data;
  return null;
}

// ---------------------------------------------------------------- Base45 (RFC 9285)
const B45 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ $%*+-./:';
function base45(str) {
  const out = [];
  for (let i = 0; i < str.length; i += 3) {
    const c = B45.indexOf(str[i]); const d = B45.indexOf(str[i + 1]); const e = i + 2 < str.length ? B45.indexOf(str[i + 2]) : -1;
    if (c < 0 || d < 0 || (i + 2 < str.length && e < 0)) throw new Error('not base45');
    if (e >= 0) { const n = c + d * 45 + e * 2025; out.push(n >> 8, n & 0xff); } else out.push(c + d * 45);
  }
  return Buffer.from(out);
}

// ---------------------------------------------------------------- minimal CBOR (RFC 8949) reader
function cbor(buf) {
  let p = 0;
  const len = (info) => {
    if (info < 24) return info;
    if (info === 24) return buf[p++];
    if (info === 25) { const v = buf.readUInt16BE(p); p += 2; return v; }
    if (info === 26) { const v = buf.readUInt32BE(p); p += 4; return v; }
    if (info === 27) { const v = Number(buf.readBigUInt64BE(p)); p += 8; return v; }
    throw new Error('indefinite lengths are not supported');
  };
  const item = (depth = 0) => {
    if (depth > 32 || p >= buf.length) throw new Error('bad CBOR');
    const b = buf[p++]; const major = b >> 5; const info = b & 31;
    switch (major) {
      case 0: return len(info);
      case 1: return -1 - len(info);
      case 2: { const n = len(info); const v = buf.subarray(p, p + n); p += n; return v; }
      case 3: { const n = len(info); const v = buf.subarray(p, p + n).toString('utf8'); p += n; return v; }
      case 4: { const n = len(info); const a = []; for (let i = 0; i < n; i += 1) a.push(item(depth + 1)); return a; }
      case 5: { const n = len(info); const o = {}; for (let i = 0; i < n; i += 1) { const k = item(depth + 1); o[String(k)] = item(depth + 1); } return o; }
      case 6: { len(info); return item(depth + 1); } // tag: return the tagged value
      case 7: return info === 20 ? false : info === 21 ? true : info === 22 ? null : undefined;
      default: throw new Error('bad CBOR');
    }
  };
  return item();
}

// ---------------------------------------------------------------- field extraction
const KEYS = {
  last: /^(l(ast)?_?name|lname|surname|last)$/i,
  first: /^(f(irst)?_?name|fname|given_?names?|first)$/i,
  middle: /^(m(iddle)?_?name|mname|middle)$/i,
  suffix: /^suffix$/i,
  dob: /^(dob|date_?of_?birth|birth_?date|bd)$/i,
  number: /^(pcn|card_?number|philsys_?card_?number|id_?number)$/i,
};

/** Walks any object/array and collects the first value for each known key. Nested CBOR byte strings are decoded too. */
function collect(node, out = {}, depth = 0) {
  if (depth > 8 || node == null) return out;
  if (Buffer.isBuffer(node)) { try { collect(cbor(node), out, depth + 1); } catch { /* not CBOR */ } return out; }
  if (Array.isArray(node)) { node.forEach((n) => collect(n, out, depth + 1)); return out; }
  if (typeof node !== 'object') return out;
  for (const [k, v] of Object.entries(node)) {
    if (typeof v === 'string' || typeof v === 'number') {
      for (const [field, re] of Object.entries(KEYS)) if (re.test(k) && out[field] == null && String(v).trim()) out[field] = String(v).trim();
      if (/^(signature|sig|alg)$/i.test(k)) out.signed = true;
    } else collect(v, out, depth + 1);
  }
  return out;
}

const MONTHS = ['JANUARY', 'FEBRUARY', 'MARCH', 'APRIL', 'MAY', 'JUNE', 'JULY', 'AUGUST', 'SEPTEMBER', 'OCTOBER', 'NOVEMBER', 'DECEMBER'];
/** Dates in the QR may be "1990-01-02", "1990/01/02", "01/02/1990" or "January 02, 1990". */
function isoDate(s) {
  const t = String(s || '').trim().toUpperCase();
  let m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/.exec(t);
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/.exec(t);
  if (m) return `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`;
  m = /^([A-Z]+)\.?\s+(\d{1,2}),?\s+(\d{4})$/.exec(t);
  if (m) { const i = MONTHS.findIndex((x) => x.startsWith(m[1].slice(0, 3))); if (i >= 0) return `${m[3]}-${String(i + 1).padStart(2, '0')}-${m[2].padStart(2, '0')}`; }
  return null;
}

/**
 * Reads the fields from a QR text. Returns { format, fields: { full_name, date_of_birth, id_number },
 * signature_present, signature_checked: false } or { format: 'unknown' } for other content.
 */
function read(text) {
  const raw = String(text || '');
  let tree = null; let format = 'unknown';
  if (raw.trim().startsWith('{')) { try { tree = JSON.parse(raw); format = 'philsys_json'; } catch { /* not JSON */ } }
  if (!tree && /^PH\d:/.test(raw)) {
    try { tree = cbor(zlib.inflateSync(base45(raw.slice(raw.indexOf(':') + 1)))); format = 'philsys_ephilid'; } catch { format = 'philsys_unreadable'; }
  }
  if (!tree) return { format, fields: {}, signature_present: false, signature_checked: false };
  const c = collect(tree);
  const name = [c.first, c.middle, c.last, c.suffix].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
  const number = c.number && /\d/.test(c.number) && !/[X*]{4}/i.test(c.number) ? c.number : null; // ePhilID QRs may hide part of the number
  return {
    format,
    fields: { full_name: name || null, last_name: c.last || null, first_name: c.first || null, middle_name: c.middle || null, date_of_birth: isoDate(c.dob), id_number: number },
    signature_present: Boolean(c.signed) || format === 'philsys_ephilid',
    signature_checked: false,
  };
}

module.exports = { decode, read, base45, cbor, isoDate };
