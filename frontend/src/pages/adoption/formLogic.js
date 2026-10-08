/**
 * Browser copy of the server's adoption form rules. The rules themselves (fields,
 * conditions, documents, address lists) come from GET /api/adoptions/form-config,
 * so this file only applies them. The server checks everything again.
 */
const PH_MOBILE = /^(09\d{9}|\+639\d{9}|639\d{9})$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const str = (v) => (v === undefined || v === null ? '' : String(v).trim());

export const isVisible = (def, data) => !def.when || def.when.in.includes(data?.[def.when.field]);
export function isRequired(def, data) {
  if (!isVisible(def, data)) return false;
  if (def.required) return true;
  return Boolean(def.requiredWhen && def.requiredWhen.in.includes(data?.[def.requiredWhen.field]));
}

function ageOn(dob) {
  const [y, m, d] = dob.split('-').map(Number);
  const now = new Date();
  let age = now.getFullYear() - y;
  if (now.getMonth() + 1 < m || (now.getMonth() + 1 === m && now.getDate() < d)) age -= 1;
  return age;
}
const todayIso = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const required = (label) => `${label} ${/(details|members|conditions)$/i.test(label) ? 'are' : 'is'} required.`;

/** Same messages as the server (services/adoptionValidation.js). */
function checkField(key, def, data, config) {
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
    const list = config.address.city_lists[province];
    if (list) {
      if (!str(v)) return required(label);
      if (v === config.address.other_city) return str(data.city_other) ? null : 'Type the municipality or city.';
      return list.includes(v) ? null : 'Choose a municipality or city from the list.';
    }
    return str(v) ? null : required(label);
  }
  if (!str(v)) return isRequired(def, data) ? required(label) : null;
  switch (def.type) {
    case 'email': return EMAIL.test(str(v)) ? null : 'Enter a valid email address.';
    case 'phone': return PH_MOBILE.test(str(v).replace(/[\s-]/g, '')) ? null : 'Enter a PH mobile number like 0917 123 4567.';
    case 'zip': return /^\d{4}$/.test(str(v)) ? null : 'Enter a 4-digit ZIP code.';
    case 'select': return def.options.includes(v) ? null : `Choose a ${label.toLowerCase()} from the list.`;
    case 'province': return config.address.provinces.includes(v) ? null : 'Choose a province from the list.';
    case 'date':
      if (!DATE.test(str(v))) return `Enter a valid ${label.toLowerCase()}.`;
      if (v > todayIso()) return `${label} cannot be in the future.`;
      if (def.minAge && ageOn(v) < def.minAge) return `Applicants must be at least ${def.minAge} years old.`;
      return null;
    default: return null;
  }
}

/** Visible fields of a page, in the order they are defined. */
export const pageFields = (config, page, data) => Object.entries(config.fields)
  .filter(([, def]) => def.page === page && isVisible(def, data));

/** Visible document types of a page. */
export const pageDocuments = (config, page, data) => Object.entries(config.documents)
  .filter(([, def]) => def.page === page && isVisible(def, data));

/** The "Next" check: { field: message } for the page's visible fields. Uploads never block Next. */
export function validatePage(config, page, data) {
  const errors = {};
  for (const [key, def] of pageFields(config, page, data)) {
    const msg = checkField(key, def, data, config);
    if (msg) errors[key] = msg;
  }
  return errors;
}

/** Done / Missing / Optional for a field, as shown on the review page. */
export function fieldStatus(config, key, def, data) {
  const v = data[key];
  const empty = def.type === 'household' ? !(Array.isArray(v) && v.length) : !str(key === 'city' && v === config.address.other_city ? data.city_other : v);
  if (checkField(key, def, data, config)) return 'Missing';
  if (empty) return isRequired(def, data) ? 'Missing' : 'Optional';
  return 'Done';
}

/** Readable value for the review page. */
export function displayValue(config, key, def, data) {
  const v = data[key];
  if (def.type === 'household') {
    return Array.isArray(v) && v.length ? v.map((m) => `${m.full_name} (${m.age}, ${m.relationship})`).join('; ') : '';
  }
  if (key === 'city' && v === config.address.other_city) return str(data.city_other);
  return str(v);
}

/** Every visible required item still missing, across the 8 answer pages. */
export function missingItems(config, data, documents) {
  const items = [];
  for (const p of config.pages.filter((x) => x.n <= 8)) {
    for (const [key, def] of pageFields(config, p.n, data)) {
      if (fieldStatus(config, key, def, data) === 'Missing') items.push({ page: p.n, key, label: def.label });
    }
    for (const [key, def] of pageDocuments(config, p.n, data)) {
      if (def.required && !documents.some((d) => d.doc_type === key && d.status !== 'Replaced')) items.push({ page: p.n, key, label: def.label, document: true });
    }
  }
  return items;
}

export function formatBytes(n) {
  if (n >= 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  if (n >= 1024) return `${Math.round(n / 1024)} KB`;
  return `${n} B`;
}

/** Decision 2: active = Draft up to Civil registry updated (everything except these). */
export const INACTIVE_STATUSES = ['Declined', 'Withdrawn', 'Closed'];
export const isActiveStatus = (s) => !INACTIVE_STATUSES.includes(s);
/** Statuses after the Order of Adoption (the warm thank-you message is shown from here). */
export const AFTER_ORDER = ['Order of Adoption issued', 'Civil registry updated', 'Closed'];

/** Where a donor's application opens: drafts continue in the form, others show the detail page. */
export const applicationPath = (a) => (a.status === 'Draft' ? `/applications/${a.application_id}/edit` : `/applications/${a.application_id}`);
