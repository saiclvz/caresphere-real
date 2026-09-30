/** Reads a File into { name, type, size, data } where data is base64, after checking type and size. */
export const MB = 1024 * 1024;

const EXT = { 'application/pdf': 'PDF', 'image/png': 'PNG', 'image/jpeg': 'JPG' };

export function checkFile(file, { types, maxBytes }) {
  if (!file) return 'Choose a file.';
  if (!types.includes(file.type)) return `Only ${types.map((t) => EXT[t] || t).join(', ')} files are accepted.`;
  if (file.size > maxBytes) return `The file is larger than ${Math.round(maxBytes / MB)} MB.`;
  if (file.size === 0) return 'The file is empty.';
  return null;
}

export function readFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve({ name: file.name, type: file.type, size: file.size, data: String(reader.result) });
    reader.onerror = () => reject(new Error('The file could not be read.'));
    reader.readAsDataURL(file);
  });
}

/** RFC 4122 v4 UUID. crypto.randomUUID needs HTTPS; getRandomValues also works on plain-HTTP LAN addresses. */
export function uuid() {
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/** Whole years between a YYYY-MM-DD date of birth and today (local time). */
export function ageFromDob(dob, today = new Date()) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dob || '')) return null;
  const [y, m, d] = dob.split('-').map(Number);
  let age = today.getFullYear() - y;
  if (today.getMonth() + 1 < m || (today.getMonth() + 1 === m && today.getDate() < d)) age -= 1;
  return age;
}
