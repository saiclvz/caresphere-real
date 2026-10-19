require('./helpers');
const test = require('node:test');
const assert = require('node:assert/strict');
const { plan } = require('../scripts/mapLegacyPayments');

test('legacy payment mapping table', () => {
  assert.deepEqual(plan({ gateway: 'paymongo', status: 'paid' }), { mapped_as: 'Verified', counted: true, claim: 'Verified' });
  for (const s of ['pending', 'failed', 'cancelled', 'expired']) assert.equal(plan({ gateway: 'paymongo', status: s }).mapped_as, 'Cancelled (legacy)');
  assert.equal(plan({ gateway: 'manual', status: 'pending_verification' }).claim, 'Reported');
  assert.equal(plan({ gateway: 'manual', status: 'confirmed' }).counted, true);
  assert.equal(plan({ gateway: 'manual', status: 'rejected' }).claim, 'Not matched');
});
