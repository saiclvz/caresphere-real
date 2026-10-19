const { src } = require('./helpers');
const test = require('node:test');
const assert = require('node:assert/strict');
const links = src('utils/signedLinks');

test('a signed link works for its user, before it expires', () => {
  const t = links.sign({ kind: 'receipt', id: 12, userId: 5 });
  assert.deepEqual(links.verify(t, { user_id: 5 }), { kind: 'receipt', id: 12 });
});

test('another user, tampering, expiry and junk are all the same 404', () => {
  const t = links.sign({ kind: 'donation_doc', id: 7, userId: 5 });
  const refused = (tok, user = { user_id: 5 }) => assert.throws(() => links.verify(tok, user), (e) => e.status === 404);
  refused(t, { user_id: 6 });
  refused(t.replace('.7.', '.8.'));
  refused(t.replace('donation_doc.', 'receipt.'));
  refused(t.slice(0, -2) + 'xx');
  refused(links.sign({ kind: 'receipt', id: 1, userId: 5, seconds: -1 }));
  refused('../../etc/passwd');
  refused('');
  assert.throws(() => links.sign({ kind: 'anything', id: 1, userId: 1 }));
});
