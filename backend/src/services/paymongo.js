/**
 * PayMongo (https://developers.paymongo.com) for e-wallet donations.
 * Keys live only in backend/.env:
 *   PAYMONGO_SECRET_KEY      sk_test_... (sandbox) or sk_live_...
 *   PAYMONGO_WEBHOOK_SECRET  whsk_... (returned when the webhook is registered)
 * The checkout page is hosted by PayMongo: CareSphere never sees wallet or card credentials.
 */
const crypto = require('crypto');
const HttpError = require('../utils/HttpError');

const API = 'https://api.paymongo.com/v1';
const secretKey = () => String(process.env.PAYMONGO_SECRET_KEY || '').trim();
const webhookSecret = () => String(process.env.PAYMONGO_WEBHOOK_SECRET || '').trim();

const configured = () => Boolean(secretKey());
/** Sandbox unless a live key is set. */
const isTestMode = () => !secretKey().startsWith('sk_live_');

async function call(method, path, body, idempotencyKey) {
  if (!configured()) throw new HttpError(503, 'Online payments are not set up yet. Choose Bank transfer, or try again later.');
  let res;
  try {
    res = await fetch(`${API}${path}`, {
      method,
      headers: {
        Authorization: `Basic ${Buffer.from(`${secretKey()}:`).toString('base64')}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
        ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(15000),
    });
  } catch {
    throw new HttpError(502, "Couldn't reach the payment provider. Check the server's internet connection and try again.");
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    // Log the provider's detail on the server only; the donor gets a plain message.
    console.error('[paymongo]', res.status, JSON.stringify(data?.errors || data).slice(0, 500));
    throw new HttpError(502, 'The payment provider declined the request. Please try again or choose another method.');
  }
  return data;
}

/** Creates a hosted checkout session for one amount and one e-wallet. Amount is in pesos. */
async function createCheckout({ amount, gatewayCode, description, reference, successUrl, cancelUrl, paymentId }) {
  const data = await call('POST', '/checkout_sessions', {
    data: {
      attributes: {
        line_items: [{ name: 'General donation', amount: Math.round(amount * 100), currency: 'PHP', quantity: 1 }],
        payment_method_types: [gatewayCode],
        description, reference_number: reference, success_url: successUrl, cancel_url: cancelUrl,
        send_email_receipt: false, show_description: true, show_line_items: true,
        metadata: { caresphere_payment_id: String(paymentId) },
      },
    },
  }, `caresphere-payment-${paymentId}`);
  return { session_id: data.data.id, checkout_url: data.data.attributes.checkout_url };
}

async function retrieveCheckout(sessionId) {
  const data = await call('GET', `/checkout_sessions/${encodeURIComponent(sessionId)}`);
  return data.data;
}

/**
 * Verifies the Paymongo-Signature header: "t=<timestamp>,te=<test sig>,li=<live sig>", where each
 * signature is HMAC-SHA256("<t>.<raw body>") with the webhook secret. Uses te in test mode, li in live.
 * Requests older than 10 minutes are refused.
 */
function verifySignature(rawBody, header) {
  const secret = webhookSecret();
  if (!secret || !header) return false;
  const parts = Object.fromEntries(String(header).split(',').map((p) => { const i = p.indexOf('='); return [p.slice(0, i).trim(), p.slice(i + 1).trim()]; }));
  const t = Number(parts.t);
  if (!Number.isFinite(t) || Math.abs(Date.now() / 1000 - t) > 600) return false;
  const expected = crypto.createHmac('sha256', secret).update(`${parts.t}.${rawBody}`).digest('hex');
  const given = String((isTestMode() ? parts.te : parts.li) || '');
  return given.length === expected.length && crypto.timingSafeEqual(Buffer.from(given), Buffer.from(expected));
}

module.exports = { configured, isTestMode, createCheckout, retrieveCheckout, verifySignature };
