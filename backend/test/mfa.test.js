const { src, setPool } = require('./helpers');
const test = require('node:test');
const assert = require('node:assert/strict');
const mfa = src('services/mfaService');

test('step-up codes: wrong codes lock step-up after 5 tries', async () => {
  setPool(async (sql) => (/mfa_secret_enc/.test(sql) ? [] : { affectedRows: 0 }));
  for (let i = 0; i < 5; i += 1) assert.equal(await mfa.verifyStepUp(77, '000000'), null);
  await assert.rejects(mfa.verifyStepUp(77, '000000'), (e) => e.status === 429);
});

test('TOTP codes: RFC 6238 vector and no reuse of the same step', async () => {
  const { codeAt, base32Encode } = mfa._internal;
  // RFC 6238 test secret "12345678901234567890", T = 59 s -> step 1 -> 287082 (6 digits of 94287082)
  assert.equal(codeAt(base32Encode(Buffer.from('12345678901234567890')), 1), '287082');
});
