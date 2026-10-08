/**
 * Short-lived access secrets after a verified unlock (adoption application, child record) or a
 * protected-record token. Kept in memory only: never in localStorage, sessionStorage or a URL,
 * so a page reload, closing the tab or signing out locks everything again. The server decides
 * whether a secret is still valid; the stored expiry only drives the countdown.
 */
const store = new Map();
const key = (kind, id) => `${kind}.${id}`;

export function saveGrant(kind, id, grant, expiresAt, extra = {}) {
  store.set(key(kind, id), { grant, expires_at: expiresAt, ...extra });
  window.dispatchEvent(new CustomEvent('caresphere-unlock', { detail: { kind, id: String(id) } }));
}

export function readGrant(kind, id) {
  const g = store.get(key(kind, id));
  if (!g) return null;
  if (new Date(g.expires_at).getTime() <= Date.now()) { store.delete(key(kind, id)); return null; }
  return g;
}

export function clearGrant(kind, id) {
  store.delete(key(kind, id));
  window.dispatchEvent(new CustomEvent('caresphere-unlock', { detail: { kind, id: String(id) } }));
}

/** Protected-record tokens (Admin-issued, per file). */
export function grantHeaders(kind, id) {
  const g = readGrant(kind, id);
  return g ? { 'X-Protected-Access': g.grant } : {};
}

/** Unlock sessions: kind 'adoption_application' or 'child'. */
export function unlockHeaders(kind, id) {
  const g = readGrant(kind, id);
  return g ? { 'X-Unlock-Session': g.grant } : {};
}

/** Signing out clears everything (the server also ends the sessions). */
export function clearAllGrants() { store.clear(); }
