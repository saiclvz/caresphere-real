const { src } = require('./helpers');
const test = require('node:test');
const assert = require('node:assert/strict');
const { csvCells, readDate, readLines } = src('services/reconciliation')._internal;

test('statement CSV: quoted cells, common headers and date formats', () => {
  assert.deepEqual(csvCells('"Oct 3, 2026","REF ""1""",1,234.00'), ['Oct 3, 2026', 'REF "1"', '1', '234.00']);
  assert.equal(readDate('2026-10-03'), '2026-10-03');
  assert.equal(readDate('10/03/2026'), '2026-10-03');
  assert.equal(readDate('03-Oct-2026'), '2026-10-03');
  assert.equal(readDate('yesterday'), null);
  const lines = readLines({ csv: 'Transaction Date,Reference No.,Credit\n2026-10-03,ABC-123 456,"250.00"\n' }, '2026-10');
  assert.equal(lines[0].ref.norm, 'ABC123456'); assert.equal(lines[0].cents, 25000);
});

test('statement CSV: a bad line stops the whole import', () => {
  assert.throws(() => readLines({ csv: 'Date,Reference,Amount\n2026-09-30,ABC1234,10\n' }, '2026-10'), (e) => e.status === 422 && e.details.line_errors.length === 1);
  assert.throws(() => readLines({ csv: 'Date,Reference,Amount\n2026-10-01,ABC1234,-10\n' }, '2026-10'), (e) => e.status === 422);
  assert.throws(() => readLines({ csv: 'When,What\n1,2\n' }, '2026-10'), (e) => e.status === 422);
});
