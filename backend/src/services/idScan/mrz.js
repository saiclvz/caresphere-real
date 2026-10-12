/**
 * Machine Readable Zone (ICAO 9303) for passports (TD3: 2 lines of 44) and ID cards (TD1: 3 lines of 30).
 * Finds the MRZ in OCR text, parses it and checks the check digits. Check digits prove the MRZ is
 * internally consistent; they do NOT prove the passport is genuine.
 */
const VALUES = (c) => (c === '<' ? 0 : /\d/.test(c) ? Number(c) : c.charCodeAt(0) - 55);
const WEIGHTS = [7, 3, 1];
function checkDigit(s) {
  let sum = 0;
  for (let i = 0; i < s.length; i += 1) sum += VALUES(s[i]) * WEIGHTS[i % 3];
  return String(sum % 10);
}

// OCR commonly reads '<' as these, and confuses O/0 and similar in number fields.
const cleanLine = (l) => l.toUpperCase().replace(/[«‹(\[{]/g, '<').replace(/\s+/g, '').replace(/[^A-Z0-9<]/g, '');
const digits = (s) => s.replace(/[OQD]/g, '0').replace(/[IL]/g, '1').replace(/S/g, '5').replace(/B/g, '8').replace(/Z/g, '2');

const yymmdd = (s, { future = false } = {}) => {
  if (!/^\d{6}$/.test(s)) return null;
  const yy = Number(s.slice(0, 2)); const mm = s.slice(2, 4); const dd = s.slice(4, 6);
  const now = new Date().getFullYear() % 100;
  const century = future ? 2000 : (yy > now ? 1900 : 2000);
  const iso = `${century + yy}-${mm}-${dd}`;
  const d = new Date(`${iso}T00:00:00Z`);
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== iso ? null : iso;
};
const names = (field) => {
  const [surname, given = ''] = field.split('<<');
  const clean = (x) => x.split('<').filter(Boolean).join(' ');
  return { surname: clean(surname), given: clean(given) };
};

/** Finds and parses an MRZ in OCR text. Returns null when there is none. */
function parse(text) {
  const lines = String(text || '').split(/\r?\n/).map(cleanLine).filter((l) => l.length >= 28);
  // TD3 (passport): line 1 starts with P, 44 characters each.
  for (let i = 0; i < lines.length - 1; i += 1) {
    const a = lines[i]; const b = lines[i + 1];
    if (/^P[A-Z<]/.test(a) && a.length >= 36 && b.length >= 36) {
      const l1 = a.padEnd(44, '<').slice(0, 44);
      // OCR often miscounts runs of '<' in the optional field: keep the fixed first 28 characters and the
      // final composite digit, and rebuild the 15 characters between them.
      let l2 = b;
      if (b.length !== 44 && b.length >= 30) {
        const tail = b.slice(28, -1).replace(/</g, '');
        l2 = b.slice(0, 28) + (tail ? tail.padEnd(15, '<').slice(0, 15) : '<'.repeat(15)) + b.slice(-1);
      }
      l2 = l2.padEnd(44, '<').slice(0, 44);
      const num = l2.slice(0, 9); const numCd = digits(l2[9]);
      const dob = digits(l2.slice(13, 19)); const dobCd = digits(l2[19]);
      const exp = digits(l2.slice(21, 27)); const expCd = digits(l2[27]);
      const personal = l2.slice(28, 42); const personalCd = digits(l2[42]);
      const composite = l2.slice(0, 10) + dob + digits(l2[19]) + exp + digits(l2[27]) + l2.slice(28, 43);
      // A composite digit OCR couldn't read (the line came out short) is "unknown", not a failure.
      const compositeCd = b.length < 44 && l2[43] === '<' ? null : digits(l2[43]);
      const n = names(l1.slice(5));
      const checks = {
        document_number: checkDigit(num) === numCd,
        date_of_birth: checkDigit(dob) === dobCd,
        expiry_date: checkDigit(exp) === expCd,
        personal_number: personal.replace(/</g, '') === '' ? (personalCd === '<' || personalCd === '0' || checkDigit(personal) === personalCd) : checkDigit(personal) === personalCd,
        composite: compositeCd === null ? null : checkDigit(composite) === compositeCd,
      };
      return {
        format: 'TD3', issuing_country: l1.slice(2, 5).replace(/</g, ''), surname: n.surname, given_names: n.given,
        full_name: [n.given, n.surname].filter(Boolean).join(' '), id_number: num.replace(/</g, ''), nationality: l2.slice(10, 13).replace(/</g, ''),
        date_of_birth: yymmdd(dob), sex: l2[20] === '<' ? null : l2[20], expiry_date: yymmdd(exp, { future: true }),
        checks, valid: Object.values(checks).every((v) => v !== false), complete: Object.values(checks).every((v) => v !== null),
      };
    }
  }
  // TD1 (ID card): three lines of 30, line 1 starts with I, A or C.
  for (let i = 0; i < lines.length - 2; i += 1) {
    const [a, b, c] = [lines[i], lines[i + 1], lines[i + 2]];
    if (/^[IAC][A-Z<]/.test(a) && a.length >= 28 && b.length >= 28 && c.length >= 20) {
      const l1 = a.padEnd(30, '<').slice(0, 30); const l2 = b.padEnd(30, '<').slice(0, 30); const l3 = c.padEnd(30, '<').slice(0, 30);
      const num = l1.slice(5, 14); const dob = digits(l2.slice(0, 6)); const exp = digits(l2.slice(8, 14));
      const composite = l1.slice(5, 30) + dob + digits(l2[6]) + exp + digits(l2[14]) + l2.slice(18, 29);
      const checks = {
        document_number: checkDigit(num) === digits(l1[14]),
        date_of_birth: checkDigit(dob) === digits(l2[6]),
        expiry_date: checkDigit(exp) === digits(l2[14]),
        composite: checkDigit(composite) === digits(l2[29]),
      };
      const n = names(l3);
      return {
        format: 'TD1', issuing_country: l1.slice(2, 5).replace(/</g, ''), surname: n.surname, given_names: n.given,
        full_name: [n.given, n.surname].filter(Boolean).join(' '), id_number: num.replace(/</g, ''), nationality: l2.slice(15, 18).replace(/</g, ''),
        date_of_birth: yymmdd(dob), sex: l2[7] === '<' ? null : l2[7], expiry_date: yymmdd(exp, { future: true }), checks, valid: Object.values(checks).every(Boolean), complete: true,
      };
    }
  }
  return null;
}

module.exports = { parse, checkDigit };
