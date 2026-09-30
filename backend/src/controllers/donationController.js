const env = require('../config/env');
const Donation = require('../models/donationModel');
const User = require('../models/userModel');
const Settings = require('../models/settingsModel');
const pdf = require('../services/pdfService');
const HttpError = require('../utils/HttpError');
const { hmac, safeEqual, randomCode } = require('../utils/crypto');
const { requireFields, toInt, toMoney, trimOrNull, requireDate, oneOf } = require('../utils/validate');
const { logActivity } = require('../utils/audit');

const PAYMENT_METHODS = ['Cash', 'GCash', 'Maya', 'Bank Transfer', 'Check', 'In-kind'];
const STATUSES = ['Pending', 'Received', 'Cancelled'];

function makeReceiptCode() {
  const base = `CSR-${Date.now().toString(36).toUpperCase()}-${randomCode(3)}`;
  return `${base}.${hmac(base, env.receiptKey).slice(0, 16)}`;
}

function receiptSignatureValid(code) {
  const [base, sig] = String(code).split('.');
  if (!base || !sig) return false;
  return safeEqual(sig, hmac(base, env.receiptKey).slice(0, 16));
}

exports.PAYMENT_METHODS = PAYMENT_METHODS;
exports.makeReceiptCode = makeReceiptCode;

exports.list = async (req, res) => {
  const from = req.query.from ? requireDate(req.query.from, 'from') : undefined;
  const to = req.query.to ? requireDate(req.query.to, 'to') : undefined;
  const donorId = req.query.donor_id ? toInt(req.query.donor_id, 'donor_id', { min: 1 }) : undefined;
  const status = req.query.status ? oneOf(req.query.status, STATUSES, 'status') : undefined;
  res.json({ success: true, data: await Donation.list({ donorId, from, to, status, search: req.query.q }) });
};

/** GET /api/donations/donors - donor accounts for the "record donation" form */
exports.donors = async (req, res) => {
  const donors = (await User.list({ role: 'Donor' })).filter((d) => d.is_active);
  res.json({ success: true, data: donors.map(({ user_id, full_name, email }) => ({ user_id, full_name, email })) });
};

exports.create = async (req, res) => {
  requireFields(req.body, ['donor_id', 'amount', 'payment_method']);
  const donorId = toInt(req.body.donor_id, 'donor_id', { min: 1 });
  const donor = await User.findById(donorId);
  if (!donor || donor.role !== 'Donor') throw new HttpError(400, 'Select a registered donor account.');
  if (!PAYMENT_METHODS.includes(req.body.payment_method)) {
    throw new HttpError(400, `Payment method must be one of: ${PAYMENT_METHODS.join(', ')}`);
  }

  const id = await Donation.create({
    donor_id: donorId,
    donor_name: donor.full_name,
    amount: toMoney(req.body.amount, 'Amount'),
    payment_method: req.body.payment_method,
    status: 'Received',
    item_description: trimOrNull(req.body.item_description, 2000),
    reason_for_donation: trimOrNull(req.body.reason_for_donation, 3000),
    allocation_notes: trimOrNull(req.body.allocation_notes, 3000),
    qr_receipt_code: makeReceiptCode(),
  });
  await logActivity(req, 'RECORD_DONATION', `Donation #${id}`);
  res.status(201).json({ success: true, data: await Donation.findById(id) });
};

/** PUT /api/donations/:id/status (Admin, Staff) { status: 'Received' | 'Cancelled' } - confirms donor pledges */
exports.updateStatus = async (req, res) => {
  const donation = await Donation.findById(req.params.id);
  if (!donation) throw new HttpError(404, 'Donation not found.');
  const status = oneOf(req.body.status, ['Received', 'Cancelled'], 'status');
  if (donation.status !== 'Pending') throw new HttpError(409, `This donation is already ${donation.status.toLowerCase()}.`);
  await Donation.setStatus(donation.donation_id, status);
  await logActivity(req, status === 'Received' ? 'CONFIRM_DONATION_RECEIVED' : 'CANCEL_DONATION', `Donation #${donation.donation_id}`);
  res.json({ success: true, data: await Donation.findById(donation.donation_id) });
};

exports.updateAllocation = async (req, res) => {
  const donation = await Donation.findById(req.params.id);
  if (!donation) throw new HttpError(404, 'Donation not found.');
  await Donation.updateAllocation(req.params.id, trimOrNull(req.body.allocation_notes, 3000));
  await logActivity(req, 'UPDATE_DONATION_ALLOCATION', `Donation #${req.params.id}`);
  res.json({ success: true, data: await Donation.findById(req.params.id) });
};

exports.remove = async (req, res) => {
  const donation = await Donation.findById(req.params.id);
  if (!donation) throw new HttpError(404, 'Donation not found.');
  await Donation.remove(req.params.id);
  await logActivity(req, 'DELETE_DONATION', `Donation #${req.params.id}`);
  res.json({ success: true, message: 'Donation deleted.' });
};

/** GET /api/donations/:id/receipt - PDF. Donors may only download their own. */
exports.receipt = async (req, res) => {
  const donation = await Donation.findById(req.params.id);
  if (!donation) throw new HttpError(404, 'Donation not found.');
  if (donation.status !== 'Received') throw new HttpError(409, 'A receipt is available once the donation has been received.');
  if (req.user.role === 'Donor' && donation.donor_id !== req.user.user_id) {
    throw new HttpError(403, 'You can only download receipts for your own donations.');
  }
  const settings = await Settings.getAll();
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="CareSphere-Receipt-${String(donation.donation_id).padStart(6, '0')}.pdf"`);
  await logActivity(req, 'DOWNLOAD_RECEIPT', `Donation #${donation.donation_id}`);
  await pdf.donationReceipt(res, donation, settings);
};

/** GET /api/donations/verify/:code - checks signature + record existence */
exports.verify = async (req, res) => {
  const code = String(req.params.code).trim();
  if (!receiptSignatureValid(code)) throw new HttpError(400, 'This receipt code is not authentic.');
  const donation = await Donation.findByReceipt(code);
  if (!donation) throw new HttpError(404, 'The receipt signature is valid but no matching donation exists.');
  res.json({ success: true, data: donation });
};
