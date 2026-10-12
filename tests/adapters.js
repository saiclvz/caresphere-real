// Adapter offline / failed / verified, and PhilSys Check recording (synthetic data only).
const Module = require('module'); const orig = Module._load;
const B = '/tmp/fix/backend/src/';
let providers = { government_id: null, clearance: null, TIMEOUT_MS: 300 };
const rules = { 'PhilSys National ID': { key: 'PhilSys National ID', adapter: 'philsys_check' }, Passport: { key: 'Passport', adapter: 'mrz_consistency' } };
Module._load = function (r, ...a) {
  if (r.endsWith('config/verificationProviders')) return providers;
  if (r.endsWith('config/db')) return { pool: { query: async () => [[]] } };
  if (r.endsWith('config/env')) return new Proxy({}, { get: () => Buffer.alloc(32, 7) });
  if (r === './idTypes' || r.endsWith('services/idTypes')) return { get: async (k) => rules[k] || null, all: async () => Object.values(rules), cachedRule: () => null };
  return orig.call(this, r, ...a);
};
const results = [];
const ok = (name, cond, got) => results.push({ test: name, pass: Boolean(cond), got });
(async () => {
  const Adapters = require(B + 'services/verificationAdapters');
  ok('PhilSys adapter asks for the staff step', (await Adapters.run('philsys_check', {})).status === 'staff_step');
  ok('Passport MRZ adapter is consistency only (never verified)', (await Adapters.run('mrz_consistency', {})).status === 'none');
  ok('Other IDs: manual', (await Adapters.run('manual', {})).status === 'none');
  providers.test_api = { name: 'Test API', verify: () => new Promise(() => {}) };
  let r = await Adapters.run('test_api', {}); ok('Adapter offline (timeout) gives unable, never verified', r.status === 'unable' && r.mode === 'automatic', r.status);
  providers.test_api = { name: 'Test API', verify: async () => { throw new Error('ENOTFOUND'); } };
  r = await Adapters.run('test_api', {}); ok('No internet gives unable', r.status === 'unable', r.status);
  providers.test_api = { name: 'Test API', verify: async () => ({ result: 'weird' }) };
  r = await Adapters.run('test_api', {}); ok('Unexpected answer gives failed', r.status === 'failed', r.status);
  providers.test_api = { name: 'Test API', verify: async () => ({ result: 'verified', reference: 'R-1' }) };
  r = await Adapters.run('test_api', {}); ok('Authorized provider verified', r.status === 'verified' && r.reference === 'R-1', r.status);

  // PhilSys Check recording
  const V = require(B + 'services/verification');
  const mkConn = (row) => { const q = []; return { q, query: async (sql, p) => { q.push([sql.replace(/\s+/g, ' ').slice(0, 60), p]); if (/^SELECT \* FROM tbl_verifications/.test(sql.trim())) return [[row]]; return [{}]; } }; };
  const req = { user: { user_id: 3 } }; const app = { application_id: 5 };
  const base = { verification_id: 9, kind: 'government_id', item_type: 'PhilSys National ID', status: 'Flagged for review', expiry_date: null };
  const run = async (body, row = base) => { const c = mkConn(row); try { const out = await V.recordPhilSysCheck(c, req, app, 9, body); const upd = c.q.find((x) => x[0].startsWith('UPDATE tbl_verifications')); return { out, upd: upd && upd[1] }; } catch (e) { return { err: e.message }; } };
  let x = await run({ result: 'verified', details_match: true, reference: 'PC-77' });
  ok('PhilID verified through PhilSys Check -> Verified, Staff-confirmed, official method', x.out?.to === 'Verified' && x.upd[0] === 'Verified' && x.upd[5] === 'Official verification: PhilSys Check (Staff-confirmed)', x.out || x.err);
  x = await run({ result: 'verified', details_match: false, note: 'Birth date differs' }); ok('PhilSys verified but details differ -> Information mismatch', x.out?.to === 'Information mismatch', x.out || x.err);
  x = await run({ result: 'verified', details_match: false }); ok('Details differ needs a note', /Describe/.test(x.err || ''), x.err);
  x = await run({ result: 'deactivated' }); ok('Deactivated card -> Invalid ID', x.out?.to === 'Invalid ID', x.out || x.err);
  x = await run({ result: 'unreadable' }); ok('QR unreadable -> Unable to verify', x.out?.to === 'Unable to verify', x.out || x.err);
  x = await run({ result: 'verified' }); ok('Verified needs the details question', /match/.test(x.err || ''), x.err);
  x = await run({ result: 'verified', details_match: true }, { ...base, item_type: 'Passport' }); ok('PhilSys Check refused for a passport', /PhilSys National ID only/.test(x.err || ''), x.err);
  x = await run({ result: 'verified', details_match: true }, { ...base, expiry_date: '2020-01-01' }); ok('Expired ID cannot be verified', /expired/.test(x.err || ''), x.err);
  console.log(JSON.stringify(results, null, 1));
  console.log(`${results.filter((r) => r.pass).length}/${results.length} passed`);
})();
