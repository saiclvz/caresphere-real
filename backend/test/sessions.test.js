const { src, setPool, has } = require('./helpers');
const test = require('node:test');
const assert = require('node:assert/strict');
const cookies = src('utils/sessionCookies');

test('session cookie is HttpOnly + SameSite=Strict; CSRF cookie is readable and bound to the session', () => {
  const headers = {};
  const res = { setHeader: (k, v) => { headers[k] = v; } };
  const csrf = cookies.setSession({ headers: {} }, res, 'jwt-value', 'jti-1', 3600);
  const [sess, xsrf] = headers['Set-Cookie'];
  assert.match(sess, /^cs_session=jwt-value; Path=\/api; Max-Age=3600; SameSite=Strict; HttpOnly$/);
  assert.match(xsrf, /^cs_csrf=/); assert.doesNotMatch(xsrf, /HttpOnly/);
  assert.equal(csrf, cookies.csrfFor('jti-1'));
  assert.notEqual(cookies.csrfFor('jti-1'), cookies.csrfFor('jti-2'));
  process.env.COOKIE_SECURE = 'true';
  cookies.setSession({ headers: {} }, res, 'v', 'j', 60);
  assert.match(headers['Set-Cookie'][0], /Secure/);
  delete process.env.COOKIE_SECURE;
});

test('CSRF: changes need the header; reads do not', () => {
  assert.equal(cookies.csrfOk({ method: 'GET', headers: {} }, 'j'), true);
  assert.equal(cookies.csrfOk({ method: 'POST', headers: {} }, 'j'), false);
  assert.equal(cookies.csrfOk({ method: 'POST', headers: { 'x-csrf-token': 'wrong' } }, 'j'), false);
  assert.equal(cookies.csrfOk({ method: 'POST', headers: { 'x-csrf-token': cookies.csrfFor('j') } }, 'j'), true);
  assert.equal(cookies.csrfOk({ method: 'DELETE', headers: { 'x-csrf-token': cookies.csrfFor('other') } }, 'j'), false);
});

test('authenticate: cookie without CSRF header is refused; temporary password allows only the password change', { skip: !has('jsonwebtoken') && 'jsonwebtoken not installed' }, async () => {
  const jwt = require('jsonwebtoken');
  const env = src('config/env');
  const { authenticate } = src('middleware/auth');
  const token = jwt.sign({ sub: 9, jti: 'abc' }, env.jwtSecret, { issuer: 'caresphere', algorithm: 'HS256', expiresIn: '1h' });
  let mustChange = false;
  setPool(async (sql) => {
    if (/tbl_revoked_tokens/.test(sql)) return [];
    if (/FROM tbl_users u JOIN tbl_roles/.test(sql)) return [{ user_id: 9, full_name: 'T', email: 't@x', is_active: 1, role_name: 'Donor', must_change_password: mustChange, valid_after: null }];
    if (/tbl_session_activity/.test(sql) && /SELECT/.test(sql)) return [{ idle: 0, stale: 0 }];
    return { affectedRows: 1 };
  });
  const run = (req) => new Promise((resolve) => authenticate(req, {}, (err) => resolve(err || null)));
  const base = { headers: { cookie: `cs_session=${token}` }, originalUrl: '/api/donor/history', method: 'POST' };
  assert.equal((await run({ ...base })).csrf, true);
  assert.equal(await run({ ...base, headers: { ...base.headers, 'x-csrf-token': cookies.csrfFor('abc') } }), null);
  assert.equal(await run({ ...base, method: 'GET' }), null);
  mustChange = true;
  assert.equal((await run({ ...base, method: 'GET' })).mustChangePassword, true);
  assert.equal(await run({ ...base, method: 'GET', originalUrl: '/api/auth/me' }), null);
});
