/**
 * Donor payments.
 *  - E-wallets (gateway): the server creates a PayMongo checkout for the amount it validated. The
 *    donation is created ONLY when PayMongo's signed webhook reports the payment as paid, in one
 *    transaction: donation (general, Portal, Registered), receipt code, payment link, notification
 *    and audit entry. A repeated webhook finds the payment already paid and changes nothing.
 *  - Bank transfer (manual): the donor gives the transfer reference, date and amount (an attachment is optional). A donation is
 *    created as "Pending verification" with no receipt until Staff or Admin confirm it.
 */
const env = require('../config/env');
const { pool, withTransaction } = require('../config/db');
const HttpError = require('../utils/HttpError');
const Donation = require('../models/donationModel');
const { makeReceiptCode } = require('./donationService');
const Notify = require('./notifications');
const paymongo = require('./paymongo');
const { saveUpload, readUpload, MB } = require('../utils/files');
const { toMoney, requireText, requireDate, trimOrNull, localToday } = require('../utils/validate');
const { logActivity, logActivityWith } = require('../utils/audit');

const MIN_AMOUNT = 20;        // PayMongo's usual minimum for e-wallets (PHP 20.00)
const MAX_AMOUNT = 100000;
const PROOF_OPTS = { folder: 'payment-proofs', allowed: ['jpg', 'png', 'pdf'], maxBytes: 5 * MB, label: 'Proof of transfer' };
const appUrl = () => String(process.env.PUBLIC_APP_URL || env.corsOrigins?.[0] || 'http://localhost:5173').replace(/\/+$/, '');

/** Status names shown to donors and staff. */
const STATUS_LABELS = {
  pending: 'Waiting for payment', paid: 'Paid', failed: 'Failed', cancelled: 'Cancelled', expired: 'Expired',
  pending_verification: 'Pending verification', confirmed: 'Confirmed', rejected: 'Rejected',
};

const PUBLIC_METHOD_COLS = 'method_id, code, name, method_group, method_type, instructions, bank_name, account_name, account_number, branch, (qr_storage_key IS NOT NULL) AS has_qr';

/** Enabled methods for the Donate page (gateway methods only while PayMongo is configured). */
async function donorMethods() {
  const [rows] = await pool.query(`SELECT ${PUBLIC_METHOD_COLS} FROM tbl_payment_methods WHERE enabled = TRUE ORDER BY sort_order, method_id`);
  return rows.filter((m) => m.method_type === 'manual' || paymongo.configured()).map((m) => ({ ...m, has_qr: !!m.has_qr }));
}

async function method(code) {
  const [[m]] = await pool.query('SELECT * FROM tbl_payment_methods WHERE code = ? AND enabled = TRUE', [String(code || '')]);
  if (!m) throw new HttpError(400, 'Choose a payment method.');
  return m;
}

function cleanAmountReason(body) {
  const amount = toMoney(body?.amount, 'Amount');
  if (amount < MIN_AMOUNT) throw new HttpError(400, `The minimum online donation is PHP ${MIN_AMOUNT}.`);
  if (amount > MAX_AMOUNT) throw new HttpError(400, `For donations above PHP ${MAX_AMOUNT.toLocaleString()}, please contact the home directly.`);
  return { amount, reason: requireText(body?.reason, 'Reason for donation is required.', 3000) };
}

/** POST e-wallet: creates the payment record and the PayMongo checkout. Returns the checkout URL. */
async function startCheckout(req, body) {
  const m = await method(body?.method_code);
  if (m.method_type !== 'gateway') throw new HttpError(400, 'That method is paid by bank transfer.');
  const { amount, reason } = cleanAmountReason(body);
  const [r] = await pool.query(
    "INSERT INTO tbl_payments (donor_id, method_id, method_name, gateway, amount, reason, status) VALUES (?, ?, ?, 'paymongo', ?, ?, 'pending')",
    [req.user.user_id, m.method_id, m.name, amount, reason]);
  const paymentId = r.insertId;
  const reference = `CSP-${String(paymentId).padStart(6, '0')}`;
  try {
    const back = `${appUrl()}/donate/result?payment=${paymentId}`;
    const session = await paymongo.createCheckout({
      amount, gatewayCode: m.gateway_code, description: 'General donation to the children in our care', reference,
      successUrl: `${back}&r=success`, cancelUrl: `${back}&r=cancel`, paymentId,
    });
    await pool.query('UPDATE tbl_payments SET gateway_session_id = ? WHERE payment_id = ?', [session.session_id, paymentId]);
    await logActivity(req, `PAYMENT_CHECKOUT_STARTED (${m.name}, PHP ${amount.toFixed(2)})`, `Payment #${paymentId}`);
    return { payment_id: paymentId, checkout_url: session.checkout_url };
  } catch (err) {
    await pool.query("UPDATE tbl_payments SET status = 'failed' WHERE payment_id = ?", [paymentId]);
    throw err;
  }
}

/**
 * Marks a gateway payment paid and creates its donation, once. Called only from a verified webhook.
 * The payment row is locked, so two deliveries at the same moment still create one donation.
 */
async function completeGatewayPayment(paymentId, gatewayPaymentId) {
  return withTransaction(async (conn) => {
    const [[p]] = await conn.query('SELECT * FROM tbl_payments WHERE payment_id = ? FOR UPDATE', [paymentId]);
    if (!p || p.gateway !== 'paymongo') return null;
    if (p.donation_id) return p.donation_id; // already done: a repeated webhook changes nothing
    const [[donor]] = await conn.query('SELECT user_id, full_name FROM tbl_users WHERE user_id = ?', [p.donor_id]);
    const [[setting]] = await conn.query("SELECT setting_value FROM tbl_settings WHERE setting_key = 'default_allocation_text'");
    const donationId = await Donation.insertWith(conn, {
      donor_id: p.donor_id, donor_type: 'registered', donor_name: donor?.full_name || 'Donor', source: 'portal',
      amount: Number(p.amount), payment_method: p.method_name, status: 'Received', reason_for_donation: p.reason,
      is_general: true, submitted_by_donor: true,
      allocation_notes: setting?.setting_value || 'General support for the children in our care',
      qr_receipt_code: makeReceiptCode(),
    });
    // Lifecycle: Received (paid online) -> Accepted (one allocation line) -> Acknowledged (receipt ready, as before).
    const LC = require('./donationLifecycle');
    await LC.history(conn, donationId, null, 'Received', 'Paid online', null);
    await LC.acceptPortalGift(conn, null, donationId, { purpose: LC.purposeFromText(p.reason), use: setting?.setting_value || null, note: 'Paid online: general donation' });
    await conn.query(
      "UPDATE tbl_payments SET status = 'paid', gateway_payment_id = COALESCE(?, gateway_payment_id), paid_at = NOW(), donation_id = ? WHERE payment_id = ?",
      [gatewayPaymentId || null, donationId, paymentId]);
    await conn.query(
      "INSERT INTO tbl_activity_logs (user_id, user_role, action_performed, target_entity, ip_address, device_type) VALUES (?, 'Donor', ?, ?, 'paymongo', NULL)",
      [p.donor_id, `DONATION_PAID_ONLINE (${p.method_name}, PHP ${Number(p.amount).toFixed(2)}, webhook)`, `Donation #${donationId}`]);
    await Notify.emit(conn, 'donation_paid', { userId: p.donor_id, entityType: 'payment', entityId: paymentId, groupKey: `donation_paid:payment:${paymentId}` });
    await Notify.toAdmins(conn, 'admin_donation_received', { params: { source: 'online payment' }, groupKey: 'donations_received', mode: 'count' });
    return donationId;
  });
}

/** A payment that won't complete (failed, cancelled, expired): no donation is created. */
async function closeGatewayPayment(paymentId, status) {
  await withTransaction(async (conn) => {
    const [r] = await conn.query("UPDATE tbl_payments SET status = ? WHERE payment_id = ? AND status = 'pending'", [status, paymentId]);
    if (!r.affectedRows || status === 'expired') return; // already closed (repeat call) or quietly expired
    const [[p]] = await conn.query('SELECT donor_id FROM tbl_payments WHERE payment_id = ?', [paymentId]);
    await Notify.emit(conn, 'payment_failed', { userId: p.donor_id, entityType: 'payment', entityId: paymentId, params: { status },
      groupKey: `payment_closed:payment:${paymentId}` });
    if (status === 'failed') await Notify.toAdmins(conn, 'admin_payment_failed', { groupKey: 'payments_failed', mode: 'count' });
  });
}

/**
 * Webhook: signature checked by the caller. Each event ID is processed once (repeat deliveries are
 * acknowledged and ignored). Returns a short result for the log.
 */
async function handleWebhook(event) {
  const eventId = String(event?.data?.id || '');
  const type = String(event?.data?.attributes?.type || '');
  const obj = event?.data?.attributes?.data || {};
  const meta = obj?.attributes?.metadata || {};
  const paymentId = Number(meta.caresphere_payment_id) || null;
  if (!eventId) throw new HttpError(400, 'Missing event.');
  const [ins] = await pool.query('INSERT IGNORE INTO tbl_payment_webhook_events (event_id, event_type, payment_id) VALUES (?, ?, ?)', [eventId, type.slice(0, 60), paymentId]);
  if (!ins.affectedRows) return 'duplicate event ignored';
  if (!paymentId) return 'no CareSphere payment';

  if (type === 'checkout_session.payment.paid') {
    const paid = (obj.attributes?.payments || []).find((x) => x?.attributes?.status === 'paid');
    if (!paid) return 'no paid payment in event';
    const [[p]] = await pool.query('SELECT amount, gateway_session_id FROM tbl_payments WHERE payment_id = ?', [paymentId]);
    // The amount PayMongo collected must match what the server asked for.
    if (!p || p.gateway_session_id !== obj.id || Math.round(Number(p.amount) * 100) !== Number(paid.attributes.amount)) {
      console.error('[paymongo] amount or session mismatch for payment', paymentId);
      return 'mismatch ignored';
    }
    await completeGatewayPayment(paymentId, paid.id);
    return 'paid';
  }
  if (type === 'payment.failed') { await closeGatewayPayment(paymentId, 'failed'); return 'failed'; }
  return `ignored ${type}`;
}

/**
 * The donor's return page. Display only: a payment becomes Paid only through the webhook. When the
 * donor cancels, the session is checked with PayMongo and marked Cancelled if nothing was paid.
 */
async function donorPayment(req, paymentId, returned) {
  const [[p]] = await pool.query('SELECT * FROM tbl_payments WHERE payment_id = ? AND donor_id = ?', [paymentId, req.user.user_id]);
  if (!p) throw new HttpError(404, 'Payment not found.');
  if (p.status === 'pending' && returned === 'cancel' && p.gateway_session_id) {
    const session = await paymongo.retrieveCheckout(p.gateway_session_id).catch(() => null);
    const paid = (session?.attributes?.payments || []).some((x) => x?.attributes?.status === 'paid');
    if (!paid) await closeGatewayPayment(p.payment_id, 'cancelled');
  }
  const [[fresh]] = await pool.query('SELECT payment_id, method_name, amount, status, created_at, paid_at, donation_id FROM tbl_payments WHERE payment_id = ?', [paymentId]);
  return { ...fresh, status_label: STATUS_LABELS[fresh.status] };
}

/** Gateway checkouts nobody finished within 24 hours are marked Expired (nothing is deleted). */
async function expireStale() {
  await pool.query("UPDATE tbl_payments SET status = 'expired' WHERE gateway = 'paymongo' AND status = 'pending' AND created_at < NOW() - INTERVAL 24 HOUR");
}

/** POST bank transfer: reference, date, proof. Creates a "Pending verification" donation, no receipt. */
async function submitBankTransfer(req, body) {
  const m = await method(body?.method_code || 'bank_transfer');
  if (m.method_type !== 'manual') throw new HttpError(400, 'That method is paid online.');
  if (!m.account_number || !m.account_name || !m.bank_name) throw new HttpError(400, "The home's bank details aren't set yet. Please choose another method or try later.");
  const { amount, reason } = cleanAmountReason(body);
  const reference = requireText(body?.transfer_reference, 'Transfer reference number is required.', 100).toUpperCase().replace(/\s+/g, '');
  if (!/^[A-Z0-9-]{4,100}$/.test(reference)) throw new HttpError(400, 'Enter the transfer reference number exactly as it appears on your receipt (letters, numbers and dashes).');
  const transferDate = requireDate(body?.transfer_date, 'Date of transfer');
  if (transferDate > localToday()) throw new HttpError(400, 'The date of transfer cannot be in the future.');
  const last4 = trimOrNull(body?.account_last4, 4);
  if (last4 && !/^\d{4}$/.test(last4)) throw new HttpError(400, 'Enter only the last 4 digits of your account, or leave it empty.');
  const [[dup]] = await pool.query('SELECT payment_id FROM tbl_payments WHERE transfer_reference = ?', [reference]);
  if (dup) throw new HttpError(409, 'This transfer reference number was already submitted. Check the number, or contact the home if you think this is a mistake.');
  // An attachment is optional: staff verify by reference number, amount and date against the bank statement.
  const file = body?.proof ? saveUpload(body.proof, PROOF_OPTS) : null;

  const [[donor]] = await pool.query('SELECT full_name FROM tbl_users WHERE user_id = ?', [req.user.user_id]);
  try {
    return await withTransaction(async (conn) => {
      const donationId = await Donation.insertWith(conn, {
        donor_id: req.user.user_id, donor_type: 'registered', donor_name: donor.full_name, source: 'portal', amount,
        payment_method: m.name, status: 'Pending verification', reason_for_donation: reason, is_general: true, submitted_by_donor: true,
        qr_receipt_code: makeReceiptCode(),
      });
      await require('./donationLifecycle').history(conn, donationId, null, 'Pending verification', 'Bank transfer submitted by the donor', req.user.user_id);
      const [r] = await conn.query(
        `INSERT INTO tbl_payments (donor_id, method_id, method_name, gateway, amount, reason, status, transfer_reference, transfer_date, account_last4,
           proof_storage_key, proof_name, proof_mime, proof_size, proof_sha256, donation_id)
         VALUES (?, ?, ?, 'manual', ?, ?, 'pending_verification', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [req.user.user_id, m.method_id, m.name, amount, reason, reference, transferDate, last4, file?.storage_key || null, file?.original_name || null, file?.mime_type || null,
          file?.size_bytes || null, file?.sha256 || null, donationId]);
      await logActivityWith(conn, req, `BANK_TRANSFER_SUBMITTED (PHP ${amount.toFixed(2)})`, `Payment #${r.insertId}`);
      await Notify.emit(conn, 'transfer_submitted', { userId: req.user.user_id, entityType: 'payment', entityId: r.insertId, groupKey: `transfer_submitted:payment:${r.insertId}` });
      // One "to verify" row per Admin and Staff member, showing how many are waiting.
      const [[q]] = await conn.query("SELECT COUNT(*) AS n FROM tbl_payments WHERE status = 'pending_verification'");
      const pending = { params: { count: Number(q.n) }, groupKey: 'transfers_pending', mode: 'set' };
      await Notify.toAdmins(conn, 'admin_transfer_pending', pending);
      await Notify.toStaff(conn, 'staff_transfer_pending', pending);
      return { payment_id: r.insertId, donation_id: donationId, status: 'pending_verification', status_label: STATUS_LABELS.pending_verification };
    });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') throw new HttpError(409, 'This transfer reference number was already submitted. Check the number, or contact the home if you think this is a mistake.');
    throw err;
  }
}

/**
 * Staff/Admin: confirm (the purpose is the allocation; the donation is Received, Accepted and acknowledged, so
 * the receipt is issued) or reject (reason required, donor notified).
 */
async function verifyBankTransfer(req, paymentId, body) {
  const action = String(body?.action || '');
  if (!['confirm', 'reject'].includes(action)) throw new HttpError(400, 'Choose Confirm or Reject.');
  const LC = require('./donationLifecycle');
  const L = require('../config/donationLifecycle');
  const purpose = action === 'confirm' ? String(body?.purpose || '').trim() : null;
  if (action === 'confirm' && !L.PROGRAMS.includes(purpose)) throw new HttpError(422, 'Choose the purpose (it becomes the allocation).', { errors: { purpose: 'Choose the purpose.' } });
  const allocation = action === 'confirm' ? (trimOrNull(body?.allocation_notes, 500) || null) : null;
  const reason = action === 'reject' ? requireText(body?.reason, 'A reason is required when rejecting.', 1000) : null;
  return withTransaction(async (conn) => {
    const [[p]] = await conn.query('SELECT * FROM tbl_payments WHERE payment_id = ? FOR UPDATE', [paymentId]);
    if (!p || p.gateway !== 'manual') throw new HttpError(404, 'Payment not found.');
    if (p.status !== 'pending_verification') throw new HttpError(409, `This transfer was already ${STATUS_LABELS[p.status].toLowerCase()}.`);
    if (action === 'confirm') {
      const d = await LC.lockDonation(conn, p.donation_id);
      await LC.setStatus(conn, req, d, 'Received', 'Bank transfer verified');
      await LC.acceptPortalGift(conn, req, p.donation_id, { purpose, use: allocation, note: 'Bank transfer verified' });
      await conn.query("UPDATE tbl_payments SET status = 'confirmed', verified_by = ?, verified_at = NOW() WHERE payment_id = ?", [req.user.user_id, paymentId]);
      await Notify.emit(conn, 'transfer_confirmed', { userId: p.donor_id, entityType: 'payment', entityId: paymentId, groupKey: `transfer_confirmed:payment:${paymentId}` });
      await Notify.toAdmins(conn, 'admin_donation_received', { params: { source: 'bank transfer' }, groupKey: 'donations_received', mode: 'count' });
    } else {
      const d = await LC.lockDonation(conn, p.donation_id);
      await LC.setStatus(conn, req, d, 'Rejected', 'Bank transfer not confirmed');
      await conn.query("UPDATE tbl_payments SET status = 'rejected', verified_by = ?, verified_at = NOW(), rejection_reason = ? WHERE payment_id = ?", [req.user.user_id, reason, paymentId]);
      await Notify.emit(conn, 'transfer_rejected', { userId: p.donor_id, entityType: 'payment', entityId: paymentId, params: { reason },
        groupKey: `transfer_rejected:payment:${paymentId}` });
    }
    await logActivityWith(conn, req, `BANK_TRANSFER_${action === 'confirm' ? 'CONFIRMED' : 'REJECTED'} (pending_verification -> ${action === 'confirm' ? 'confirmed' : 'rejected'})`, `Donation #${p.donation_id}`);
    return { payment_id: paymentId, status: action === 'confirm' ? 'confirmed' : 'rejected' };
  });
}

/** Proof file: the donor who uploaded it, Admin or Staff. Every view is logged. */
async function proof(req, paymentId) {
  const [[p]] = await pool.query('SELECT payment_id, donor_id, donation_id, proof_storage_key, proof_name, proof_mime FROM tbl_payments WHERE payment_id = ?', [paymentId]);
  if (!p || !p.proof_storage_key || (req.user.role === 'Donor' && p.donor_id !== req.user.user_id)) throw new HttpError(404, 'Not found.');
  await logActivity(req, 'VIEW_PAYMENT_PROOF', `Payment #${p.payment_id}`);
  return { body: readUpload(p.proof_storage_key), mime: p.proof_mime, name: p.proof_name };
}

const LIST_COLS = `p.payment_id, p.donor_id, u.full_name AS donor_name, p.method_name, p.gateway, p.amount, p.status, p.transfer_reference,
  p.transfer_date, p.account_last4, (p.proof_storage_key IS NOT NULL) AS has_proof, p.donation_id, p.rejection_reason, p.created_at, p.paid_at,
  p.verified_at, v.full_name AS verified_by_name, d.receipt_issued, d.status AS donation_status`;
const LIST_FROM = `FROM tbl_payments p JOIN tbl_users u ON u.user_id = p.donor_id LEFT JOIN tbl_users v ON v.user_id = p.verified_by
  LEFT JOIN tbl_donations d ON d.donation_id = p.donation_id`;
const shape = (r) => ({ ...r, has_proof: !!r.has_proof, receipt_available: !!r.receipt_issued && !['Voided', 'Rejected', 'Pending verification', 'Cancelled'].includes(r.donation_status), status_label: STATUS_LABELS[r.status] });

async function listForDonor(userId) {
  const [rows] = await pool.query(`SELECT ${LIST_COLS} ${LIST_FROM} WHERE p.donor_id = ? ORDER BY p.created_at DESC LIMIT 200`, [userId]);
  return rows.map(shape);
}

async function listForStaff({ status, method: methodName } = {}) {
  const where = [];
  const params = [];
  if (status) { where.push('p.status = ?'); params.push(status); }
  if (methodName) { where.push('p.method_name = ?'); params.push(methodName); }
  const [rows] = await pool.query(`SELECT ${LIST_COLS} ${LIST_FROM} ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY p.created_at DESC LIMIT 500`, params);
  return rows.map(shape);
}

module.exports = {
  STATUS_LABELS, MIN_AMOUNT, donorMethods, startCheckout, handleWebhook, completeGatewayPayment, donorPayment, expireStale,
  submitBankTransfer, verifyBankTransfer, proof, listForDonor, listForStaff,
};
