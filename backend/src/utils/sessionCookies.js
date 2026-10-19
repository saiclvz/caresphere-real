/**
 * Session cookies. The browser never sees the session token: it is in an HttpOnly cookie (JavaScript can't read it,
 * so it can't be stolen by injected script and is never kept in localStorage or sessionStorage).
 *   cs_session  HttpOnly, SameSite=Strict, Path=/api, Secure when COOKIE_SECURE=true or the request came over HTTPS
 *   cs_csrf     readable by the page (not HttpOnly), SameSite=Strict: the page sends it back in the X-CSRF-Token
 *               header on every change (double submit). It is an HMAC of the session id, so it is bound to the
 *               session and changes with it.
 * Plain-HTTP LAN installs can't use Secure cookies; SameSite=Strict and the CSRF header still apply.
 */
const env = require('../config/env');
const { hmac, safeEqual } = require('./crypto');

const SESSION = 'cs_session';
const CSRF = 'cs_csrf';
const CSRF_HEADER = 'x-csrf-token';
const SAFE_METHODS = ['GET', 'HEAD', 'OPTIONS'];

function readCookies(req) {
  const out = {};
  for (const part of String(req.headers?.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    if (k) { try { out[k] = decodeURIComponent(part.slice(i + 1).trim()); } catch { out[k] = part.slice(i + 1).trim(); } }
  }
  return out;
}

const csrfFor = (jti) => hmac(`csrf:${jti}`, env.jwtSecret).slice(0, 32);
const secure = (req) => String(process.env.COOKIE_SECURE || '').toLowerCase() === 'true' || req.secure === true || req.headers?.['x-forwarded-proto'] === 'https';

function cookie(name, value, { req, httpOnly, maxAge, path }) {
  return [`${name}=${encodeURIComponent(value)}`, `Path=${path}`, `Max-Age=${maxAge}`, 'SameSite=Strict', httpOnly ? 'HttpOnly' : null, secure(req) ? 'Secure' : null].filter(Boolean).join('; ');
}

/** Sets the session and CSRF cookies. Returns the CSRF token (also in the cookie). */
function setSession(req, res, token, jti, maxAgeSeconds) {
  const csrf = csrfFor(jti);
  res.setHeader('Set-Cookie', [
    cookie(SESSION, token, { req, httpOnly: true, maxAge: maxAgeSeconds, path: '/api' }),
    cookie(CSRF, csrf, { req, httpOnly: false, maxAge: maxAgeSeconds, path: '/' }),
  ]);
  return csrf;
}

function clearSession(req, res) {
  res.setHeader('Set-Cookie', [
    cookie(SESSION, '', { req, httpOnly: true, maxAge: 0, path: '/api' }),
    cookie(CSRF, '', { req, httpOnly: false, maxAge: 0, path: '/' }),
  ]);
}

/** True when a cookie-authenticated change carries the matching CSRF header. */
function csrfOk(req, jti) {
  if (SAFE_METHODS.includes(String(req.method || 'GET').toUpperCase())) return true;
  const sent = String(req.headers?.[CSRF_HEADER] || '');
  return !!sent && safeEqual(sent, csrfFor(jti));
}

module.exports = { SESSION, CSRF, CSRF_HEADER, readCookies, csrfFor, setSession, clearSession, csrfOk };
