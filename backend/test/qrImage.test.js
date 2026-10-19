const { src } = require('./helpers');
const test = require('node:test');
const assert = require('node:assert/strict');
const { crc16, parseEmv, namesMatch, readImage } = src('services/qrImage');

const f = (t, v) => t + String(v.length).padStart(2, '0') + v;
function emv(name) {
  const p = f('00', '01') + f('01', '11') + f('27', f('00', 'com.p2pqrpay') + f('04', '09171234567')) + f('52', '6016') + f('53', '608') + f('58', 'PH') + f('59', name) + f('60', 'MANILA') + '6304';
  return p + crc16(p);
}

test('QR Ph (EMV) payload: name read, check digits verified', () => {
  const e = parseEmv(emv('JU*N D*** C.'));
  assert.equal(e.valid, true); assert.equal(e.crc_ok, true); assert.equal(e.name, 'JU*N D*** C.'); assert.equal(e.currency, '608');
  const tampered = emv('JU*N D*** C.').slice(0, -4) + '0000';
  assert.equal(parseEmv(tampered).crc_ok, false);
  assert.equal(parseEmv('https://example.com'), null);
});

test('masked QR names are compared with the account name', () => {
  assert.equal(namesMatch('JU*N D*** C.', 'Juan Dela Cruz'), true);
  assert.equal(namesMatch('CARESPHERE CHILD WELFARE', 'CareSphere Child Welfare Home'), true);
  assert.equal(namesMatch('JU*N D*** C.', 'Maria Santos'), false);
  assert.equal(namesMatch('PEDRO PENDUKO', 'CareSphere Child Welfare Home'), false);
});

test('QR images: PNG or JPG only, up to 1 MB', () => {
  assert.throws(() => readImage({ data: Buffer.from('GIF89a').toString('base64') }), (e) => e.status === 422);
  assert.throws(() => readImage({ data: Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(1100000)]).toString('base64') }), (e) => e.status === 422);
  assert.throws(() => readImage(null), (e) => e.status === 422);
});
