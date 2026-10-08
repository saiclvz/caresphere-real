/**
 * Browser copy of backend/src/utils/passwordPolicy.js (keep the two in step). Drives the live
 * checklist under password fields; the server checks the same rules again.
 */
export const COMMON = new Set([
  'password', 'password1', 'password123', 'passw0rd', 'p@ssw0rd', 'p@ssword1', '12345678', '123456789', '1234567890', '11111111',
  '00000000', 'qwerty123', 'qwertyuiop', 'abc12345', 'abcd1234', 'iloveyou', 'iloveyou1', 'welcome1', 'welcome123', 'admin123',
  'admin@123', 'administrator', 'letmein1', 'sunshine1', 'princess1', 'football1', 'baseball1', 'monkey123', 'dragon123', 'master123',
  'changeme', 'changeme1', 'trustno1', 'superman1', 'batman123', 'starwars1', 'computer1', 'whatever1', 'freedom1', 'qazwsx123',
  'zaq12wsx', '1q2w3e4r', '1qaz2wsx', 'asdfghjkl', 'pilipinas', 'mahalkita', 'caresphere', 'caresphere1', 'caresphere123', 'password!',
]);

/** Returns [{ key, label, ok }] for the checklist. */
export function checks(password, { email = '', name = '' } = {}) {
  const pw = String(password || '');
  const lower = pw.toLowerCase();
  const local = String(email || '').toLowerCase().split('@')[0];
  const parts = String(name || '').toLowerCase().split(/[\s.\-_']+/).filter((p) => p.length >= 3);
  const hasPersonal = (local.length >= 3 && lower.includes(local)) || parts.some((p) => lower.includes(p));
  const plain = lower.replace(/[^a-z0-9]/g, ''); // 'Password1!' -> 'password1'
  return [
    { key: 'length', label: 'At least 8 characters', ok: pw.length >= 8 },
    { key: 'upper', label: 'An uppercase letter', ok: /[A-Z]/.test(pw) },
    { key: 'lower', label: 'A lowercase letter', ok: /[a-z]/.test(pw) },
    { key: 'number', label: 'A number', ok: /\d/.test(pw) },
    { key: 'special', label: 'A special character (for example ! @ # $)', ok: /[^A-Za-z0-9]/.test(pw) },
    { key: 'personal', label: 'Does not contain your name or email', ok: pw.length > 0 && !hasPersonal },
    { key: 'common', label: 'Not a common password', ok: pw.length > 0 && !COMMON.has(lower) && !COMMON.has(plain) },
  ];
}

/** The first rule not met, as a sentence, or null when the password is acceptable. */
export function problem(password, ctx) {
  if (String(password || '').length > 128) return 'Password can be up to 128 characters.';
  const failed = checks(password, ctx).filter((c) => !c.ok);
  if (!failed.length) return null;
  return `Password needs: ${failed.map((c) => c.label.charAt(0).toLowerCase() + c.label.slice(1)).join(', ')}.`;
}

