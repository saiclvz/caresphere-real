require('./helpers');
const Module = require('module'); const orig = Module._load;
Module._load = function (r, ...a) {
  if (r.endsWith('config/db')) return { pool: { query: async () => [[]] }, withTransaction: async (f) => f({}) };
  if (r.endsWith('config/env')) return { phiKey: Buffer.alloc(32, 7) };
  if (r.endsWith('utils/fieldCrypto')) return { encField: (v) => v, decField: (v) => v };
  if (r.endsWith('utils/files')) return { readUpload: () => Buffer.alloc(0) };
  return orig.call(this, r, ...a);
};
const fs = require('fs');
const S = require('/tmp/fix/backend/src/services/idScan');
const Ocr = require('/tmp/fix/backend/src/services/idScan/ocr');
Ocr.setEngine(require('./engine'));
const rules = require('./rules');
const R = (k) => rules.find((r) => r.key === k);
const cases = [
  ['philid_front_good.jpg', 'front', 'PhilSys National ID'], ['philid_back_good.jpg', 'back', 'PhilSys National ID'],
  ['philid_front_blurry.jpg', 'front', 'PhilSys National ID'], ['philid_front_dark.jpg', 'front', 'PhilSys National ID'],
  ['philid_front_glare.jpg', 'front', 'PhilSys National ID'], ['philid_front_upsidedown.jpg', 'front', 'PhilSys National ID'],
  ['philid_front_cropped.jpg', 'front', 'PhilSys National ID'], ['philid_back_qr_mismatch.jpg', 'back', 'PhilSys National ID'],
  ['philid_front_screenshot.png', 'front', 'PhilSys National ID'], ['philid_front_mismatch.jpg', 'front', 'PhilSys National ID'],
  ['philid_back_good.jpg', 'front', 'PhilSys National ID'], // back uploaded as front (swapped)
  ['passport_good.jpg', 'front', 'Passport'], ['passport_mrz_broken.jpg', 'front', 'Passport'], ['passport_expired.jpg', 'front', 'Passport'],
  ['license_good.jpg', 'front', "Driver's license"], ['license_bad_number.jpg', 'front', "Driver's license"],
  ['license_good.jpg', 'front', 'PhilSys National ID'], // wrong ID type selected
];
(async () => {
  const out = {};
  for (const [file, side, type] of cases) {
    const t0 = Date.now();
    const buf = fs.readFileSync(`specimens/${file}`);
    const r = await S.analyseSide(buf, file.endsWith('.png') ? 'image/png' : 'image/jpeg', { side, rule: R(type), rules, selectedKey: type });
    const key = `${file} as ${side} (${type})`;
    out[key] = r;
    console.log(`\n== ${key}: ${r.result}  [${Date.now() - t0} ms] type=${r.detected_type} side=${r.detected_side} flags=${r.flags.join(',') || '-'}`);
    r.checks.filter((c) => c.result !== 'pass').forEach((c) => console.log(`   [${c.result}] ${c.check}: ${c.message}`));
    console.log('   fields:', JSON.stringify(r.fields), r.machine.status !== 'not_expected' ? `machine=${r.machine.kind}:${r.machine.status} ${JSON.stringify(r.machine.fields)}` : '', 'q:', JSON.stringify(r.quality));
  }
  fs.writeFileSync('results.json', JSON.stringify(out, null, 1));
})();
