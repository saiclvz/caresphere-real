/**
 * Reads ID fields from OCR text: full name, date of birth, ID number, address, date issued and expiry date.
 * Uses the labels printed on Philippine IDs (English and Filipino). Pure functions (no database), so they
 * can be tested with specimen text. A reading supports the checks; it never proves anything on its own.
 */
const MONTHS = ['JANUARY', 'FEBRUARY', 'MARCH', 'APRIL', 'MAY', 'JUNE', 'JULY', 'AUGUST', 'SEPTEMBER', 'OCTOBER', 'NOVEMBER', 'DECEMBER'];

const upper = (s) => String(s || '').toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
const pad = (n) => String(n).padStart(2, '0');
const validIso = (y, m, d) => {
  const Y = Number(y); const M = Number(m); const D = Number(d);
  const dt = new Date(Date.UTC(Y, M - 1, D));
  return Y > 1900 && Y < 2100 && dt.getUTCFullYear() === Y && dt.getUTCMonth() === M - 1 && dt.getUTCDate() === D ? `${Y}-${pad(M)}-${pad(D)}` : null;
};
const monthNo = (w) => { const i = MONTHS.findIndex((m) => m.startsWith(String(w).slice(0, 3))); return i >= 0 ? i + 1 : null; };

/**
 * Common OCR slips in numbers: the letter O (or Q, D) read for zero, and a zero read twice as "O0"/"0O".
 * Applied only where digits are expected (dates, ID numbers).
 */
function fixDigits(s) {
  return String(s || '').replace(/O(?=0)|(?<=0)O/g, '').replace(/(?<=\d)[OQD]|[OQD](?=\d)/g, '0').replace(/(?<=\d)[Il|](?=\d)/g, '1');
}

/** Every date in a line, as YYYY-MM-DD. Numeric dates are read year-first or month-first (as on PH IDs). */
function datesIn(line) {
  const t = fixDigits(upper(line)).replace(/(\d)\s*([/.-])\s*(\d)/g, '$1$2$3');
  const out = [];
  const add = (iso) => { if (iso && !out.includes(iso)) out.push(iso); };
  for (const m of t.matchAll(/(\d{4})[/.-](\d{1,2})[/.-](\d{1,2})/g)) add(validIso(m[1], m[2], m[3]));
  for (const m of t.matchAll(/(?<!\d)(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})/g)) add(validIso(m[3], m[1], m[2]) || validIso(m[3], m[2], m[1]));
  for (const m of t.matchAll(/([A-Z]{3,9})\.?\s+(\d{1,2}),?\s+(\d{4})/g)) { const n = monthNo(m[1]); if (n) add(validIso(m[3], n, m[2])); }
  for (const m of t.matchAll(/(\d{1,2})\s+([A-Z]{3,9})\.?,?\s+(\d{4})/g)) { const n = monthNo(m[2]); if (n) add(validIso(m[3], n, m[1])); }
  return out;
}

const LABELS = {
  last: /\b(APELYIDO|LAST NAME|SURNAME)\b/,
  given: /\b(MGA PANGALAN|GIVEN NAMES?|FIRST NAME|PANGALAN)\b/,
  middle: /\b(GITNANG APELYIDO|MIDDLE NAME)\b/,
  fullName: /\b(FULL NAME|NAME|LAST NAME,\s*FIRST NAME)\b/,
  dob: /(KAPANGANAKAN|DATE OF BIRTH|BIRTH ?DATE|\bDOB\b|BIRTHDAY)/,
  issued: /(PAGKAKAISYU|DATE OF ISSUE|DATE ISSUED|ISSUE DATE|\bISSUED\b)/,
  expiry: /(EXPIR|VALID UNTIL|VALIDITY|DATE OF EXPIRY)/,
  address: /\b(TIRAHAN|ADDRESS)\b/,
  number: /\b(PCN|CARD NUMBER|LICEN[CS]E NO|PASSPORT NO|CRN|ID NO|ID NUMBER|PIN|REG(ISTRATION)? NO)\b/,
};
const anyLabel = (u) => Object.values(LABELS).some((re) => re.test(u));
const valueAfterLabel = (line) => { const i = line.search(/[:]/); return i >= 0 ? line.slice(i + 1).trim() : ''; };
const nameLike = (s) => /^[A-ZÑ][A-ZÑ .,'-]{1,60}$/.test(upper(s).trim()) && !/\d/.test(s);

/**
 * Extracts fields from OCR lines. rule: the ID type rule (for the number pattern). Returns
 * { full_name, last_name, given_names, middle_name, date_of_birth, id_number, address, date_issued, expiry_date }
 * with null for anything not found.
 */
function extract(text, rule) {
  const lines = String(text || '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const U = lines.map(upper);
  const next = (i) => { for (let j = i + 1; j < Math.min(lines.length, i + 3); j += 1) if (!anyLabel(U[j])) return lines[j]; return ''; };
  const labelled = (re, kind = 'text') => {
    for (let i = 0; i < lines.length; i += 1) {
      if (!re.test(U[i])) continue;
      if (kind === 'date') {
        const same = datesIn(lines[i]); if (same.length) return same[0];
        const n = next(i); const d = n ? datesIn(n) : []; if (d.length) return d[0];
      } else {
        const v = valueAfterLabel(lines[i]); if (v && v.length > 1) return v;
        const n = next(i); if (n) return n;
      }
    }
    return null;
  };
  const clean = (s) => (s ? upper(s).replace(/[^A-ZÑ ,.'-]/g, ' ').replace(/\s+/g, ' ').trim() : null);

  let last = clean(labelled(LABELS.last)); const given = clean(labelled(LABELS.given)); const middle = clean(labelled(LABELS.middle));
  let fullName = null;
  // Driver's license style: "DELA CRUZ, JUAN SANTOS" under "Last Name, First Name, Middle Name".
  const combined = labelled(/LAST NAME,\s*FIRST NAME/);
  let givenNames = given; let middleName = middle;
  if (combined && combined.includes(',')) {
    const [l, rest] = combined.split(','); last = clean(l); fullName = `${clean(rest)} ${clean(l)}`.trim();
    givenNames = clean(rest); middleName = null; // one line holds all the names
  }
  if (!fullName && (last || givenNames)) fullName = [givenNames, middleName, last].filter(Boolean).join(' ');
  if (!fullName) { const n = labelled(LABELS.fullName); if (n && nameLike(n)) fullName = clean(n); }

  // ID number: the type's pattern anywhere in the text (spaces and dashes inside the number allowed).
  let idNumber = null;
  if (rule?.numberRegex) {
    const loose = new RegExp(rule.numberRegex.source.replace(/^\^/, '').replace(/\$$/, ''));
    for (const l of U) {
      const base = [l.replace(/\s+/g, ''), ...l.split(/\s{2,}|[|]/).map((x) => x.replace(/\s+/g, ''))];
      const candidates = [...base, ...base.map(fixDigits)];
      for (const c of candidates) { const m = c.match(loose); if (m) { idNumber = m[0]; break; } }
      if (idNumber) break;
    }
  }
  if (!idNumber) { const n = labelled(LABELS.number); if (n) idNumber = fixDigits(upper(n)).replace(/[^A-Z0-9-]/g, '') || null; }

  return {
    full_name: fullName || null, last_name: last || null, given_names: givenNames || null, middle_name: middleName || null,
    date_of_birth: labelled(LABELS.dob, 'date'), id_number: idNumber,
    address: (() => { const a = labelled(LABELS.address); return a ? a.slice(0, 160) : null; })(),
    date_issued: labelled(LABELS.issued, 'date'), expiry_date: labelled(LABELS.expiry, 'date'),
  };
}

/** Which ID type and side the text points to, using each rule's keywords. */
function identify(text, rules, selectedKey) {
  const t = ` ${upper(text).replace(/[^A-Z0-9' ]/g, ' ').replace(/\s+/g, ' ')} `;
  const has = (words) => (words || []).filter((w) => t.includes(` ${upper(w).replace(/[^A-Z0-9' ]/g, ' ').replace(/\s+/g, ' ').trim()} `)).length;
  let best = null;
  for (const r of rules) {
    const f = has(r.frontKeywords); const b = has(r.backKeywords);
    const score = f + b + (r.key === selectedKey ? 0.5 : 0);
    if ((f || b) && (!best || score > best.score)) best = { key: r.key, side: f >= b ? 'front' : 'back', score, front: f, back: b };
  }
  return best;
}

/** Name comparison: case, accents, spacing, punctuation and word order ignored; middle names optional. */
function sameName(a, b) {
  const words = (s) => upper(s).replace(/[^A-ZÑ ]/g, ' ').split(/\s+/).filter((w) => w.length > 1);
  const A = words(a); const B = words(b);
  if (!A.length || !B.length) return null;
  const [short, long] = A.length <= B.length ? [A, B] : [B, A];
  const hits = short.filter((w) => long.includes(w)).length;
  // Every word of the shorter name must appear in the longer one (so a missing middle name is fine),
  // and at least two words must match (first and last name).
  return hits === short.length && hits >= Math.min(2, short.length);
}

module.exports = { extract, identify, datesIn, sameName, upper, fixDigits };
