// Test helpers: module stubs, tiny CBOR + Base45 encoders for synthetic ePhilID QR payloads.
const Module = require('module'); const orig = Module._load;
Module._load = function (r, ...a) {
  if (r === 'jsqr') return require('/home/claude/cozmo/jsqr/dist/jsQR.js');
  if (r === 'sharp') return require('/opt/npm-tools/node_modules/sharp');
  return orig.call(this, r, ...a);
};
const zlib = require('zlib');
function cborEnc(obj) {
  const parts = [];
  const hd = (maj, n) => {
    if (n < 24) parts.push(Buffer.from([(maj << 5) | n]));
    else if (n < 256) parts.push(Buffer.from([(maj << 5) | 24, n]));
    else if (n < 65536) { const b = Buffer.alloc(3); b[0] = (maj << 5) | 25; b.writeUInt16BE(n, 1); parts.push(b); }
    else { const b = Buffer.alloc(5); b[0] = (maj << 5) | 26; b.writeUInt32BE(n, 1); parts.push(b); }
  };
  const w = (v) => {
    if (typeof v === 'string') { const b = Buffer.from(v); hd(3, b.length); parts.push(b); }
    else if (typeof v === 'number') hd(0, v);
    else { const e = Object.entries(v); hd(5, e.length); for (const [k, x] of e) { w(k); w(x); } }
  };
  w(obj); return Buffer.concat(parts);
}
const B45 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ $%*+-./:';
function b45(buf) {
  let s = '';
  for (let i = 0; i < buf.length; i += 2) {
    if (i + 1 < buf.length) { let n = buf[i] * 256 + buf[i + 1]; const c = n % 45; n = (n - c) / 45; const d = n % 45; const e = (n - d) / 45; s += B45[c] + B45[d] + B45[e]; }
    else { const n = buf[i]; s += B45[n % 45] + B45[Math.floor(n / 45)]; }
  }
  return s;
}
const ephilid = (obj) => `PH1:${b45(zlib.deflateSync(cborEnc(obj)))}`;
module.exports = { ephilid, cborEnc, b45 };
