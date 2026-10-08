/**
 * Server-side checks for the 9-page application, from config/adoptionForm.js.
 *  - clean():        what a draft autosave may store (trimmed, length-capped, valid options only).
 *                    It never rejects a half-filled page, so autosave always works.
 *  - validatePage(): the "Next" check for one page (required, formats), visible fields only.
 *  - validateSubmission(): every page plus required documents, before Submit is accepted.
 */
const { FIELDS, DOCUMENTS, PAGES, OTHER_CITY, RETIRED_DOCUMENTS, isVisible, isRequired, answersFor, requirementOf, expiresOn } = require('../config/adoptionForm');
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

const { ID_TYPES, CLEARANCE_KINDS, CLEARANCE_VALID_MONTHS } = require('../config/verificationRules');

/** Clearance rows: holder, kind, reference number, date issued. Drops empty rows, caps lengths. */
function cleanClearances(rows) {
  if (!Array.isArray(rows)) return [];
  return rows.slice(0, FIELDS.clearances.maxRows).map((r) => ({
    holder: str(r?.holder).slice(0, 150),
    kind: CLEARANCE_KINDS.includes(str(r?.kind)) ? str(r.kind) : '',
    number: str(r?.number).toUpperCase().replace(/\s+/g, '').slice(0, 50),
    issue_date: validDate(str(r?.issue_date)) ? str(r.issue_date) : '',
  })).filter((r) => r.holder || r.kind || r.number || r.issue_date);
}

/** The oldest acceptable issue date for a clearance (YYYY-MM-DD). */
function clearanceCutoff() {
  const d = new Date();
  d.setMonth(d.getMonth() - CLEARANCE_VALID_MONTHS);
  return d.toISOString().slice(0, 10);
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
      case 'clearances': out[key] = cleanClearances(v); break;
      case 'idnumber': out[key] = str(v).toUpperCase().replace(/\s+/g, '').slice(0, def.max || 40); break;
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
  if (def.type === 'clearances') {
    const rows = Array.isArray(v) ? v : [];
    const min = data.civil_status === 'Married' ? 2 : 1;
    if (rows.length < min) return min === 2 ? 'Add a clearance for you and one for your spouse.' : 'Add your clearance.';
    const cutoff = clearanceCutoff();
    for (let i = 0; i < rows.length; i += 1) {
      const r = rows[i];
      const n = `Clearance ${i + 1}`;
      if (!str(r.holder)) return `${n}: whose clearance is it?`;
      if (!CLEARANCE_KINDS.includes(r.kind)) return `${n}: choose NBI, police or court clearance.`;
      if (!/^[A-Z0-9-]{4,50}$/.test(str(r.number))) return `${n}: enter the reference number exactly as printed (letters, numbers and dashes).`;
      if (!validDate(str(r.issue_date))) return `${n}: enter the date issued.`;
      if (r.issue_date > localToday()) return `${n}: the date issued cannot be in the future.`;
      if (r.issue_date < cutoff) return `${n}: it must be issued within the last ${CLEARANCE_VALID_MONTHS} months. Please get a new one.`;
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
    case 'idnumber': {
      const rule = ID_TYPES[data.id_type];
      if (!/^[A-Z0-9-]{4,40}$/.test(str(v))) return 'Enter the ID number exactly as printed (letters, numbers and dashes).';
      if (rule?.format && !rule.format.test(str(v))) return `This doesn't look like a ${data.id_type} number${rule.example ? ` (for example ${rule.example})` : ''}. Check the number and the ID type.`;
      return null;
    }
    case 'date': {
      if (!validDate(str(v))) return `Enter a valid ${label.toLowerCase()}.`;
      if (def.future) return v <= localToday() ? 'This ID has expired. Please use an ID that is still valid.' : null;
      if (v > localToday()) return `${label} cannot be in the future.`;
      if (def.minAge && ageOn(v) < def.minAge) return `Applicants must be at least ${def.minAge} years old.`;
      if (key === 'adoptee_dob' && data.application_type === 'Adult' && ageOn(v) < 18) return 'For an adult adoption, the person must be 18 or older.';
      return null;
    }
    default: return null;
  }
}

/** The "Next" check for one page. Returns { field: message } for visible fields only. */
function validatePage(page, form, applicationType) {
  const data = answersFor(form, applicationType);
  const errors = {};
  for (const [key, def] of Object.entries(FIELDS)) {
    if (def.page !== page || !isVisible(def, data)) continue;
    const msg = checkField(key, def, data);
    if (msg) errors[key] = msg;
  }
  return errors;
}

/** Required (or conditional and applicable) document types that have no usable file yet. */
function missingDocuments(form, documents, applicationType) {
  const data = answersFor(form, applicationType);
  const have = new Set(documents.filter((d) => d.status !== 'Replaced' && d.verification_status !== 'Rejected').map((d) => d.doc_type));
  return Object.entries(DOCUMENTS)
    .filter(([key, def]) => def.required && isVisible(def, data) && !have.has(key))
    .map(([key, def]) => ({ doc_type: key, label: def.label, page: def.page }));
}

const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

/**
 * Every document type for this application: its requirement (Required, Conditional, Optional, Not
 * applicable), its files with their verification status and expiry, and one overall status:
 * Not applicable, Pending submission, Submitted, Under validation, Verified, Rejected, Requires
 * correction, Expired or Manual verification required. complete = every Required or Conditional
 * document has a Verified, unexpired file and none waiting for review or correction.
 */
function documentChecklist(form, applicationType, documents, { isLegacy = false } = {}) {
  const data = answersFor(form, applicationType);
  const current = documents.filter((d) => d.status !== 'Replaced');
  const now = today();
  const withExpiry = (d, def) => {
    const exp = expiresOn(def, d.issued_date);
    return { ...d, expires_on: exp, expired: Boolean(exp && exp < now) };
  };
  const items = Object.entries(DOCUMENTS).map(([key, def]) => {
    const requirement = isLegacy && def.required ? 'Optional' : requirementOf(def, data);
    const files = current.filter((d) => d.doc_type === key).map((d) => withExpiry(d, def));
    const usable = files.filter((f) => f.verification_status !== 'Rejected');
    const waiting = usable.find((f) => ['Requires correction', 'Submitted', 'Under validation', 'Manual verification required'].includes(f.verification_status));
    const verified = usable.filter((f) => f.verification_status === 'Verified' && !f.expired);
    let status;
    if (requirement === 'Not applicable' && !files.length) status = 'Not applicable';
    else if (!files.length) status = 'Pending submission';
    else if (usable.some((f) => f.expired)) status = 'Expired';
    else if (usable.some((f) => f.verification_status === 'Requires correction')) status = 'Requires correction';
    else if (!usable.length) status = 'Rejected';
    else if (waiting) status = waiting.verification_status;
    else status = verified.length ? 'Verified' : 'Manual verification required';
    const needed = requirement === 'Required' || requirement === 'Conditional';
    return {
      doc_type: key, label: def.label, page: def.page, multiple: def.multiple, requirement, required: needed, status, files,
      validity_months: def.validity_months || null, issued_label: def.issued_label || null, hint: def.hint || null,
      done: !needed || status === 'Verified',
    };
  }).filter((i) => i.requirement !== 'Not applicable' || i.files.length);
  // Files under removed document types stay visible to staff.
  const retired = current.filter((d) => RETIRED_DOCUMENTS[d.doc_type]);
  const blocking = items.filter((i) => !i.done).map((i) => ({ doc_type: i.doc_type, label: i.label, status: i.status }));
  return {
    items, retired: retired.map((d) => ({ ...d, label: RETIRED_DOCUMENTS[d.doc_type] })),
    summary: { required: items.filter((i) => i.required).length, verified: items.filter((i) => i.required && i.status === 'Verified').length, complete: blocking.length === 0, blocking },
  };
}

/** Full check before Submit: every page's fields, required documents and consent. */
function validateSubmission(data, documents, consent, applicationType) {
  const pages = {};
  for (const p of PAGES) {
    const e = validatePage(p.n, data, applicationType);
    if (Object.keys(e).length) pages[p.n] = e;
  }
  const missing = missingDocuments(data, documents, applicationType);
  const consentError = consent === true ? null : 'Tick the declaration and consent box to submit.';
  return { ok: !Object.keys(pages).length && !missing.length && !consentError, pages, missing_documents: missing, consent: consentError };
}

module.exports = { clean, validatePage, missingDocuments, validateSubmission, documentChecklist };
