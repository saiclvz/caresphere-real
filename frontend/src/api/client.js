import { clearAllGrants } from '../lib/grants';
const BASE = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '') + '/api';
const TOKEN_KEY = 'caresphere.session';

let token = sessionStorage.getItem(TOKEN_KEY);
let unauthorizedHandler = null;

export class ApiError extends Error {
  constructor(message, status, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

export function setToken(value) {
  token = value;
  if (value) sessionStorage.setItem(TOKEN_KEY, value);
  else sessionStorage.removeItem(TOKEN_KEY);
}

export const getToken = () => token;
export const onUnauthorized = (fn) => { unauthorizedHandler = fn; };

export async function api(path, { method = 'GET', body, headers = {}, raw = false, signal } = {}) {
  let res;
  try {
    res = await fetch(BASE + path, {
      method,
      signal,
      headers: {
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...headers,
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch (err) {
    if (err.name === 'AbortError') throw err;
    throw new ApiError('Cannot reach the CareSphere server. Check that the API is running on the network.', 0);
  }

  if (res.status === 401 && token && unauthorizedHandler && !path.startsWith('/auth/login')) {
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
