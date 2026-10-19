const { src } = require('./helpers');
const test = require('node:test');
const assert = require('node:assert/strict');
const claims = src('services/donationClaims');
const { compare, readSentAt, separationProblem, pick, DONOR_FIELDS } = claims._internal;

test('only whitelisted donor fields are read (no mass assignment)', () => {
  const got = pick({ amount: '1', status: 'Verified', verified_amount: 9, claim_status: 'Verified', donor_id: 2, receipt_issued: true, reference: 'X' }, DONOR_FIELDS);
  assert.deepEqual(Object.keys(got).sort(), ['amount', 'reference']);
});

test('verification compares reference, date and amount with the report', () => {
  const d = { reference_norm: 'ABC123456', sent_at: '2026-10-10 14:30:00', reported_amount: '300.00' };
  assert.deepEqual(compare(d, { reference: 'abc-123 456', received_on: '2026-10-10', cents: 30000 }), { reference: true, date: true, amount: true });
  assert.equal(compare(d, { reference: 'ABC123457', received_on: '2026-10-10', cents: 30000 }).reference, false);
  assert.equal(compare(d, { reference: 'ABC123456', received_on: '2026-10-09', cents: 30000 }).date, false, 'before it was sent');
  assert.equal(compare(d, { reference: 'ABC123456', received_on: '2026-10-13', cents: 30000 }).date, true, 'within 3 days');
  assert.equal(compare(d, { reference: 'ABC123456', received_on: '2026-10-14', cents: 30000 }).date, false, 'too late');
  assert.equal(compare(d, { reference: 'ABC123456', received_on: '2026-10-10', cents: 28000 }).amount, false);
});

test('time sent: not in the future, not older than the limit', () => {
  const pad = (n) => String(n).padStart(2, '0');
  const fmt = (x) => `${x.getFullYear()}-${pad(x.getMonth() + 1)}-${pad(x.getDate())}T${pad(x.getHours())}:${pad(x.getMinutes())}`;
  assert.ok(readSentAt(fmt(new Date(Date.now() - 3600000)), 60));
  assert.throws(() => readSentAt(fmt(new Date(Date.now() + 3 * 3600000)), 60), (e) => e.status === 422);
  assert.throws(() => readSentAt(fmt(new Date(Date.now() - 61 * 86400000)), 60), (e) => e.status === 422);
  assert.throws(() => readSentAt('2026-02-31T10:00', 60), (e) => e.status === 422);
});

test('segregation of duties: nobody verifies what they reported or recorded', () => {
  assert.ok(separationProblem({ user_id: 5 }, { donor_id: 5 }));
  assert.ok(separationProblem({ user_id: 2 }, { recorded_by: 2 }));
  assert.equal(separationProblem({ user_id: 3 }, { donor_id: 5, recorded_by: 2 }), null);
});

test('who may verify: Admin, or Staff with Donations and cash verification', () => {
  assert.equal(claims.canVerify({ role: 'Admin' }), true);
  assert.equal(claims.canVerify({ role: 'Staff', duties: ['donations', 'cash_verification'] }), true);
  assert.equal(claims.canVerify({ role: 'Staff', duties: ['donations'] }), false);
  assert.equal(claims.canVerify({ role: 'Donor' }), false);
});
