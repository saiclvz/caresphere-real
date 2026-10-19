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

/** GET /api/donor/history - the signed-in donor's own donations, with the steps of each report (services/donationClaims.js). */
exports.history = async (req, res) => {
  res.json({ success: true, data: await require('../services/donationClaims').donorHistory(req) });
};

/** GET /api/donor/summary */
exports.summary = async (req, res) => {
  const totals = await Donation.donorTotals(req.user.user_id);
  const [[counts]] = await pool.query(
    `SELECT (SELECT COUNT(*) FROM tbl_children WHERE status = 'Active' AND archived_at IS NULL) AS children_in_care,
            (SELECT COUNT(*) FROM tbl_inventory WHERE archived_at IS NULL AND (quantity <= min_threshold OR is_needed_by_donors = TRUE)) AS needed_items`);
  res.json({ success: true, data: { ...totals, ...counts } });
};

/**
 * POST /api/donor/donations - retired. Donors give through the home's QR codes and then report it
 * (POST /api/donor/donation-reports). Kept so an old page gets a clear message.
 */
exports.donate = async (req, res) => {
  throw new HttpError(410, 'Donating has changed. Refresh the page to see the QR codes and the "I have sent my donation" form.');
};
