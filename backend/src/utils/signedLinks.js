/**
 * Short-lived signed file links. A link names ONE file (kind + id), ONE user and an expiry, signed with HMAC-SHA256
 * (key derived from JWT_SECRET, or FILE_LINK_KEY when set). The file route also needs the user's session, and the
 * signed user must be the signed-in user, so a copied link is useless to anyone else and stops working after
 * LINK_SECONDS. Links carry no file path: the server looks the file up by kind + id (no path traversal).
 */
const crypto = require('crypto');
const env = require('../config/env');
const HttpError = require('./HttpError');
const { safeEqual } = require('./crypto');

const LINK_SECONDS = 120;
const KINDS = ['qr', 'qr_change', 'donation_doc', 'receipt'];
const key = () => {
  const own = process.env.FILE_LINK_KEY;
  if (own && /^[0-9a-fA-F]{64}$/.test(own)) return Buffer.from(own, 'hex');
  return Buffer.from(crypto.hkdfSync('sha256', Buffer.from(String(env.jwtSecret || 'caresphere')), Buffer.from('caresphere'), Buffer.from('file-links-v1'), 32));
};
const mac = (payload) => crypto.createHmac('sha256', key()).update(payload).digest('base64url');

/** -> 'kind.id.user.exp.sig' (URL-safe). */
function sign({ kind, id, userId, seconds = LINK_SECONDS }) {
  if (!KINDS.includes(kind)) throw new Error(`Unknown file link kind ${kind}`);
  const exp = Math.floor(Date.now() / 1000) + seconds;
  const payload = `${kind}.${Number(id)}.${Number(userId)}.${exp}`;
  return `${payload}.${mac(payload)}`;
}

/** Checks a link for the signed-in user. Every failure is the same 404 (nothing about why). */
function verify(token, user) {
  const parts = String(token || '').split('.');
  const notFound = new HttpError(404, 'This link has expired. Open the file again from its page.');
  if (parts.length !== 5) throw notFound;
  const [kind, id, uid, exp, sig] = parts;
  const payload = `${kind}.${id}.${uid}.${exp}`;
  if (!/^\d+$/.test(id) || !/^\d+$/.test(uid) || !/^\d+$/.test(exp)) throw notFound;
  if (!safeEqual(sig, mac(payload))) throw notFound;
  if (Number(exp) < Math.floor(Date.now() / 1000)) throw notFound;
  if (!user || Number(uid) !== Number(user.user_id)) throw notFound;
  if (!KINDS.includes(kind)) throw notFound;
  return { kind, id: Number(id) };
}

const url = (token) => `/api/files/${token}`;

module.exports = { sign, verify, url, LINK_SECONDS, KINDS };
