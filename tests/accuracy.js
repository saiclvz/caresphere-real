// OCR accuracy on the synthetic specimen set: printed fields read by OCR vs the values used to draw them.
const r = require('./results.json');
const ana = { full_name: 'ANA SANTOS DELA CRUZ', date_of_birth: '1988-03-14' };
const T = {
  'philid_front_good.jpg as front (PhilSys National ID)': { ...ana, id_number: '1234-5678-9012-3456', address: '12 MABINI ST, BRGY 5, QUEZON CITY' },
  'philid_front_upsidedown.jpg as front (PhilSys National ID)': { ...ana, id_number: '1234-5678-9012-3456', address: '12 MABINI ST, BRGY 5, QUEZON CITY' },
  'philid_front_screenshot.png as front (PhilSys National ID)': { ...ana, id_number: '1234-5678-9012-3456', address: '12 MABINI ST, BRGY 5, QUEZON CITY' },
  'philid_front_mismatch.jpg as front (PhilSys National ID)': { full_name: 'ANNA SANTOS DELA CRUZ', date_of_birth: '1988-03-15', id_number: '1234-5678-9012-3456', address: '12 MABINI ST, BRGY 5, QUEZON CITY' },
  'philid_front_dark.jpg as front (PhilSys National ID)': { ...ana, id_number: '1234-5678-9012-3456', address: '12 MABINI ST, BRGY 5, QUEZON CITY' },
  'philid_front_glare.jpg as front (PhilSys National ID)': { ...ana, id_number: '1234-5678-9012-3456', address: '12 MABINI ST, BRGY 5, QUEZON CITY' },
  'philid_front_blurry.jpg as front (PhilSys National ID)': { ...ana, id_number: '1234-5678-9012-3456', address: '12 MABINI ST, BRGY 5, QUEZON CITY' },
  'philid_front_cropped.jpg as front (PhilSys National ID)': { ...ana, id_number: '1234-5678-9012-3456', address: '12 MABINI ST, BRGY 5, QUEZON CITY' },
  'philid_back_good.jpg as back (PhilSys National ID)': { date_issued: '2023-06-01' },
  'philid_back_qr_mismatch.jpg as back (PhilSys National ID)': { date_issued: '2023-06-01' },
  'passport_good.jpg as front (Passport)': { ...ana, id_number: 'P1234567A', date_issued: '2022-01-10', expiry_date: '2032-01-09' },
  'passport_mrz_broken.jpg as front (Passport)': { ...ana, id_number: 'P1234567A', date_issued: '2022-01-10', expiry_date: '2032-01-09' },
  'passport_expired.jpg as front (Passport)': { ...ana, id_number: 'P1234567A', date_issued: '2022-01-10', expiry_date: '2020-01-09' },
  "license_good.jpg as front (Driver's license)": { ...ana, id_number: 'N01-23-456789', expiry_date: '2029-03-14' },
  "license_bad_number.jpg as front (Driver's license)": { ...ana, id_number: 'N0123-45', expiry_date: '2029-03-14' },
};
const norm = (k, v) => String(v || '').toUpperCase().replace(/\s+/g, ' ').trim();
const words = (s) => norm('', s).split(/[ ,]+/).filter(Boolean).sort().join(' ');
const same = (k, a, b) => (k === 'full_name' ? words(a) === words(b) : norm(k, a) === norm(k, b));
const tally = {}; const per = []; const GOOD = /good|upsidedown|screenshot|mismatch|expired|mrz_broken|bad_number|qr_mismatch/;
for (const [key, truth] of Object.entries(T)) {
  const got = r[key]?.fields || {};
  const quality = GOOD.test(key) ? 'clear' : 'poor';
  for (const [f, v] of Object.entries(truth)) {
    const ok = same(f, got[f], v);
    tally[f] = tally[f] || { clear: [0, 0], poor: [0, 0] };
    tally[f][quality][1] += 1; if (ok) tally[f][quality][0] += 1;
    if (!ok) per.push(`${key} · ${f}: expected "${v}", read "${got[f] ?? '(nothing)'}"`);
  }
}
console.log('Field | Clear photos | Poor photos (dark, glare, blurry, cropped)');
let c0 = 0, c1 = 0;
for (const [f, t] of Object.entries(tally)) { c0 += t.clear[0]; c1 += t.clear[1]; console.log(`${f} | ${t.clear[0]}/${t.clear[1]} | ${t.poor[1] ? `${t.poor[0]}/${t.poor[1]}` : '-'}`); }
console.log(`ALL clear | ${c0}/${c1} = ${Math.round((c0 / c1) * 100)}%`);
console.log('\nMisses:\n' + per.join('\n'));
