const { src } = require('./helpers');
const test = require('node:test');
const assert = require('node:assert/strict');
const { makeReceiptCode } = src('services/donationService');
const { hmac } = src('utils/crypto');
const env = src('config/env');

test('receipt verification code: long, random, signed, separate from the sequential numbers', () => {
  const a = makeReceiptCode(); const b = makeReceiptCode();
  assert.notEqual(a, b);
  assert.match(a, /^CSR-[0-9A-F]{30}\.[A-Za-z0-9_-]{16}$/);
  const [base, sig] = a.split('.');
  assert.equal(sig, hmac(base, env.receiptKey).slice(0, 16));
  assert.ok(a.length <= 64);
});
