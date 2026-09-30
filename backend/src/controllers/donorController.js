const { pool } = require('../config/db');
const Inventory = require('../models/inventoryModel');
const Donation = require('../models/donationModel');
const Child = require('../models/childModel');
const HttpError = require('../utils/HttpError');
const { toMoney, requireText, trimOrNull, oneOf } = require('../utils/validate');
const { logActivity } = require('../utils/audit');
const { PAYMENT_METHODS, makeReceiptCode } = require('./donationController');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** GET /api/donor/needed-stocks */
exports.neededStocks = async (req, res) => {
  res.json({ success: true, data: await Inventory.neededByDonors() });
};

/** GET /api/donor/child-needs - public-safe profiles that list needs */
exports.childNeeds = async (req, res) => {
  const rows = (await Child.publicList({ search: req.query.q })).filter((c) => c.urgent_needs && c.urgent_needs.trim());
  res.json({ success: true, data: rows });
};

/** GET /api/donor/history - the signed-in donor's own donations */
exports.history = async (req, res) => {
  res.json({ success: true, data: await Donation.list({ donorId: req.user.user_id, search: req.query.q, forDonor: true }) });
};

/** GET /api/donor/summary */
exports.summary = async (req, res) => {
  const totals = await Donation.donorTotals(req.user.user_id);
  const [[counts]] = await pool.query(
    `SELECT (SELECT COUNT(*) FROM tbl_children WHERE status = 'Active') AS children_in_care,
            (SELECT COUNT(*) FROM tbl_inventory WHERE quantity <= min_threshold OR is_needed_by_donors = TRUE) AS needed_items`);
  res.json({ success: true, data: { ...totals, ...counts } });
};

/**
 * POST /api/donor/donations (Donor)  header Idempotency-Key: <uuid>
 * { child_ids[], payment_method, amount, item_description, reason_for_donation }
 * Recorded as Pending until staff confirm the money or items were received.
 * Re-sending the same Idempotency-Key returns the original donation instead of a duplicate.
 */
exports.donate = async (req, res) => {
  const key = req.get('Idempotency-Key');
  if (!key || !UUID.test(key)) throw new HttpError(400, 'Missing request key. Refresh the page and try again.');
  const existing = await Donation.findByIdempotencyKey(req.user.user_id, key);
  if (existing) return res.json({ success: true, duplicate: true, data: await Donation.findById(existing, { forDonor: true }) });

  const ids = Array.isArray(req.body.child_ids) ? [...new Set(req.body.child_ids.map(String))].slice(0, 50) : [];
  if (!ids.length) throw new HttpError(400, 'Select at least one child to support.');
  const eligible = await Child.publicEligible(ids);
  if (eligible.length !== ids.length) throw new HttpError(400, 'One or more selected children are no longer available. Refresh and select again.');

  const payment_method = oneOf(req.body.payment_method, PAYMENT_METHODS, 'Payment method');
  const reason_for_donation = requireText(req.body.reason_for_donation, 'Please provide a reason for your donation.', 3000);
  const item_description = payment_method === 'In-kind'
    ? requireText(req.body.item_description, 'Describe the items you are donating.', 2000)
    : trimOrNull(req.body.item_description, 2000);
  const amount = toMoney(req.body.amount, payment_method === 'In-kind' ? 'Estimated value' : 'Amount');

  let id;
  try {
    id = await Donation.create({
      donor_id: req.user.user_id, donor_name: req.user.full_name, amount, payment_method, status: 'Pending',
      item_description, reason_for_donation, submitted_by_donor: true, qr_receipt_code: makeReceiptCode(),
      idempotency_key: key, child_ids: eligible,
    });
  } catch (err) {
    // Two identical requests raced: return the one that won.
    if (err.code === 'ER_DUP_ENTRY') {
      const winner = await Donation.findByIdempotencyKey(req.user.user_id, key);
      if (winner) return res.json({ success: true, duplicate: true, data: await Donation.findById(winner, { forDonor: true }) });
    }
    throw err;
  }
  await logActivity(req, 'SUBMIT_DONATION', `Donation #${id}`);
  res.status(201).json({ success: true, data: await Donation.findById(id, { forDonor: true }) });
};
