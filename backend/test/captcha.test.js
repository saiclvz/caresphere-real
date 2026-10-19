const { src } = require('./helpers');
const test = require('node:test');
const assert = require('node:assert/strict');
const captcha = src('services/captcha');

test('the check question: right answer once, for that user only', () => {
  const c = captcha.challenge(5);
  const [a, b] = c.question.match(/\d+/g).map(Number);
  assert.throws(() => captcha.check(5, c.token, String(a + b + 1)), (e) => e.status === 422);
  assert.throws(() => captcha.check(6, c.token, String(a + b)), (e) => e.status === 422);
  captcha.check(5, c.token, String(a + b));
  assert.throws(() => captcha.check(5, c.token, String(a + b)), (e) => e.status === 422, 'replay refused');
});
