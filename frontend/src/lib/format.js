const peso = new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' });

export const formatMoney = (n) => peso.format(Number(n) || 0);

function parse(value) {
  if (!value) return null;
  // MySQL returns "YYYY-MM-DD HH:MM:SS" (local); make it ISO-parseable.
  const d = new Date(String(value).replace(' ', 'T'));
  return Number.isNaN(d.getTime()) ? null : d;
}

export function formatDate(value) {
  const d = parse(value);
  return d ? d.toLocaleDateString('en-PH', { year: 'numeric', month: 'short', day: 'numeric' }) : '—';
}

export function formatDateTime(value) {
  const d = parse(value);
  return d ? d.toLocaleString('en-PH', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—';
}

export function formatTime(value) {
  if (!value) return '—';
  const [h, m] = String(value).split(':').map(Number);
  const d = new Date();
  d.setHours(h, m, 0, 0);
  return d.toLocaleTimeString('en-PH', { hour: 'numeric', minute: '2-digit' });
}

/** Local YYYY-MM-DD (toISOString would shift dates in UTC+8). */
export function isoDate(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function addDays(date, n) {
  const d = new Date(date);
  d.setDate(d.getDate() + n);
  return d;
}

export function startOfWeek(date = new Date()) {
  const d = new Date(date);
  const day = (d.getDay() + 6) % 7; // Monday = 0
  d.setDate(d.getDate() - day);
  d.setHours(0, 0, 0, 0);
  return d;
}

export function ageLabel(dob) {
  const d = parse(dob);
  if (!d) return '—';
  const now = new Date();
  let months = (now.getFullYear() - d.getFullYear()) * 12 + (now.getMonth() - d.getMonth());
  if (now.getDate() < d.getDate()) months -= 1;
  if (months < 12) return `${Math.max(months, 0)} mo`;
  const y = Math.floor(months / 12);
  return `${y} yr${y === 1 ? '' : 's'}`;
}

/** Case-insensitive match of a search string against several fields. */
export function matches(query, ...fields) {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return fields.some((f) => String(f ?? '').toLowerCase().includes(q));
}
