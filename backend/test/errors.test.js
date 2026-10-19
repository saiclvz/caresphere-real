const { src } = require('./helpers');
const test = require('node:test');
const assert = require('node:assert/strict');
const { errorHandler } = src('middleware/errorHandler');

test('errors: no database message or stack trace to the client; numbers masked in the log', () => {
  const logged = [];
  const orig = console.error; console.error = (...a) => logged.push(a.join(' '));
  let body; let status;
  const res = { status(s) { status = s; return this; }, json(b) { body = b; } };
  const err = Object.assign(new Error("ER_BAD_FIELD: Unknown column 'x' near '09171234567'"), { code: 'ER_BAD_FIELD_ERROR', sql: 'SELECT secret' });
  errorHandler(err, { method: 'GET', originalUrl: '/api/donations/123?q=ABC1234567' }, res, () => {});
  console.error = orig;
  assert.equal(status, 500);
  assert.doesNotMatch(body.message, /Unknown column|ER_|SELECT/);
  assert.doesNotMatch(logged.join('\n'), /09171234567|SELECT secret|ABC1234567/);
});
