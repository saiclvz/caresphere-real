const { pool } = require('../config/db');
const HttpError = require('../utils/HttpError');
const P = require('../services/paymentService');
const paymongo = require('../services/paymongo');
const { toInt, trimOrNull } = require('../utils/validate');
const { logActivity } = require('../utils/audit');

/** GET /api/payments/options (Donor) - enabled methods and whether the gateway runs in demo mode. */
exports.options = async (req, res) => {
  res.json({ success: true, data: { methods: await P.donorMethods(), demo: paymongo.configured() && paymongo.isTestMode(), gateway_configured: paymongo.configured(), min_amount: P.MIN_AMOUNT } });
};

/** POST /api/payments/checkout (Donor) { method_code, amount, reason } -> { checkout_url } */
exports.checkout = async (req, res) => {
  res.status(201).json({ success: true, data: await P.startCheckout(req, req.body || {}) });
};

/** POST /api/payments/bank (Donor) { method_code, amount, reason, transfer_reference, transfer_date, account_last4?, proof } */
exports.bank = async (req, res) => {
  res.status(201).json({ success: true, data: await P.submitBankTransfer(req, req.body || {}) });
};

/** GET /api/donor/payments (Donor) - the donor's own payments. */
exports.mine = async (req, res) => {
  res.json({ success: true, data: await P.listForDonor(req.user.user_id) });
};

/** GET /api/donor/payments/:id?r=success|cancel (Donor) - the return page after PayMongo. */
exports.mineOne = async (req, res) => {
  res.json({ success: true, data: await P.donorPayment(req, toInt(req.params.id, 'id', { min: 1 }), String(req.query.r || '')) });
};

/** GET /api/payments?status=&method= (Admin, Staff) - payments, e.g. bank transfers waiting for verification. */
exports.list = async (req, res) => {
  const status = req.query.status && P.STATUS_LABELS[req.query.status] ? req.query.status : undefined;
  res.json({ success: true, data: await P.listForStaff({ status, method: trimOrNull(req.query.method, 60) }) });
};

/** POST /api/payments/:id/verify (Admin, Staff) { action: confirm|reject, allocation_notes?, reason? } */
exports.verify = async (req, res) => {
  res.json({ success: true, data: await P.verifyBankTransfer(req, toInt(req.params.id, 'id', { min: 1 }), req.body || {}) });
};

/** GET /api/payments/:id/proof (Admin, Staff, the donor who uploaded it) - logged. */
exports.proof = async (req, res) => {
  const f = await P.proof(req, toInt(req.params.id, 'id', { min: 1 }));
  res.setHeader('Content-Type', f.mime);
  res.setHeader('Content-Disposition', `inline; filename="${String(f.name).replace(/["\r\n]/g, '')}"`);
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.send(f.body);
};

/**
 * POST /api/payments/webhook (PayMongo) - raw body; the signature is verified before anything is read.
 * Bad signatures get 400. Valid events are processed once (repeats are acknowledged and ignored).
 */
exports.webhook = async (req, res) => {
  const raw = Buffer.isBuffer(req.body) ? req.body.toString('utf8') : '';
  if (!paymongo.verifySignature(raw, req.get('Paymongo-Signature'))) {
    console.warn('[paymongo] webhook with an invalid signature rejected');
    await require('../services/notifications').toAdmins(pool, 'admin_webhook_error', { groupKey: 'webhook_errors', mode: 'count' }).catch(() => {});
    return res.status(400).json({ success: false, message: 'Invalid signature.' });
  }
  let event;
  try { event = JSON.parse(raw); } catch { return res.status(400).json({ success: false, message: 'Invalid JSON.' }); }
  const result = await P.handleWebhook(event);
  res.json({ success: true, result });
};

// ---------- Admin: payment methods and payment details ----------
const ADMIN_COLS = 'method_id, code, name, method_group, method_type, gateway_code, enabled, sort_order, instructions, bank_name, account_name, account_number, branch';

/** GET /api/payment-methods (Admin) */
exports.methods = async (req, res) => {
  const [rows] = await pool.query(`SELECT ${ADMIN_COLS} FROM tbl_payment_methods ORDER BY sort_order, method_id`);
  res.json({ success: true, data: rows.map((r) => ({ ...r, enabled: !!r.enabled })), gateway_configured: paymongo.configured(), demo: paymongo.isTestMode() });
};

/** PUT /api/payment-methods/:id (Admin) { name, enabled, sort_order, instructions, bank_name, account_name, account_number, branch } */
exports.updateMethod = async (req, res) => {
  const id = toInt(req.params.id, 'id', { min: 1 });
  const [[m]] = await pool.query('SELECT method_id, code, method_type FROM tbl_payment_methods WHERE method_id = ?', [id]);
  if (!m) throw new HttpError(404, 'Payment method not found.');
  const b = req.body || {};
  const name = String(b.name || '').trim();
  if (name.length < 2 || name.length > 60) throw new HttpError(400, 'Name must be 2 to 60 characters.');
  const order = toInt(b.sort_order ?? 0, 'Order', { min: 0, max: 999 });
  const accountNumber = trimOrNull(b.account_number, 60);
  if (accountNumber && !/^[0-9 -]{4,60}$/.test(accountNumber)) throw new HttpError(400, 'Account number: digits, spaces and dashes only.');
  await pool.query(
    `UPDATE tbl_payment_methods SET name = ?, enabled = ?, sort_order = ?, instructions = ?, bank_name = ?, account_name = ?, account_number = ?, branch = ?, updated_by = ?
      WHERE method_id = ?`,
    [name, b.enabled ? 1 : 0, order, trimOrNull(b.instructions, 1000), trimOrNull(b.bank_name, 120), trimOrNull(b.account_name, 120), accountNumber,
      trimOrNull(b.branch, 120), req.user.user_id, id]);
  await logActivity(req, `UPDATE_PAYMENT_METHOD (${m.code}${b.enabled ? ', enabled' : ', disabled'})`, `Payment method #${id}`);
  const [rows] = await pool.query(`SELECT ${ADMIN_COLS} FROM tbl_payment_methods ORDER BY sort_order, method_id`);
  res.json({ success: true, data: rows.map((r) => ({ ...r, enabled: !!r.enabled })) });
};
