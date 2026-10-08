const env = require('../config/env');
const Donation = require('../models/donationModel');
const User = require('../models/userModel');
const Settings = require('../models/settingsModel');
const pdf = require('../services/pdfService');
const HttpError = require('../utils/HttpError');
const Notify = require('../services/notifications');
const { hmac, safeEqual } = require('../utils/crypto');
const {
  toInt, toMoney, requireDate, oneOf, isBlank, requireText, toBool,
} = require('../utils/validate');
const { logActivity, logActivityWith } = require('../utils/audit');

// Donor information is confidential: viewing the lists is logged, at most once per user and list every 5 minutes.
const lastView = new Map();
function logView(req, code, what) {
  const key = `${req.user.user_id}:${code}`;
  if (Date.now() - (lastView.get(key) || 0) < 5 * 60 * 1000) return;
  lastView.set(key, Date.now());
  logActivity(req, code, what).catch(() => {});
}
exports.logView = logView;
const { pool, withTransaction } = require('../config/db');
const { readDateFilter } = require('../config/listFilters');

/** Every method a donation can have (old rows and filters keep working). */
const PAYMENT_METHODS = ['Cash', 'GCash', 'Maya', 'Bank Transfer', 'Check', 'In-kind'];
/** Staff "Record a donation" (Donations page and Visitors log): what is handed over at the home. */
const RECORD_METHODS = ['Cash', 'In-kind'];
const STATUSES = ['Pending', 'Received', 'Cancelled'];
/** List filter: also bank transfers waiting for verification and rejected ones. */
const FILTER_STATUSES = [...STATUSES, 'Pending verification', 'Rejected'];
const SOURCES = ['portal', 'walk_in', 'staff']; // Source filter labels
const MAX_ITEMS = 20;
const PH_MOBILE = /^(09\d{9}|\+639\d{9}|639\d{9})$/;
const RECEIPT = ['issued', 'not_issued'];

const { recordDonation, makeReceiptCode } = require('../services/donationService');

function receiptSignatureValid(code) {
  const [base, sig] = String(code).split('.');
  if (!base || !sig) return false;
  return safeEqual(sig, hmac(base, env.receiptKey).slice(0, 16));
}

exports.PAYMENT_METHODS = PAYMENT_METHODS;
exports.RECORD_METHODS = RECORD_METHODS;
exports.makeReceiptCode = makeReceiptCode;

/**
 * GET /api/donations?date=all|today|yesterday|last7|custom&date_from=&date_to=
 *                   &source=visitor|online|staff&method=&receipt=issued|not_issued&status=&q=
 * Every filter is combined with AND on the server. `summary` totals the filtered list
 * with the same rules as the Dashboard and Donor history.
 */
exports.list = async (req, res) => {
  const q = req.query;
  // Older clients sent from/to directly.
  const dates = q.from || q.to
    ? { from: q.from ? requireDate(q.from, 'From date') : undefined, to: q.to ? requireDate(q.to, 'To date') : undefined }
    : readDateFilter(q, 'all');
  const filters = {
    from: dates.from,
    to: dates.to,
    donorId: q.donor_id ? toInt(q.donor_id, 'donor_id', { min: 1 }) : undefined,
    status: q.status ? oneOf(q.status, FILTER_STATUSES, 'Status') : undefined,
    source: q.source ? oneOf(q.source, SOURCES, 'Source') : undefined,
    // Any recorded method name (Admin can rename donor payment methods in Settings).
    method: q.method ? String(q.method).trim().slice(0, 60) : undefined,
    receipt: q.receipt ? oneOf(q.receipt, RECEIPT, 'Receipt') : undefined,
    search: q.q,
  };
  const [rows, summary] = await Promise.all([Donation.list(filters), Donation.summary(filters)]);
  const { forViewer } = require('../config/donorConfidentiality');
  logView(req, 'VIEW_DONATIONS', 'Donations list');
  res.json({ success: true, data: rows.map((r) => forViewer(r, req.user.role)), summary });
};

/** GET /api/donations/donors - donor accounts for the "record donation" form */
exports.donors = async (req, res) => {
  const donors = (await User.list({ role: 'Donor' })).filter((d) => d.is_active);
  // Names only for Staff (donor contact details are confidential); Admin also sees the email.
  res.json({ success: true, data: donors.map(({ user_id, full_name, email }) => (req.user.role === 'Admin' ? { user_id, full_name, email } : { user_id, full_name })) });
};

/** Validates in-kind item lines: an existing inventory item or a new one, each with a quantity. */
function cleanItems(raw) {
  const items = Array.isArray(raw) ? raw : [];
  if (!items.length) throw new HttpError(400, 'Add at least one donated item for an in-kind donation.');
  if (items.length > MAX_ITEMS) throw new HttpError(400, `Add up to ${MAX_ITEMS} items per donation.`);
  const seenIds = new Set();
  const seenNames = new Set();
  return items.map((line, i) => {
    const n = i + 1;
    if (isBlank(line?.quantity)) throw new HttpError(400, `Item ${n}: quantity is required.`);
    const quantity = toInt(line.quantity, `Item ${n} quantity`, { min: 1, max: 1000000 });
    if (line.new_item) {
      const name = requireText(line.new_item.item_name, `Item ${n}: item name is required.`, 100);
      const category = requireText(line.new_item.category, `Item ${n}: category is required.`, 50);
      if (seenNames.has(name.toLowerCase())) throw new HttpError(400, `"${name}" is listed twice. Combine the quantities.`);
      seenNames.add(name.toLowerCase());
      return { new_item: { item_name: name, category, min_threshold: 5 }, quantity };
    }
    if (isBlank(line?.item_id)) throw new HttpError(400, `Item ${n}: choose an inventory item.`);
    const itemId = toInt(line.item_id, `Item ${n}`, { min: 1 });
    if (seenIds.has(itemId)) throw new HttpError(400, 'The same inventory item is listed twice. Combine the quantities.');
    seenIds.add(itemId);
    return { item_id: itemId, quantity };
  });
}

/**
 * POST /api/donations (Admin, Staff) - the shared "Record donation" form (Donations and Visitors pages).
 * Donor type: registered (donor_id) or walk_in (walk_in_name, optional walk_in_contact).
 * visit_id links the donation to a visit (one donation per visit).
 * Also required: amount (estimated value optional for in-kind), method, reason, description,
 * how it will be used, and children or "general". In-kind needs at least one item.
 */
exports.create = async (req, res) => {
  const b = req.body || {};
  if (isBlank(b.donor_type)) throw new HttpError(400, 'Donor type is required.');
  const donorType = oneOf(String(b.donor_type), ['registered', 'walk_in'], 'Donor type');
  const d = { donor_type: donorType };
  if (donorType === 'registered') {
    if (isBlank(b.donor_id)) throw new HttpError(400, 'Donor is required.');
    const donor = await User.findById(toInt(b.donor_id, 'Donor', { min: 1 }));
    if (!donor || donor.role !== 'Donor') throw new HttpError(400, 'Select a registered donor account.');
    d.donor = donor;
  } else {
    d.walk_in_name = requireText(b.walk_in_name, 'Full name is required.', 100);
    if (d.walk_in_name.length < 2) throw new HttpError(400, 'Full name must be at least 2 characters.');
    if (!isBlank(b.walk_in_contact)) {
      const contact = String(b.walk_in_contact).trim();
      if (!PH_MOBILE.test(contact.replace(/[\s-]/g, ''))) throw new HttpError(400, 'Enter a valid PH mobile number (09XX XXX XXXX), or leave it blank.');
      d.walk_in_contact = contact.slice(0, 30);
    }
  }
  if (!isBlank(b.visit_id)) d.visit_id = toInt(b.visit_id, 'Visit', { min: 1 });

  if (isBlank(b.payment_method)) throw new HttpError(400, 'Payment method is required.');
  // Record a donation: Cash or In-kind only (online methods come from the donor portal).
  d.payment_method = oneOf(b.payment_method, RECORD_METHODS, 'Payment method');
  const inKind = d.payment_method === 'In-kind';
  if (inKind) {
    d.items = cleanItems(b.items);
    d.amount = isBlank(b.amount) || Number(b.amount) === 0 ? 0 : toMoney(b.amount, 'Estimated value');
  } else {
    if (isBlank(b.amount)) throw new HttpError(400, 'Amount is required.');
    d.amount = toMoney(b.amount, 'Amount');
    d.items = [];
  }
  // The Reason dropdown was removed; older donations keep their saved reason.
  d.reason_category = null;
  d.description = requireText(b.description, 'Description is required.', 2000);
  d.allocation_notes = requireText(b.allocation_notes, 'Allocation is required.', 3000);

  // Every donation recorded by Admin or Staff is general. A children list from an older
  // client is ignored (not an error); existing child links on old donations are kept.
  d.is_general = true;
  d.child_ids = [];

  const result = await recordDonation(req, d);
  res.status(201).json({ success: true, data: await Donation.findById(result.donationId) });
};

/** PUT /api/donations/:id/status (Admin, Staff) { status: 'Received' | 'Cancelled' } - confirms donor pledges */
exports.updateStatus = async (req, res) => {
  const donation = await Donation.findById(req.params.id);
  // Bank transfers are confirmed or rejected in the verification queue, never here.
  if (donation?.status === 'Pending verification') throw new HttpError(409, 'This bank transfer is waiting for verification. Confirm or reject it in "Bank transfers to verify".');
  if (!donation) throw new HttpError(404, 'Donation not found.');
  const status = oneOf(req.body.status, ['Received', 'Cancelled'], 'status');
  if (donation.status !== 'Pending') throw new HttpError(409, `This donation is already ${donation.status.toLowerCase()}.`);
  // Donor-portal donations arrive without an allocation: staff add it when confirming.
  const notes = status === 'Received' && !donation.allocation_notes
    ? requireText(req.body.allocation_notes, 'Add the allocation (how the donation will be used) before marking it received.', 3000) : null;
  // Status, allocation, audit entry and the donor's "receipt issued" notification in one transaction.
  await withTransaction(async (conn) => {
    if (notes) await conn.query('UPDATE tbl_donations SET allocation_notes = ? WHERE donation_id = ?', [notes, donation.donation_id]);
    await conn.query(`UPDATE tbl_donations SET status = ?, received_at = ${status === 'Received' ? 'NOW()' : 'received_at'} WHERE donation_id = ?`, [status, donation.donation_id]);
    await logActivityWith(conn, req, status === 'Received' ? 'CONFIRM_DONATION_RECEIVED' : 'CANCEL_DONATION', `Donation #${donation.donation_id}`);
    if (status === 'Received' && donation.donor_id) {
      await Notify.emit(conn, 'receipt_issued', { userId: donation.donor_id, entityType: 'donation', entityId: donation.donation_id, groupKey: `receipt_issued:donation:${donation.donation_id}` });
      await Notify.toAdmins(conn, 'admin_donation_received', { params: { source: 'portal' }, groupKey: 'donations_received', mode: 'count', exceptUserId: req.user.user_id });
    }
  });
  res.json({ success: true, data: await Donation.findById(donation.donation_id) });
};

/**
 * PUT /api/donations/:id (Admin, Staff) { amount?, payment_method?, allocation_notes?, receipt_issued? }
 * The one place to edit a donation, including walk-in visitor donations.
 * In-kind walk-in donations keep the "In-kind" method because their items are in Inventory.
 */
exports.update = async (req, res) => {
  const donation = await Donation.findById(req.params.id);
  // Bank transfers are confirmed or rejected in the verification queue, never here.
  if (donation?.status === 'Pending verification') throw new HttpError(409, 'This bank transfer is waiting for verification. Confirm or reject it in "Bank transfers to verify".');
  if (!donation) throw new HttpError(404, 'Donation not found.');
  const b = req.body || {};
  const fields = {};
  const hasItems = (await Donation.items(donation.donation_id)).length > 0;

  if (b.payment_method !== undefined) {
    // Cash or In-kind, or the method it already has (e.g. a donor-portal GCash donation).
    const allowed = [...new Set([...RECORD_METHODS, donation.payment_method])];
    const method = oneOf(b.payment_method, allowed, 'Method');
    if (hasItems && method !== 'In-kind') throw new HttpError(409, 'This donation added items to Inventory, so its method stays In-kind.');
    if (!hasItems && method === 'In-kind' && donation.payment_method !== 'In-kind') {
      throw new HttpError(409, 'In-kind gifts are recorded with their items through Record donation, so the method can\'t be changed to In-kind here.');
    }
    if (method !== donation.payment_method) fields.payment_method = method;
  }
  const method = fields.payment_method || donation.payment_method;
  if (b.amount !== undefined) {
    // In-kind amounts are an optional estimated value (0 = not estimated).
    const amount = method === 'In-kind' && (isBlank(b.amount) || Number(b.amount) === 0) ? 0 : toMoney(b.amount, method === 'In-kind' ? 'Estimated value' : 'Amount');
    if (amount !== Number(donation.amount)) fields.amount = amount;
  }
  // Allocation is required: older donations without one ("Not recorded") must get it on their next edit.
  if (isBlank(b.allocation_notes)) {
    throw new HttpError(400, 'Allocation is required.');
  } else {
    const notes = requireText(b.allocation_notes, 'Allocation is required.', 3000);
    if (notes !== donation.allocation_notes) fields.allocation_notes = notes;
  }
  if (b.receipt_issued !== undefined) {
    const issued = toBool(b.receipt_issued);
    if (issued && donation.status !== 'Received') throw new HttpError(409, 'A receipt can only be issued once the donation is received.');
    if (issued && !(fields.allocation_notes || donation.allocation_notes)) throw new HttpError(409, 'Add the allocation before issuing a receipt.');
    if (issued !== !!donation.receipt_issued) fields.receipt_issued = issued ? 1 : 0;
  }
  if (!Object.keys(fields).length) return res.json({ success: true, data: donation, message: 'No changes.' });

  await Donation.update(donation.donation_id, fields);
  await logActivity(req, `UPDATE_DONATION (${Object.keys(fields).join(', ')})`, `Donation #${donation.donation_id}`);
  res.json({ success: true, data: await Donation.findById(donation.donation_id) });
};

/**
 * DELETE /api/donations/:id (Admin). A walk-in donation is unlinked from its visit (the
 * visit stays as "Just visited") and any in-kind stock it added is taken back out.
 */
exports.remove = async (req, res) => {
  const donation = await Donation.findById(req.params.id);
  if (!donation) throw new HttpError(404, 'Donation not found.');
  const { removeDonation } = require('../services/donationService');
  const reversed = await withTransaction((conn) => removeDonation(conn, donation.donation_id, req.user.user_id));
  await logActivity(req, `DELETE_DONATION (${donation.donor_type}, ${donation.source}${donation.visit_id ? `, visit #${donation.visit_id} kept as Just visited` : ''})`, `Donation #${donation.donation_id}`);
  for (const it of reversed) await logActivity(req, `INVENTORY_DONATION_REVERSAL (-${it.quantity}, donation #${donation.donation_id})`, `Inventory #${it.item_id}`);
  res.json({ success: true, message: reversed.length ? 'Donation deleted and its items were taken back out of Inventory.' : 'Donation deleted.' });
};

/** GET /api/donations/:id/receipt - PDF. Donors may only download their own. */
exports.receipt = async (req, res) => {
  const donation = await Donation.findById(req.params.id);
  if (!donation) throw new HttpError(404, 'Donation not found.');
  if (donation.status !== 'Received') throw new HttpError(409, 'A receipt is available once the donation has been received.');
  if (req.user.role === 'Donor' && donation.donor_id !== req.user.user_id) {
    throw new HttpError(403, 'You can only download receipts for your own donations.');
  }
  // A receipt can't be issued until the allocation is set.
  if (!donation.allocation_notes) {
    throw new HttpError(409, req.user.role === 'Donor'
      ? 'The home is still completing this donation\'s record. Your receipt will be available soon.'
      : 'Add the allocation (Edit) before issuing a receipt.');
  }
  const settings = await Settings.getAll();
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="CareSphere-Receipt-${String(donation.donation_id).padStart(6, '0')}.pdf"`);
  await logActivity(req, 'DOWNLOAD_RECEIPT', `Donation #${donation.donation_id}`);
  await Donation.markReceiptIssued(donation.donation_id);
  await pdf.donationReceipt(res, donation, settings);
};

const RECEIPT_CODE = /^[A-Za-z0-9._-]+$/;
const RECEIPT_CODE_MAX = 64;
const NOT_FOUND = 'Code not found. Check that it was copied exactly.';

/** Only the receipt details a verifier needs. A walk-in's contact number goes to Admin and Staff only. */
function receiptView(d, role) {
  const group = d.source === 'portal' ? 'Portal' : d.donor_type === 'walk_in' ? 'Walk-in' : 'Staff recorded';
  return {
    donation_id: d.donation_id,
    receipt_no: String(d.donation_id).padStart(6, '0'),
    donor_name: d.donor_name,
    donor_type: d.donor_type,
    source_label: group,
    amount: d.amount,
    payment_method: d.payment_method,
    status: d.status,
    created_at: d.created_at,
    ...(d.donor_type === 'walk_in' && ['Admin', 'Staff'].includes(role) ? { walk_in_contact: d.walk_in_contact || null } : {}),
  };
}

/**
 * GET /api/donations/verify/:code (Admin, Staff; rate-limited)
 * Checks the code's signature, then that a donation with that code exists. Works for
 * portal and walk-in receipts alike. Failed attempts are written to the audit log.
 */
exports.verify = async (req, res) => {
  // Printed codes can wrap onto two lines, so whitespace inside is removed as well as trimmed.
  const code = String(req.params.code ?? '').replace(/\s+/g, '');
  const fail = async (status, reason) => {
    await logActivity(req, `VERIFY_RECEIPT_FAILED (${reason})`, `Code ${code.slice(0, 40) || '(empty)'}`);
    return new HttpError(status, status === 400 && reason !== 'not authentic' ? reason : NOT_FOUND);
  };
  if (!code) throw await fail(400, 'The receipt code is required.');
  if (code.length > RECEIPT_CODE_MAX) throw await fail(400, `The receipt code is too long (max ${RECEIPT_CODE_MAX} characters).`);
  if (!RECEIPT_CODE.test(code)) throw await fail(400, 'The receipt code can only contain letters, numbers, dots, dashes and underscores.');
  if (!receiptSignatureValid(code)) throw await fail(404, 'not authentic');
  const donation = await Donation.findByReceipt(code);
  if (!donation) throw await fail(404, 'no matching donation');
  await logActivity(req, 'VERIFY_RECEIPT', `Donation #${donation.donation_id}`);
  res.json({ success: true, data: receiptView(donation, req.user.role) });
};

/** GET /api/donations/methods (Admin, Staff) - every method name used so far plus the current donor methods, for the filter. */
exports.methods = async (req, res) => {
  const [rows] = await pool.query(
    `SELECT payment_method AS name FROM tbl_donations GROUP BY payment_method
     UNION SELECT name FROM tbl_payment_methods ORDER BY name`);
  res.json({ success: true, data: rows.map((r) => r.name) });
};
