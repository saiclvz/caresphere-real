import { clearAllGrants } from '../lib/grants';
const ORIGIN = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '');
const BASE = `${ORIGIN}/api`;

/*
 * Sessions are an HttpOnly cookie set by the server at sign-in: this page never sees or stores the session token
 * (nothing in localStorage or sessionStorage). Every change sends the CSRF token from the readable cs_csrf cookie
 * in the X-CSRF-Token header; the server checks it against the session.
 */
let signedIn = false;
let csrfToken = null;
let unauthorizedHandler = null;
const UNSAFE = ['POST', 'PUT', 'PATCH', 'DELETE'];

export class ApiError extends Error {
  constructor(message, status, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

function csrfFromCookie() {
  const m = /(?:^|;\s*)cs_csrf=([^;]+)/.exec(document.cookie || '');
  return m ? decodeURIComponent(m[1]) : null;
}
/** After sign-in (or /auth/me) the page knows it has a session; the token itself stays in the cookie. */
export function setSession(active, csrf) {
  signedIn = Boolean(active);
  csrfToken = active ? csrf || csrfFromCookie() : null;
}
export const hasSession = () => signedIn;
export const onUnauthorized = (fn) => { unauthorizedHandler = fn; };
/** A full URL for a path the server returned (signed file links start with /api/). */
export const absolute = (path) => (path.startsWith('/api/') ? `${ORIGIN}${path}` : `${BASE}${path}`);

export async function api(path, { method = 'GET', body, headers = {}, raw = false, signal } = {}) {
  let res;
  try {
    const csrf = UNSAFE.includes(method) ? csrfFromCookie() || csrfToken : null;
    res = await fetch(absolute(path), {
      method,
      signal,
      credentials: 'include',
      headers: {
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(csrf ? { 'X-CSRF-Token': csrf } : {}),
        ...headers,
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch (err) {
    if (err.name === 'AbortError') throw err;
    throw new ApiError('Cannot reach the CareSphere server. Check that the API is running on the network.', 0);
  }

  if (res.status === 401 && signedIn && unauthorizedHandler && !path.startsWith('/auth/login')) {
    const data = await res.clone().json().catch(() => ({}));
    // Only an expired or revoked sign-in logs the user out. A wrong Token ID,
    // wrong password or expired health access is a normal 401 handled by the page.
    if (data.session) { clearAllGrants(); unauthorizedHandler(); }
  }

  if (raw) {
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new ApiError(data.message || `Request failed (${res.status})`, res.status);
    }
    return res;
  }

  const data = res.status === 204 ? null : await res.json().catch(() => null);
  // A non-JSON 5xx comes from the dev proxy, not the API: the backend is not reachable.
  if (!res.ok && res.status >= 500 && !data) {
    throw new ApiError('Cannot reach the CareSphere API. Check that the backend terminal is running (npm run dev) with no errors.', res.status);
  }
  // A non-JSON 401/403 never comes from CareSphere: something in between (for example a VS Code dev
  // tunnel asking for its own sign-in) refused the request.
  if ((res.status === 401 || res.status === 403) && !data) {
    throw new ApiError('The request was stopped before it reached CareSphere (for example by a dev tunnel sign-in). Open CareSphere at its LAN address instead.', res.status);
  }
  if (!res.ok) throw new ApiError(data?.message || `Request failed (${res.status})`, res.status, data?.details);
  return data;
}

/** Gets a short-lived signed link from `linkPath` (the server checks the permission) and returns its URL. */
export async function signedUrl(linkPath) {
  const res = await api(linkPath);
  return res.data.url;
}

/** Downloads a file that is served only through a signed link (acknowledgments, donation documents). */
export async function downloadSigned(linkPath, fallbackName) {
  return download(await signedUrl(linkPath), fallbackName);
}

/** Downloads a file (PDF/XLSX) from an authenticated endpoint. */
export async function download(path, fallbackName) {
  const res = await api(path, { raw: true });
  const disposition = res.headers.get('Content-Disposition') || '';
  const match = disposition.match(/filename="?([^"]+)"?/);
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = match ? match[1] : fallbackName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function qs(params) {
  const s = new URLSearchParams(Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== ''));
  const str = s.toString();
  return str ? `?${str}` : '';
}
