const { src } = require('./helpers');
const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeReference, readReference, mask } = src('utils/reference');

test('references are normalized before comparing and indexing', () => {
  assert.equal(normalizeReference('  abc-123 456 '), 'ABC123456');
  assert.equal(normalizeReference('ABC123456'), normalizeReference('abc 123-456'));
  assert.deepEqual(readReference('1007 234 567 890').norm, '1007234567890');
});

test('references with symbols, too short or too long are refused', () => {
  for (const bad of ["1'; DROP TABLE x;--", '<script>', 'ab', 'x'.repeat(70), '']) assert.throws(() => readReference(bad), (e) => e.status === 422);
});

test('logs keep only the last 4 characters', () => {
  assert.equal(mask('1007234567890'), '****7890');
  assert.equal(mask(''), '');
});
