/**
 * Test setup: dummy keys (never real ones), and stand-ins only for what a unit test must not touch: the database
 * pool and, when a package isn't installed on this machine, the package. Each test file requires this first.
 */
const Module = require('module');
const path = require('path');

Object.assign(process.env, {
  DB_HOST: '127.0.0.1', DB_USER: 'test', DB_NAME: 'caresphere_test', JWT_SECRET: 'test-jwt-secret-0123456789abcdef0123456789',
  PHI_ENCRYPTION_KEY: '1'.repeat(64), QR_ENCRYPTION_KEY: '2'.repeat(64), RECEIPT_SIGNING_KEY: '3'.repeat(64), NODE_ENV: 'test',
});

const SRC = path.join(__dirname, '..', 'src');
let fakePool = { query: async () => [[]] };
const fakeDb = {
  get pool() { return fakePool; },
  withTransaction: async (fn) => fn(fakePool),
  verifyConnection: async () => {},
};
const orig = Module._load;
Module._load = function load(request, parent, ...rest) {
  if (request.endsWith('config/db') || request.endsWith('config/db.js')) return fakeDb;
  try { return orig.call(this, request, parent, ...rest); } catch (err) {
    if (err.code !== 'MODULE_NOT_FOUND' || request.startsWith('.') || request.startsWith('/')) throw err;
    if (request === 'dotenv') return { config() {} };
    // A package that isn't installed here: an empty stand-in (tests that need it are skipped by the test itself).
    return new Proxy(function stub() {}, { get: () => () => ({}) });
  }
};

/** Replaces the database pool for the next calls: handler(sql, params) -> rows or { affectedRows }. */
function setPool(handler) {
  fakePool = {
    calls: [],
    async query(sql, params) { this.calls.push([sql, params]); const r = await handler(sql, params); return [r ?? []]; },
  };
  return fakePool;
}

const src = (p) => require(path.join(SRC, p));
const has = (pkg) => { try { require.resolve(pkg); return true; } catch { return false; } };

module.exports = { setPool, src, has };
