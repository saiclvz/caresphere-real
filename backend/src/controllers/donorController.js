const { pool } = require('../config/db');
const Inventory = require('../models/inventoryModel');
const Donation = require('../models/donationModel');
const Child = require('../models/childModel');
const HttpError = require('../utils/HttpError');

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
 * POST /api/donor/donations - replaced by /api/payments/checkout (e-wallets through PayMongo) and
 * /api/payments/bank (bank transfer with proof). Kept so an old page gets a clear message instead of
 * creating an unverified "Pending" donation.
 */
exports.donate = async (req, res) => {
  throw new HttpError(410, 'Donating has changed. Refresh the page to use the new payment options.');
};
