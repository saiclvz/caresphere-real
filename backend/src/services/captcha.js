/**
 * Optional check before a donor reports a donation (Settings: donation_claim_captcha = 1). Runs entirely on the
 * CareSphere server: no third-party service, no tracking. The challenge is a short sum; the answer is bound to the
 * user and an expiry with an HMAC, and each challenge works once.
 */
const crypto = require('crypto');
const env = require('../config/env');
const HttpError = require('../utils/HttpError');
const { safeEqual } = require('../utils/crypto');

const TTL_SECONDS = 600;
const used = new Map(); // nonce -> expiry (single process)
const key = () => Buffer.from(crypto.hkdfSync('sha256', Buffer.from(String(env.jwtSecret || 'caresphere')), Buffer.from('caresphere'), Buffer.from('donation-check-v1'), 32));
const mac = (s) => crypto.createHmac('sha256', key()).update(s).digest('base64url');

function challenge(userId) {
  const a = crypto.randomInt(2, 10); const b = crypto.randomInt(2, 10);
  const nonce = crypto.randomBytes(12).toString('base64url');
  const exp = Math.floor(Date.now() / 1000) + TTL_SECONDS;
  const body = `${userId}.${nonce}.${exp}.${a + b}`;
  return { question: `What is ${a} + ${b}?`, token: `${nonce}.${exp}.${mac(body)}` };
}

function check(userId, token, answer) {
  const bad = new HttpError(422, 'Answer the check question again.', { errors: { captcha: 'Answer the check question.' }, captcha: true });
  const [nonce, exp, sig] = String(token || '').split('.');
  const ans = String(answer ?? '').trim();
  if (!nonce || !exp || !sig || !/^\d{1,2}$/.test(ans)) throw bad;
  if (Number(exp) < Date.now() / 1000) throw bad;
  if (!safeEqual(sig, mac(`${userId}.${nonce}.${exp}.${Number(ans)}`))) throw bad;
  for (const [n, e] of used) if (e < Date.now() / 1000) used.delete(n);
  if (used.has(nonce)) throw bad;
  used.set(nonce, Number(exp));
}

module.exports = { challenge, check };
