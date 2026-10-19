const { src } = require('./helpers');
const test = require('node:test');
const assert = require('node:assert/strict');
const { toCents, centsToDecimal, dbToCents } = src('utils/money');

test('amounts: two decimals, PHP, no floats', () => {
  assert.equal(toCents('1'), 100);
  assert.equal(toCents('1,234.5'), 123450);
  assert.equal(toCents('0.30', 'Amount', { min: 0.01 }), 30);
  assert.equal(centsToDecimal(123450), '1234.50');
  assert.equal(dbToCents('1234.50'), 123450);
  assert.equal(dbToCents(19.99), 1999);
});

test('amounts: zero, negative, absurd and malformed are refused', () => {
  for (const bad of ['0', '0.00', '-5', '10.123', '1e3', 'abc', '', ' ', '12..5', 'NaN', 'Infinity']) {
    assert.throws(() => toCents(bad), (e) => e.status === 422, `should refuse ${JSON.stringify(bad)}`);
  }
  assert.throws(() => toCents('100000.01', 'Amount', { max: 100000 }), (e) => e.status === 422);
  assert.throws(() => toCents('99999999999'), (e) => e.status === 422);
  assert.equal(toCents('100000', 'Amount', { max: 100000 }), 10000000);
});
