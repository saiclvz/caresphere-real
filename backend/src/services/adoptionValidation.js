/**
 * Server-side checks for the 9-page application, from config/adoptionForm.js.
 *  - clean():        what a draft autosave may store (trimmed, length-capped, valid options only).
 *                    It never rejects a half-filled page, so autosave always works.
 *  - validatePage(): the "Next" check for one page (required, formats), visible fields only.
 *  - validateSubmission(): every page plus required documents, before Submit is accepted.
 */
const { FIELDS, DOCUMENTS, PAGES, OTHER_CITY, isVisible, isRequired } = require('../config/adoptionForm');
const { PROVINCES, CITY_LISTS } = require('../config/phAddress');
const { isEmail, ageOn, localToday } = require('../utils/validate');

const PH_MOBILE = /^(09\d{9}|\+639\d{9}|639\d{9})$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const str = (v) => (v === undefined || v === null ? '' : String(v).trim());

function validDate(v) {
  if (!DATE.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}

/** Household rows: drops empty rows, caps lengths. */
function cleanHousehold(rows) {
  if (!Array.isArray(rows)) return [];
  return rows.slice(0, FIELDS.household_members.maxRows).map((r) => {
    const age = str(r?.age);
    return {
      full_name: str(r?.full_name).slice(0, 150),
      age: /^\d{1,3}$/.test(age) && Number(age) <= 120 ? Number(age) : (age ? age.slice(0, 3) : ''),
      relationship: str(r?.relationship).slice(0, 60),
    };
  }).filter((r) => r.full_name || r.relationship || r.age !== '');
}

/**
 * Cleans a draft payload. Unknown keys are ignored; invalid options become empty.
 * Returns only the keys that were sent, so a page autosave doesn't wipe other pages.
 */
function clean(input) {
  const out = {};
  if (!input || typeof input !== 'object') return out;
  for (const [key, def] of Object.entries(FIELDS)) {
    if (!(key in input)) continue;
    const v = input[key];
    switch (def.type) {
      case 'household': out[key] = cleanHousehold(v); break;
      case 'select': out[key] = def.options.includes(str(v)) ? str(v) : ''; break;
      case 'province': out[key] = PROVINCES.includes(str(v)) ? str(v) : ''; break;
      case 'date': out[key] = validDate(str(v)) ? str(v) : ''; break;
      case 'zip': out[key] = str(v).replace(/\D/g, '').slice(0, 4); break;
      case 'phone': out[key] = str(v).slice(0, 30); break;
      default: out[key] = str(v).slice(0, def.max || 5000);
    }
  }
  if ('city_other' in input) out.city_other = str(input.city_other).slice(0, 100);
  return out;
}

function checkField(key, def, data) {
  const v = data[key];
  const label = def.label;
  if (def.type === 'household') {
    const rows = Array.isArray(v) ? v : [];
    for (let i = 0; i < rows.length; i += 1) {
      const r = rows[i];
      if (!str(r.full_name)) return `Household member ${i + 1}: name is required.`;
      if (!/^\d{1,3}$/.test(str(r.age)) || Number(r.age) > 120) return `Household member ${i + 1}: enter an age from 0 to 120.`;
      if (!str(r.relationship)) return `Household member ${i + 1}: relationship to you is required.`;
    }
    return null;
  }
  if (def.type === 'city') {
    const province = str(data.province);
    if (!province) return 'Select a province first.';
    const list = CITY_LISTS[province];
    if (list) {
      if (!str(v)) return `${label} is required.`;
      if (v === OTHER_CITY) return str(data.city_other) ? null : 'Type the municipality or city.';
      return list.includes(v) ? null : 'Choose a municipality or city from the list.';
    }
    return str(v) ? null : `${label} is required.`;
  }
  if (!str(v)) return isRequired(def, data) ? `${label} ${/(details|members|conditions)$/i.test(label) ? 'are' : 'is'} required.` : null;
  switch (def.type) {
    case 'email': return isEmail(str(v)) ? null : 'Enter a valid email address.';
    case 'phone': return PH_MOBILE.test(str(v).replace(/[\s-]/g, '')) ? null : 'Enter a PH mobile number like 0917 123 4567.';
    case 'zip': return /^\d{4}$/.test(str(v)) ? null : 'Enter a 4-digit ZIP code.';
    case 'select': return def.options.includes(v) ? null : `Choose a ${label.toLowerCase()} from the list.`;
    case 'province': return PROVINCES.includes(v) ? null : 'Choose a province from the list.';
    case 'date': {
      if (!validDate(str(v))) return `Enter a valid ${label.toLowerCase()}.`;
      if (v > localToday()) return `${label} cannot be in the future.`;
      if (def.minAge && ageOn(v) < def.minAge) return `Applicants must be at least ${def.minAge} years old.`;
      return null;
    }
    default: return null;
  }
}

/** The "Next" check for one page. Returns { field: message } for visible fields only. */
function validatePage(page, data) {
  const errors = {};
  for (const [key, def] of Object.entries(FIELDS)) {
    if (def.page !== page || !isVisible(def, data)) continue;
    const msg = checkField(key, def, data);
    if (msg) errors[key] = msg;
  }
  return errors;
}

/** Required, visible document types that have no uploaded file yet. */
function missingDocuments(data, documents) {
  const have = new Set(documents.filter((d) => d.status !== 'Replaced').map((d) => d.doc_type));
  return Object.entries(DOCUMENTS)
    .filter(([key, def]) => def.required && isVisible(def, data) && !have.has(key))
    .map(([key, def]) => ({ doc_type: key, label: def.label, page: def.page }));
}

/** Full check before Submit: every page's fields, required documents and consent. */
function validateSubmission(data, documents, consent) {
  const pages = {};
  for (const p of PAGES) {
    const e = validatePage(p.n, data);
    if (Object.keys(e).length) pages[p.n] = e;
  }
  const missing = missingDocuments(data, documents);
  const consentError = consent === true ? null : 'Tick the declaration and consent box to submit.';
  return { ok: !Object.keys(pages).length && !missing.length && !consentError, pages, missing_documents: missing, consent: consentError };
}

module.exports = { clean, validatePage, missingDocuments, validateSubmission };
