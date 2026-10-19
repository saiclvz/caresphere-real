const { src } = require('./helpers');
const test = require('node:test');
const assert = require('node:assert/strict');
const reauth = src('services/reauth');

test('a re-authentication grant is spent once, for its user, session and purpose', async () => {
  const req = { headers: { 'x-reauth': 'grant-1' }, user: { user_id: 1 }, auth: { jti: 's1' } };
  let used = false;
  const conn = { query: async (sql, p) => { const ok = !used && p[1] === 1 && p[2] === 's1' && p[3] === 'payment_qr'; if (ok) used = true; return [{ affectedRows: ok ? 1 : 0 }]; } };
  await reauth.consume(conn, req, 'payment_qr');
  await assert.rejects(reauth.consume(conn, req, 'payment_qr'), (e) => e.status === 401 && e.details.reauth);
  await assert.rejects(reauth.consume(conn, { ...req, headers: {} }, 'payment_qr'), (e) => e.status === 401);
});
