const env = require('../config/env');
const Donation = require('../models/donationModel');
const User = require('../models/userModel');
const Settings = require('../models/settingsModel');
const pdf = require('../services/pdfService');
const HttpError = require('../utils/HttpError');
const { hmac, safeEqual } = require('../utils/crypto');
const { toInt, toMoney, oneOf, isBlank, requireText, requireDate } = require('../utils/validate');
const { logActivity, logActivityWith } = require('../utils/audit');
const { readPagination, pageInfo } = require('../utils/pagination');
const { pool, withTransaction } = require('../config/db');
const { readDateFilter } = require('../config/listFilters');
const { saveUpload, readUpload, verifyUpload, discardUnsavedUpload, MB } = require('../utils/files');
const L = require('../config/donationLifecycle');
const LC = require('../services/donationLifecycle');
const C = require('../config/donorConfidentiality');
const { recordDonation, makeReceiptCode, moveStock } = require('../services/donationService');

// Donor information is confidential: viewing the lists is logged, at most once per user and list every 5 minutes.
const lastView = new Map();
function logView(req, code, what) {
  const key = `${req.user.user_id}:${code}`;
  if (Date.now() - (lastView.get(key) || 0) < 5 * 60 * 1000) return;
  lastView.set(key, Date.now());
  logActivity(req, code, what).catch(() => {});
}
exports.logView = logView;

/** Every method a donation can have (old rows and filters keep working). */
const PAYMENT_METHODS = ['Cash', 'GCash', 'Maya', 'Bank Transfer', 'Check', 'In-kind'];
/** Staff "Record a donation" (Donations page and Visitors log): what is handed over at the home. */
const RECORD_METHODS = ['Cash', 'In-kind'];
const SOURCES = ['portal', 'walk_in', 'staff'];
const MAX_ITEMS = 20;
const PH_MOBILE = /^(09\d{9}|\+639\d{9}|639\d{9})$/;

exports.PAYMENT_METHODS = PAYMENT_METHODS;
exports.RECORD_METHODS = RECORD_METHODS;
exports.makeReceiptCode = makeReceiptCode;

function receiptSignatureValid(code) {
  const [base, sig] = String(code).split('.');
  if (!base || !sig) return false;
  return safeEqual(sig, hmac(base, env.receiptKey).slice(0, 16));
}

const sourceGroup = (d) => (d.source === 'portal' ? 'portal' : d.donor_type === 'walk_in' ? 'walk_in' : 'staff');

/** What the viewer may do with a donation. */
function actionsFor(d, user) {
  const isAdmin = user.role === 'Admin';
  const voided = d.status === 'Voided';
  return {
    can_edit: !voided && L.EDITABLE.includes(d.status),
    can_correct: !voided && L.ACKNOWLEDGED_OR_LATER.includes(d.status),
    can_download: !voided && d.has_acknowledgment,
    can_void: !voided && isAdmin,
    can_request_void: !voided && !isAdmin && !d.void_requested,
  };
}
/** The one next action the page offers. */
function nextAction(d) {
  const ready = !d.allocation_missing && !d.allocation_needs_review;
  switch (d.status) {
    case 'Pending verification': return d.claim_status === 'Awaiting approval' ? { key: 'approve_claim', label: 'Approve the verification' } : { key: 'verify_claim', label: 'Verify the donor report' };
    case 'Pending': return d.dual_control === 'Waiting' ? { key: 'confirm_cash', label: 'Confirm the cash (second person)' } : { key: 'Received', label: 'Mark received' };
    case 'Received':
      if (d.in_kind) return { key: 'Under inspection', label: 'Start inspection' };
      return ready ? { key: 'Accepted', label: 'Accept donation' } : { key: 'allocation', label: 'Add the allocation' };
    case 'Under inspection': return ready ? { key: 'Accepted', label: 'Accept donation' } : { key: 'allocation', label: 'Add the allocation' };
    case 'Accepted': return ready ? { key: 'acknowledge', label: 'Issue acknowledgment' } : { key: 'allocation', label: 'Review the allocation' };
    case 'Acknowledged': return { key: 'Allocated', label: 'Confirm allocation' };
    case 'Allocated': case 'Partially distributed': return { key: d.in_kind ? 'distribute' : 'utilize', label: d.in_kind ? 'Record distribution' : 'Record utilization' };
    case 'Fully distributed': return { key: 'Closed', label: 'Close donation' };
    default: return null;
  }
}

/** The list row as this viewer may see it. */
function rowFor(d, user) {
  const v = C.forViewer(d, user);
  return {
    ...v, method_label: L.methodLabel(d.payment_method), source_group: sourceGroup(d),
    value_missing: d.in_kind && d.estimated_value === null, ...actionsFor(d, user), next_action: nextAction(d),
    // Older free-text allocation stays visible until the donation is converted.
    allocation_text: d.allocation.length ? null : (d.allocation_notes || null),
  };
}

/** Filters from the query string (shared by the list, the cards and the export). */
function readFilters(req) {
  const qy = req.query;
  const dates = readDateFilter(qy, 'all');
  return {
    from: dates.from, to: dates.to,
    type: qy.type ? oneOf(qy.type, ['cash', 'in_kind'], 'Type') : undefined,
    source: qy.source ? oneOf(qy.source, SOURCES, 'Source') : undefined,
    status: qy.status ? oneOf(qy.status, [...L.FILTER_STATUSES, 'Cancelled', 'counted'], 'Status') : undefined,
    attention: qy.attention === '1',
    method: qy.method ? String(qy.method).trim().slice(0, 60) : undefined,
    receipt: qy.receipt ? oneOf(qy.receipt, ['issued', 'not_issued'], 'Receipt') : undefined,
    purpose: qy.purpose ? oneOf(qy.purpose, L.PURPOSES, 'Purpose') : undefined,
    donorType: qy.donor_type ? oneOf(qy.donor_type, [...L.DONOR_TYPES, 'anonymous'], 'Donor type') : undefined,
    needsReview: qy.needs_review === '1',
    valueMissing: qy.value_missing === '1',
    donorRefId: qy.donor ? toInt(qy.donor, 'donor', { min: 1 }) : undefined,
    search: qy.q ? String(qy.q).trim().slice(0, 100) : undefined,
    canSeeNames: C.canSeeDonors(req.user),
  };
}
exports.readFilters = readFilters;
exports.rowFor = rowFor;

/**
 * GET /api/donations?date=&date_from=&date_to=&type=&source=&status=&attention=&method=&receipt=&purpose=&donor_type=
 *   &needs_review=&q=&page=&limit=
 * Filters combine (AND) on the server, sorted by most recent activity. `meta.cards` are the page cards
 * (verified or accepted donations only, never Voided).
 */
exports.list = async (req, res) => {
  const filters = readFilters(req);
  const paging = readPagination(req.query) || { page: 1, limit: 20 };
  const total = await Donation.count(filters);
  const info = pageInfo(paging, total);
  const [result, cards] = await Promise.all([Donation.list(filters, { limit: info.limit, offset: info.offset }), Donation.cards(filters)]);
  logView(req, 'VIEW_DONATIONS', 'Donations list');
  res.json({ success: true, data: result.rows.map((d) => rowFor(d, req.user)), pagination: info, meta: { cards, shown: total } });
};

/** GET /api/donations/options - everything the filters and forms list. */
exports.options = async (req, res) => {
  const [rows] = await pool.query('SELECT payment_method AS name FROM tbl_donations GROUP BY payment_method UNION SELECT name FROM tbl_payment_methods ORDER BY name');
  res.json({ success: true, data: {
    methods: rows.map((r) => ({ value: r.name, label: L.methodLabel(r.name) })), statuses: L.FILTER_STATUSES, purposes: L.PURPOSES, programs: L.PROGRAMS,
    void_reasons: L.VOID_REASONS, donor_types: L.DONOR_TYPES, document_kinds: L.DOCUMENT_KINDS, can_see_donors: C.canSeeDonors(req.user),
  } });
};
/** GET /api/donations/methods (kept for older pages). */
exports.methods = async (req, res) => {
  const [rows] = await pool.query('SELECT payment_method AS name FROM tbl_donations GROUP BY payment_method UNION SELECT name FROM tbl_payment_methods ORDER BY name');
  res.json({ success: true, data: rows.map((r) => r.name) });
};

/** GET /api/donations/donors - donor accounts for the "record donation" form (Admin also sees the email). */
exports.donors = async (req, res) => {
  const donors = (await User.list({ role: 'Donor' })).filter((d) => d.is_active);
  const [codes] = await pool.query('SELECT user_id, donor_code FROM tbl_donors WHERE user_id IS NOT NULL');
  const code = Object.fromEntries(codes.map((c) => [c.user_id, c.donor_code]));
  const sees = C.canSeeDonors(req.user);
  // Staff without the Donor directory duty pick by donor code and initials (no names, no email).
  res.json({ success: true, data: donors.map(({ user_id, full_name, email }) => ({
    user_id, donor_code: code[user_id] || null,
    full_name: sees ? full_name : [code[user_id], C.initials(full_name)].filter(Boolean).join(' · '),
    ...(req.user.role === 'Admin' ? { email } : {}),
  })) });
};

/** GET /api/donations/inventory-items - items an in-kind donation can go into (id, name, category, quantity). */
exports.inventoryItems = async (req, res) => {
  const items = await require('../models/inventoryModel').list();
  res.json({ success: true, data: items.map(({ item_id, item_name, category, quantity }) => ({ item_id, item_name, category, quantity })) });
};

// ---------------------------------------------------------------- record

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
    const value = isBlank(line?.estimated_value) ? null : toMoney(line.estimated_value, `Item ${n} estimated value`);
    const expiry = isBlank(line?.expiry_date) ? null : requireDate(line.expiry_date, `Item ${n} expiry date`);
    const extra = { quantity, estimated_value: value || null, expiry_date: expiry };
    if (line.new_item) {
      const name = requireText(line.new_item.item_name, `Item ${n}: item name is required.`, 100);
      const category = requireText(line.new_item.category, `Item ${n}: category is required.`, 50);
      if (seenNames.has(name.toLowerCase())) throw new HttpError(400, `"${name}" is listed twice. Combine the quantities.`);
      seenNames.add(name.toLowerCase());
      return { new_item: { item_name: name, category, min_threshold: 5 }, ...extra };
    }
    if (isBlank(line?.item_id)) throw new HttpError(400, `Item ${n}: choose an inventory item.`);
    const itemId = toInt(line.item_id, `Item ${n}`, { min: 1 });
    if (seenIds.has(itemId)) throw new HttpError(400, 'The same inventory item is listed twice. Combine the quantities.');
    seenIds.add(itemId);
    return { item_id: itemId, ...extra };
  });
}

/**
 * POST /api/donations (Admin, Staff) - the shared "Record donation" form (Donations and Visitors pages).
 * Donor: registered (donor_id) or walk-in (walk_in_name, optional walk_in_contact, walk_in_kind Individual |
 * Organization), optionally anonymous. Cash or In-kind. Purpose and allocation lines are required (cash lines
 * add up to the amount; in-kind lines give the intended use). Every donation recorded here is general.
 */
exports.create = async (req, res) => {
  const b = req.body || {};
  if (isBlank(b.donor_type)) throw new HttpError(400, 'Donor type is required.');
  const donorType = oneOf(String(b.donor_type), ['registered', 'walk_in'], 'Donor type');
  const d = { donor_type: donorType, anonymous: b.anonymous === true };
  if (donorType === 'registered') {
    if (isBlank(b.donor_id)) throw new HttpError(400, 'Donor is required.');
    const donor = await User.findById(toInt(b.donor_id, 'Donor', { min: 1 }));
    if (!donor || donor.role !== 'Donor') throw new HttpError(400, 'Select a registered donor account.');
    d.donor = donor;
  } else {
    d.walk_in_name = requireText(b.walk_in_name, 'Full name is required.', 100);
    if (d.walk_in_name.length < 2) throw new HttpError(400, 'Full name must be at least 2 characters.');
    d.walk_in_kind = b.walk_in_kind ? oneOf(b.walk_in_kind, L.DONOR_TYPES, 'Donor type') : 'Individual';
    if (!isBlank(b.walk_in_contact)) {
      const contact = String(b.walk_in_contact).trim();
      if (!PH_MOBILE.test(contact.replace(/[\s-]/g, ''))) throw new HttpError(400, 'Enter a valid PH mobile number (09XX XXX XXXX), or leave it blank.');
      d.walk_in_contact = contact.slice(0, 30);
    }
  }
  if (!isBlank(b.visit_id)) d.visit_id = toInt(b.visit_id, 'Visit', { min: 1 });
  if (isBlank(b.payment_method)) throw new HttpError(400, 'Payment method is required.');
  d.payment_method = oneOf(b.payment_method, RECORD_METHODS, 'Payment method');
  const inKind = d.payment_method === 'In-kind';
  if (inKind) { d.items = cleanItems(b.items); d.amount = 0; } else {
    if (isBlank(b.amount)) throw new HttpError(400, 'Amount is required.');
    d.amount = toMoney(b.amount, 'Amount');
    if (!(d.amount > 0)) throw new HttpError(400, 'Enter an amount greater than 0.');
    d.items = [];
  }
  d.description = requireText(b.description, 'Description is required.', 2000);
  if (isBlank(b.purpose)) throw new HttpError(422, 'Choose the purpose.', { errors: { purpose: 'Choose the purpose.' } });
  d.purpose = oneOf(b.purpose, L.PURPOSES, 'Purpose');
  const errors = {};
  d.allocation = LC.cleanAllocation(b.allocation, { amount: d.amount, inKind }, errors);
  if (Object.keys(errors).length) throw new HttpError(422, 'Check the allocation.', { errors });
  const result = await recordDonation(req, d);
  const saved = await Donation.findById(result.donationId);
  res.status(201).json({ success: true, data: rowFor(saved, req.user) });
};

// ---------------------------------------------------------------- detail

async function load(req) {
  const d = await Donation.findById(toInt(req.params.id, 'id', { min: 1 }));
  if (!d) throw new HttpError(404, 'Donation not found.');
  return d;
}

/** Stepper: the lifecycle steps for this donation, with where it is now. */
function stepper(d) {
  const steps = ['Received', ...(d.in_kind ? ['Under inspection'] : []), 'Accepted', 'Acknowledged', 'Allocated', 'Distributed', 'Closed'];
  const idx = { Pending: -1, 'Pending verification': -1, 'Partially distributed': steps.indexOf('Distributed'), 'Fully distributed': steps.indexOf('Distributed') + 1 };
  const at = d.status in idx ? idx[d.status] : steps.indexOf(d.status);
  const closed = d.status === 'Closed';
  return steps.map((s, i) => ({
    label: s === 'Distributed' && !d.in_kind ? 'Used' : s,
    state: closed || i < at ? 'completed' : i === at ? 'current' : 'pending',
  }));
}

/** GET /api/donations/:id - the donation page: overview, donor, items, inventory, utilization, documents, timeline, audit. */
exports.getOne = async (req, res) => {
  const d = await load(req);
  const id = d.donation_id;
  const isAdmin = req.user.role === 'Admin';
  const sees = C.canSeeDonors(req.user);
  const q = async (sql, args = [id]) => (await pool.query(sql, args))[0];
  const [lines, lots, movements, distributions, history, acks, corrections, docs, voidReq, payment] = await Promise.all([
    q('SELECT l.*, i.item_name AS inventory_name FROM tbl_donation_item_lines l LEFT JOIN tbl_inventory i ON i.item_id = l.inventory_item_id WHERE l.donation_id = ? ORDER BY l.line_id'),
    q('SELECT lt.*, i.item_name FROM tbl_inventory_lots lt JOIN tbl_inventory i ON i.item_id = lt.item_id WHERE lt.donation_id = ? ORDER BY lt.expiry_date IS NULL, lt.expiry_date, lt.lot_id'),
    q(`SELECT m.movement_id, m.item_id, i.item_name, m.movement_type, m.change_qty, m.quantity_after, m.lot_id, m.note, m.created_at, u.full_name AS by_name
         FROM tbl_inventory_movements m JOIN tbl_inventory i ON i.item_id = m.item_id LEFT JOIN tbl_users u ON u.user_id = m.created_by WHERE m.donation_id = ? ORDER BY m.created_at, m.movement_id`),
    q(`SELECT x.*, l.item_name, u.full_name AS recorded_by_name FROM tbl_donation_distributions x LEFT JOIN tbl_donation_item_lines l ON l.line_id = x.line_id
         JOIN tbl_users u ON u.user_id = x.recorded_by WHERE x.donation_id = ? ORDER BY x.used_on DESC, x.distribution_id DESC`),
    q('SELECT h.history_id, h.from_status, h.to_status, h.note, h.created_at, u.full_name AS actor_name FROM tbl_donation_status_history h LEFT JOIN tbl_users u ON u.user_id = h.actor_id WHERE h.donation_id = ? ORDER BY h.created_at, h.history_id'),
    q('SELECT k.ack_id, k.ack_no, k.version, k.issued_at, k.reissue_reason, u.full_name AS issued_by_name FROM tbl_donation_acknowledgments k LEFT JOIN tbl_users u ON u.user_id = k.issued_by WHERE k.donation_id = ? ORDER BY k.version'),
    q('SELECT c.*, u.full_name AS made_by_name FROM tbl_donation_corrections c JOIN tbl_users u ON u.user_id = c.made_by WHERE c.donation_id = ? ORDER BY c.made_at DESC'),
    q('SELECT d.document_id, d.kind, d.label, d.original_name, d.mime_type, d.size_bytes, d.uploaded_at, d.duplicate_of, u.full_name AS uploaded_by_name, r.role_name AS uploaded_by_role FROM tbl_donation_documents d JOIN tbl_users u ON u.user_id = d.uploaded_by JOIN tbl_roles r ON r.role_id = u.role_id WHERE d.donation_id = ? ORDER BY d.uploaded_at DESC'),
    q(`SELECT r.request_id, r.reason, r.note, r.status, r.requested_at, u.full_name AS requested_by_name, r.decided_at, r.decision_note FROM tbl_donation_void_requests r
         JOIN tbl_users u ON u.user_id = r.requested_by WHERE r.donation_id = ? ORDER BY r.requested_at DESC`),
    // Legacy online-gateway or bank-transfer payment (read-only, migration 037): shown for history only.
    q('SELECT p.payment_id, p.method_name, p.gateway, p.status, p.paid_at, p.verified_at, m.mapped_as FROM tbl_payments p LEFT JOIN tbl_legacy_payment_map m ON m.payment_id = p.payment_id WHERE p.donation_id = ?'),
  ]);
  const totals = await LC.distributionTotals(pool, d);
  // Donor: identity only for Admin and the Donor directory duty; anonymous shows as such everywhere.
  const donor = {
    code: d.donor_code || null, display: C.donorLabel(d, req.user), anonymous: d.is_anonymous, masked: !sees, ref_id: d.donor_ref_id,
    kind: d.donor_kind || null, source: sourceGroup(d), registered: d.donor_type === 'registered',
    contact_masked: sees && d.donor_type === 'walk_in' && d.walk_in_contact && !d.is_anonymous ? C.maskContact(d.walk_in_contact) : null,
    recorded_name: isAdmin && d.is_anonymous ? (d.walk_in_name || d.donor_name) : undefined,
  };
  const audit = isAdmin ? await q(`SELECT l.log_id, l.action_performed, l.timestamp AS created_at, l.user_role, u.full_name AS user_name FROM tbl_activity_logs l LEFT JOIN tbl_users u ON u.user_id = l.user_id
      WHERE l.target_entity = ? ORDER BY l.log_id DESC LIMIT 200`, [`Donation #${id}`]) : null;
  await logActivity(req, 'VIEW_DONATION', `Donation #${id}`);
  res.json({ success: true, data: {
    ...rowFor(d, req.user), donor, stepper: stepper(d), allowed: L.TRANSITIONS[d.status] || [], allocation_problems: await LC.allocationProblems(pool, d),
    items: lines.map((l) => ({ ...l, estimated_value: l.estimated_value === null ? null : Number(l.estimated_value), remaining: lots.filter((x) => x.line_id === l.line_id).reduce((s, x) => s + x.remaining_qty, 0) })),
    lots, movements, distributions: distributions.map((x) => ({ ...x, amount: x.amount === null ? null : Number(x.amount) })), distribution_totals: totals,
    timeline: history, acknowledgments: acks, corrections, documents: docs.map((x) => ({ ...x, kind_label: x.kind === 'donor_proof' ? 'Proof from the donor (not verification)' : L.DOCUMENT_KINDS[x.kind] || x.kind, duplicate: !!x.duplicate_of })),
    void_requests: voidReq, legacy_payment: payment[0] ? { ...payment[0], read_only: true } : null, audit,
    claim: await require('../services/donationClaims').claimDetail(req, d),
    dual_control: d.dual_control ? { status: d.dual_control, can_confirm: d.dual_control === 'Waiting' && d.recorded_by !== req.user.user_id } : null,
    visit: d.visit_id ? { visit_id: d.visit_id, check_in_time: d.linked_visit_time } : null,
  } });
};

// ---------------------------------------------------------------- actions

/** Runs an action on the locked donation in one transaction, then returns the fresh row. */
const act = (fn, message) => async (req, res) => {
  const d0 = await load(req);
  await withTransaction(async (conn) => {
    const d = await LC.lockDonation(conn, d0.donation_id);
    await fn(conn, req, { ...d, amount: Number(d.amount), in_kind: d.payment_method === 'In-kind' });
  });
  const fresh = await Donation.findById(d0.donation_id);
  res.json({ success: true, data: rowFor(fresh, req.user), message });
};

/** POST /api/donations/:id/status { to, note } - the next allowed step (Received, Under inspection, Accepted, Allocated, Closed, Rejected). */
exports.transition = act(async (conn, req, d) => {
  if (d.status === 'Pending verification') throw new HttpError(409, "This donor report is waiting for verification. Verify it against the home's account in Donations > To verify.");
  await LC.transition(conn, req, d, String(req.body?.to || ''), String(req.body?.note || '').trim().slice(0, 255) || null);
}, 'Status updated.');

/** PUT /api/donations/:id/status (older pages) { status: 'Received' | 'Cancelled' } -> Received / Rejected. */
exports.updateStatus = async (req, res, next) => {
  const cancel = req.body?.status === 'Cancelled';
  req.body = { to: cancel ? 'Rejected' : req.body?.status, note: cancel ? 'Cancelled' : null };
  return exports.transition(req, res, next);
};

/** POST /api/donations/:id/acknowledgment { reason? } - issue (or reissue, with a reason). */
exports.acknowledge = act(async (conn, req, d) => {
  const version = await LC.acknowledge(conn, req, d, { reason: req.body?.reason });
  if (d.donor_id && version === 1) {
    await require('../services/notifications').emit(conn, 'receipt_issued', { userId: d.donor_id, entityType: 'donation', entityId: d.donation_id, groupKey: `receipt_issued:donation:${d.donation_id}` });
  }
}, 'Acknowledgment issued.');

/**
 * PUT /api/donations/:id/allocation { lines: [{ program, amount | intended_use }], purpose, reason? }
 * Before acknowledgment: replaces the allocation. Afterwards: a correction entry with a reason.
 */
exports.setAllocation = act(async (conn, req, d) => {
  if (['Voided', 'Rejected', 'Cancelled', 'Closed'].includes(d.status)) throw new HttpError(409, `A ${d.status.toLowerCase()} donation can't be changed.`);
  const errors = {};
  const lines = LC.cleanAllocation(req.body?.lines, { amount: d.amount, inKind: d.in_kind }, errors);
  const purpose = req.body?.purpose ? oneOf(req.body.purpose, L.PURPOSES, 'Purpose') : null;
  if (Object.keys(errors).length) throw new HttpError(422, 'Check the allocation.', { errors });
  const fmt = (ls) => ls.map((l) => `${l.program}${l.amount !== null ? ` ${Number(l.amount).toFixed(2)}` : ''}`).join('; ');
  if (L.ACKNOWLEDGED_OR_LATER.includes(d.status)) await LC.correction(conn, req, d, 'allocation', fmt(await LC.activeAllocations(conn, d.donation_id)), fmt(lines), req.body?.reason);
  await LC.setAllocation(conn, req, d, lines, { purpose });
  if (purpose) await conn.query('UPDATE tbl_donations SET purpose = ? WHERE donation_id = ?', [purpose, d.donation_id]);
  await logActivityWith(conn, req, 'DONATION_ALLOCATION_SET', `Donation #${d.donation_id}`);
}, 'Allocation saved.');

/**
 * PUT /api/donations/:id - Edit, only before acknowledgment: amount (cash), purpose, description, anonymous.
 * After acknowledgment, corrections (with a reason) are used instead.
 */
exports.update = act(async (conn, req, d) => {
  if (!L.EDITABLE.includes(d.status)) {
    const ack = L.ACKNOWLEDGED_OR_LATER.includes(d.status);
    throw new HttpError(409, ack ? 'This donation is acknowledged. Make a correction (with a reason) instead of editing it.' : `A ${d.status.toLowerCase()} donation can't be edited.`, { use_correction: ack });
  }
  const b = req.body || {};
  const fields = {};
  if (b.amount !== undefined && d.claim_status) throw new HttpError(409, "The amount of a donor report is the amount verified against the home's account. It can't be edited here.");
  if (b.amount !== undefined && d.dual_control) throw new HttpError(409, 'This cash amount was confirmed by a second person. Void and record it again if it is wrong.');
  if (b.amount !== undefined && !d.in_kind) {
    const amount = toMoney(b.amount, 'Amount');
    if (!(amount > 0)) throw new HttpError(422, 'Enter an amount greater than 0.', { errors: { amount: 'Enter an amount greater than 0.' } });
    if (amount !== Number(d.amount)) fields.amount = amount;
  }
  if (b.purpose !== undefined) fields.purpose = oneOf(b.purpose, L.PURPOSES, 'Purpose');
  if (b.description !== undefined) fields.item_description = requireText(b.description, 'Description is required.', 2000);
  if (b.anonymous !== undefined) fields.is_anonymous = b.anonymous === true ? 1 : 0;
  if (!Object.keys(fields).length) return;
  await Donation.update(d.donation_id, fields, conn);
  await logActivityWith(conn, req, `UPDATE_DONATION (${Object.keys(fields).join(', ')})`, `Donation #${d.donation_id}`);
  // A changed cash amount no longer matches the allocation: back to Received until the allocation is fixed.
  if (fields.amount && d.status === 'Accepted' && (await LC.allocationProblems(conn, { ...d, amount: fields.amount })).length) {
    await LC.setStatus(conn, req, d, 'Received', 'Amount changed: allocation to be updated');
  }
}, 'Donation updated.');

/** POST /api/donations/:id/corrections { field: amount | purpose | payment_method, value, reason } - after acknowledgment. */
exports.correct = act(async (conn, req, d) => {
  if (d.status === 'Voided') throw new HttpError(409, "A voided donation can't be corrected.");
  if (!L.ACKNOWLEDGED_OR_LATER.includes(d.status)) throw new HttpError(409, 'Before acknowledgment, use Edit.');
  const field = oneOf(req.body?.field, L.CORRECTABLE, 'Field');
  if (d.claim_status && ['amount', 'payment_method'].includes(field)) throw new HttpError(409, "A donor report's amount and method come from the verification. If they are wrong, an administrator voids the donation.");
  let value = req.body?.value;
  if (field === 'amount') {
    if (d.in_kind) throw new HttpError(409, 'In-kind values are corrected on each item.');
    value = toMoney(value, 'Amount');
    if (!(value > 0)) throw new HttpError(422, 'Enter an amount greater than 0.', { errors: { value: 'Enter an amount greater than 0.' } });
  } else if (field === 'purpose') value = oneOf(value, L.PURPOSES, 'Purpose');
  else { if (d.in_kind) throw new HttpError(409, 'An in-kind donation stays In-kind.'); value = requireText(value, 'Enter the method.', 60); }
  await LC.correction(conn, req, d, field, d[field], value, req.body?.reason);
  await conn.query(`UPDATE tbl_donations SET ${field} = ? WHERE donation_id = ?`, [value, d.donation_id]);
}, 'Correction recorded. Reissue the acknowledgment if the donor needs an updated copy.');

/** PUT /api/donations/:id/items/:lineId { estimated_value, expiry_date, item_condition, reason? } - "Add value"; a value already set changes by correction after acknowledgment. */
exports.updateItem = act(async (conn, req, d) => {
  const [[line]] = await conn.query('SELECT * FROM tbl_donation_item_lines WHERE line_id = ? AND donation_id = ? FOR UPDATE', [toInt(req.params.lineId, 'item', { min: 1 }), d.donation_id]);
  if (!line) throw new HttpError(404, 'Item not found.');
  if (d.status === 'Voided') throw new HttpError(409, "A voided donation can't be changed.");
  const b = req.body || {};
  const value = isBlank(b.estimated_value) ? null : toMoney(b.estimated_value, 'Estimated value');
  if (value !== null && !(value > 0)) throw new HttpError(422, 'Enter a value greater than 0.', { errors: { estimated_value: 'Enter a value greater than 0.' } });
  const expiry = isBlank(b.expiry_date) ? null : requireDate(b.expiry_date, 'Expiry date');
  const changingSet = line.estimated_value !== null && Number(line.estimated_value) !== value;
  if (changingSet && L.ACKNOWLEDGED_OR_LATER.includes(d.status)) await LC.correction(conn, req, d, `item_value:${line.line_id}`, line.estimated_value, value, b.reason);
  await conn.query('UPDATE tbl_donation_item_lines SET estimated_value = ?, expiry_date = ?, item_condition = ? WHERE line_id = ?',
    [value, expiry, isBlank(b.item_condition) ? line.item_condition : String(b.item_condition).slice(0, 30), line.line_id]);
  await conn.query('UPDATE tbl_inventory_lots SET expiry_date = ? WHERE line_id = ?', [expiry, line.line_id]);
  await conn.query('UPDATE tbl_donations SET last_activity_at = NOW() WHERE donation_id = ?', [d.donation_id]);
  await logActivityWith(conn, req, `DONATION_ITEM_UPDATED (${value === null ? 'no value' : 'value set'})`, `Donation #${d.donation_id}`);
}, 'Item saved.');

/** POST /api/donations/:id/distributions { line_id, quantity, program, used_on, note } (in-kind) */
exports.distribute = act(async (conn, req, d) => {
  if (!d.in_kind) throw new HttpError(409, 'Cash donations record utilization instead.');
  await LC.recordDistribution(conn, req, d, req.body || {}, moveStock);
}, 'Distribution recorded.');
/** POST /api/donations/:id/utilization { amount, program, used_on, note } (cash) */
exports.utilize = act(async (conn, req, d) => {
  if (d.in_kind) throw new HttpError(409, 'In-kind donations record distribution instead.');
  await LC.recordUtilization(conn, req, d, req.body || {});
}, 'Utilization recorded.');

/** POST /api/donations/:id/void (Admin) { reason, note, correction? } */
exports.voidDonation = act(async (conn, req, d) => { await LC.voidDonation(conn, req, d, req.body || {}, moveStock); }, 'Donation voided. It stays in the list and is left out of every total.');
/** POST /api/donations/:id/void-request (Staff) { reason, note } */
exports.requestVoid = act(async (conn, req, d) => { await LC.requestVoid(conn, req, d, req.body || {}); }, 'Void requested. An administrator will review it.');
/** POST /api/donations/:id/void-request/decline (Admin) { note } */
exports.declineVoid = act(async (conn, req, d) => { await LC.declineVoid(conn, req, d, req.body?.note); }, 'Void request declined.');

// ---------------------------------------------------------------- documents

/** POST /api/donations/:id/documents { kind, label, file, no_children } - delivery receipt, proof of transfer, photos (never of children). */
exports.uploadDocument = async (req, res) => {
  const d = await load(req);
  if (d.status === 'Voided') throw new HttpError(409, "A voided donation can't get new documents.");
  const b = req.body || {};
  const kind = oneOf(b.kind, Object.keys(L.DOCUMENT_KINDS), 'Document type');
  const label = String(b.label || L.DOCUMENT_KINDS[kind]).trim().slice(0, 150);
  if (kind === 'photo' && b.no_children !== true) throw new HttpError(422, 'Confirm that the photo shows no children.', { errors: { no_children: 'Confirm that the photo shows no children.' } });
  const saved = saveUpload(b.file, { folder: 'donations', allowed: kind === 'photo' ? ['png', 'jpg'] : ['pdf', 'png', 'jpg'], maxBytes: 10 * MB, label });
  try {
    await withTransaction(async (conn) => {
      await conn.query(`INSERT INTO tbl_donation_documents (donation_id, kind, label, original_name, mime_type, size_bytes, storage_key, sha256, no_children_confirmed, uploaded_by)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [d.donation_id, kind, label, saved.original_name, saved.mime_type, saved.size_bytes, saved.storage_key, saved.sha256, kind === 'photo' ? 1 : 0, req.user.user_id]);
      await conn.query('UPDATE tbl_donations SET last_activity_at = NOW() WHERE donation_id = ?', [d.donation_id]);
      await logActivityWith(conn, req, `UPLOAD_DONATION_DOCUMENT (${kind})`, `Donation #${d.donation_id}`);
    });
  } catch (err) { discardUnsavedUpload(saved.storage_key); throw err; }
  res.status(201).json({ success: true, data: { ok: true } });
};

/** GET /api/donations/:id/documents/:docId/link - a short-lived signed link to the file (bound to this user). */
exports.documentLink = async (req, res) => {
  const d = await load(req);
  const [[doc]] = await pool.query('SELECT document_id FROM tbl_donation_documents WHERE document_id = ? AND donation_id = ?', [toInt(req.params.docId, 'document', { min: 1 }), d.donation_id]);
  if (!doc) throw new HttpError(404, 'Document not found.');
  const links = require('../utils/signedLinks');
  res.json({ success: true, data: { url: links.url(links.sign({ kind: 'donation_doc', id: doc.document_id, userId: req.user.user_id })), expires_in: links.LINK_SECONDS } });
};

/** Sends a donation document after the signed link was checked: Staff/Admin with Donations, or the donor for their own proof. Logged. */
exports.sendDocument = async (req, res, docId) => {
  const [[doc]] = await pool.query('SELECT x.*, d.donor_id FROM tbl_donation_documents x JOIN tbl_donations d ON d.donation_id = x.donation_id WHERE x.document_id = ?', [docId]);
  const { hasDuty } = require('../middleware/requireDuty');
  const staffOk = req.user.role === 'Admin' || (req.user.role === 'Staff' && hasDuty(req, 'donations'));
  const donorOk = req.user.role === 'Donor' && doc && doc.kind === 'donor_proof' && doc.donor_id === req.user.user_id && doc.uploaded_by === req.user.user_id;
  if (!doc || !(staffOk || donorOk)) throw new HttpError(404, 'This link has expired. Open the file again from its page.');
  const intact = verifyUpload(doc.storage_key, doc.sha256);
  await logActivity(req, `VIEW_DONATION_DOCUMENT (${doc.kind}${intact === false ? ', integrity check failed' : ''})`, `Donation #${doc.donation_id}`);
  res.setHeader('Content-Type', doc.mime_type);
  res.setHeader('Content-Disposition', `inline; filename="${doc.original_name.replace(/["\r\n]/g, '')}"`);
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.send(readUpload(doc.storage_key));
};

// ---------------------------------------------------------------- acknowledgment PDF and receipt check

/** Who may have this donation's acknowledgment: the donor (their own), Admin, Staff with Donations. Not before it is issued, never once voided. */
async function receiptCheck(req, d) {
  const { hasDuty } = require('../middleware/requireDuty');
  const ok = req.user.role === 'Admin' || (req.user.role === 'Staff' && hasDuty(req, 'donations')) || (req.user.role === 'Donor' && d.donor_id === req.user.user_id);
  if (!ok) throw new HttpError(404, 'Donation not found.');
  if (d.status === 'Voided') throw new HttpError(409, 'This donation was voided, so its acknowledgment is no longer valid.');
  if (!d.has_acknowledgment) {
    throw new HttpError(409, req.user.role === 'Donor'
      ? "The home is still completing this donation's record. Your receipt will be available soon."
      : 'Issue the acknowledgment first (the donation must be accepted).');
  }
}

/** GET /api/donations/:id/receipt/link - a short-lived signed link to the acknowledgment PDF. */
exports.receiptLink = async (req, res) => {
  const d = await load(req);
  await receiptCheck(req, d);
  const links = require('../utils/signedLinks');
  res.json({ success: true, data: { url: links.url(links.sign({ kind: 'receipt', id: d.donation_id, userId: req.user.user_id })), expires_in: links.LINK_SECONDS } });
};

/** Sends the acknowledgment PDF after the signed link was checked (the checks are repeated). */
exports.sendReceipt = async (req, res, donationId) => {
  const d = await Donation.findById(donationId);
  if (!d) throw new HttpError(404, 'This link has expired. Open the file again from its page.');
  await receiptCheck(req, d);
  const settings = await Settings.getAll();
  const [lines] = await pool.query('SELECT item_name, quantity, estimated_value FROM tbl_donation_item_lines WHERE donation_id = ? ORDER BY line_id', [d.donation_id]);
  const [[ack]] = await pool.query('SELECT ack_no FROM tbl_donation_acknowledgments WHERE donation_id = ? ORDER BY version DESC LIMIT 1', [d.donation_id]);
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="CareSphere-Acknowledgment-${d.donation_no || d.donation_id}.pdf"`);
  res.setHeader('Cache-Control', 'no-store');
  await logActivity(req, 'DOWNLOAD_RECEIPT', `Donation #${d.donation_id}`);
  await pdf.donationReceipt(res, { ...d, ack_no: ack?.ack_no || null, donor_name: d.is_anonymous ? C.ANONYMOUS : d.donor_name, item_lines: lines, method_label: L.methodLabel(d.payment_method) }, settings);
};

const RECEIPT_CODE = /^[A-Za-z0-9._-]+$/;
const RECEIPT_CODE_MAX = 64;
const NOT_FOUND = 'Code not found. Check that it was copied exactly.';

/** Only the receipt details a verifier needs. */
function receiptView(d, user) {
  const group = d.source === 'portal' ? 'Portal' : d.donor_type === 'walk_in' ? 'Walk-in' : 'Staff recorded';
  return {
    donation_id: d.donation_id, receipt_no: d.ack_no || d.donation_no || String(d.donation_id).padStart(6, '0'), donation_no: d.donation_no, ack_no: d.ack_no || null,
    donor_name: C.donorLabel({ ...d, is_anonymous: !!d.is_anonymous, donor_record_name: null }, user), donor_type: d.donor_type, source_label: group,
    amount: d.amount, payment_method: L.methodLabel(d.payment_method), status: d.status, void_reason: d.status === 'Voided' ? d.void_reason : null, created_at: d.created_at,
    ...(d.donor_type === 'walk_in' && C.canSeeDonors(user) && !d.is_anonymous ? { walk_in_contact: d.walk_in_contact ? C.maskContact(d.walk_in_contact) : null } : {}),
  };
}

/**
 * GET /api/donations/verify/:code (Admin, Staff; rate-limited). Checks the code's signature, then that a donation
 * with that code exists. Voided donations are reported as voided. Failed attempts are logged.
 */
const verifyFailures = new Map(); // ip -> [timestamps]: a growing delay after repeated failures
exports.verify = async (req, res) => {
  const code = String(req.params.code ?? '').replace(/\s+/g, '');
  const since = Date.now() - 10 * 60 * 1000;
  const recent = (verifyFailures.get(req.ip) || []).filter((t) => t > since);
  if (recent.length >= 3) await new Promise((r) => setTimeout(r, Math.min(5000, 500 * (recent.length - 2))));
  const fail = async (status, reason) => {
    recent.push(Date.now()); verifyFailures.set(req.ip, recent);
    // Only the first characters of the code are logged (never the signature part).
    await logActivity(req, `VERIFY_RECEIPT_FAILED (${reason})`, `Code ${code.slice(0, 12) || '(empty)'}...`);
    return new HttpError(status, status === 400 && reason !== 'not authentic' ? reason : NOT_FOUND);
  };
  if (!code) throw await fail(400, 'The receipt code is required.');
  if (code.length > RECEIPT_CODE_MAX) throw await fail(400, `The receipt code is too long (max ${RECEIPT_CODE_MAX} characters).`);
  if (!RECEIPT_CODE.test(code)) throw await fail(400, 'The receipt code can only contain letters, numbers, dots, dashes and underscores.');
  if (!receiptSignatureValid(code)) throw await fail(404, 'not authentic');
  const donation = await Donation.findByReceipt(code);
  if (!donation) throw await fail(404, 'no matching donation');
  // Voided receipts and donations without an issued acknowledgment are "not found" (nothing else is revealed).
  if (donation.status === 'Voided') throw await fail(404, 'voided receipt');
  const [[ack]] = await pool.query('SELECT ack_no FROM tbl_donation_acknowledgments WHERE donation_id = ? ORDER BY version DESC LIMIT 1', [donation.donation_id]);
  if (!ack && !donation.receipt_issued) throw await fail(404, 'not acknowledged');
  donation.ack_no = ack?.ack_no || null;
  await logActivity(req, 'VERIFY_RECEIPT', `Donation #${donation.donation_id}`);
  res.json({ success: true, data: receiptView(donation, req.user) });
};

// ---------------------------------------------------------------- export and reports (donor codes only)

const csv = (rows) => rows.map((r) => r.map((v) => { const s = v === null || v === undefined ? '' : String(v); return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; }).join(',')).join('\r\n');

/** GET /api/donations/export - the filtered list as CSV: donation numbers and donor codes, never names. Logged. */
exports.exportCsv = async (req, res) => {
  const filters = { ...readFilters(req), canSeeNames: false };
  const rows = await Donation.list(filters);
  const out = [['Donation', 'Date', 'Donor code', 'Anonymous', 'Source', 'Type', 'Method', 'Amount (cash)', 'Estimated value (in-kind)', 'Purpose', 'Status', 'Acknowledgment', 'Allocation', 'Void reason']];
  for (const d of rows) {
    out.push([d.donation_no, new Date(d.created_at).toISOString().slice(0, 10), d.donor_code || '', d.is_anonymous ? 'Yes' : 'No', sourceGroup(d), d.in_kind ? 'In-kind' : 'Cash',
      L.methodLabel(d.payment_method), d.in_kind ? '' : d.amount.toFixed(2), d.in_kind && d.estimated_value !== null ? d.estimated_value.toFixed(2) : '', d.purpose || '', d.status,
      d.has_acknowledgment ? 'Issued' : 'Not issued', d.allocation.map((a) => `${a.program}${a.amount !== null ? ` ${a.amount.toFixed(2)}` : ''}${a.needs_review ? ' (needs review)' : ''}`).join('; '), d.void_reason || '']);
  }
  await logActivity(req, `EXPORT_DONATIONS (${rows.length} rows, donor codes only)`, 'Donations list');
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="donations-${new Date().toISOString().slice(0, 10)}.csv"`);
  res.send(`﻿${csv(out)}`);
};

/**
 * GET /api/donations/reports?date=&date_from=&date_to=[&format=csv] - totals by month, source, purpose and
 * allocation program, statuses, and utilization. Verified or accepted donations only, never Voided.
 */
exports.reports = async (req, res) => {
  const dates = readDateFilter(req.query, 'all');
  const { sql, params } = Donation.buildWhere({ from: dates.from, to: dates.to });
  const where = `${sql ? `${sql} AND` : 'WHERE'} ${Donation.COUNTED_SQL}`;
  const base = `${Donation.FROM_SQL} ${where}`;
  const cash = `CASE WHEN ${Donation.IN_KIND_SQL} THEN 0 ELSE d.amount END`;
  const est = `COALESCE(${Donation.EST_VALUE_SQL}, 0)`;
  const sel = `COUNT(*) AS count, COALESCE(SUM(${cash}), 0) AS cash, COALESCE(SUM(${est}), 0) AS in_kind`;
  const [byMonth] = await pool.query(`SELECT DATE_FORMAT(d.created_at, '%Y-%m') AS label, ${sel} ${base} GROUP BY label ORDER BY label`, params);
  const [bySource] = await pool.query(`SELECT CASE WHEN d.source = 'portal' THEN 'Portal' WHEN d.donor_type = 'walk_in' THEN 'Walk-in' ELSE 'Staff recorded' END AS label, ${sel} ${base} GROUP BY label ORDER BY label`, params);
  const [byPurpose] = await pool.query(`SELECT COALESCE(d.purpose, 'Not set') AS label, ${sel} ${base} GROUP BY label ORDER BY label`, params);
  const [byProgram] = await pool.query(`SELECT a.program AS label, COUNT(DISTINCT d.donation_id) AS count, COALESCE(SUM(a.amount), 0) AS allocated, COALESCE(SUM(a.needs_review), 0) AS needs_review
      ${Donation.FROM_SQL} JOIN tbl_donation_allocations a ON a.donation_id = d.donation_id AND a.superseded_at IS NULL ${where} GROUP BY a.program ORDER BY a.program`, params);
  const [byStatus] = await pool.query(`SELECT d.status AS label, COUNT(*) AS count ${Donation.FROM_SQL} ${sql} GROUP BY d.status`, params);
  const [[used]] = await pool.query(`SELECT COALESCE(SUM(CASE WHEN x.kind = 'utilization' THEN x.amount END), 0) AS cash_used, COALESCE(SUM(CASE WHEN x.kind = 'distribution' THEN x.quantity END), 0) AS items_distributed
      FROM tbl_donation_distributions x JOIN tbl_donations d ON d.donation_id = x.donation_id LEFT JOIN tbl_donors dr ON dr.donor_ref_id = d.donor_ref_id ${where}`, params);
  const num = (rows) => rows.map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, k === 'label' ? v : Number(v || 0)])));
  const statusOrder = (rows) => [...rows].sort((a, b) => L.STATUSES.indexOf(a.label) - L.STATUSES.indexOf(b.label));
  const data = {
    period: dates, by_month: num(byMonth), by_source: num(bySource), by_purpose: num(byPurpose), by_program: num(byProgram), by_status: statusOrder(num(byStatus)),
    utilization: { cash_used: Number(used.cash_used), items_distributed: Number(used.items_distributed) }, cards: await Donation.cards({ from: dates.from, to: dates.to }),
  };
  if (req.query.format === 'csv') {
    const out = [['Section', 'Label', 'Count', 'Cash (PHP)', 'In-kind estimated (PHP)', 'Allocated (PHP)']];
    for (const [name, rows] of [['Month', data.by_month], ['Source', data.by_source], ['Purpose', data.by_purpose]]) rows.forEach((r) => out.push([name, r.label, r.count, r.cash.toFixed(2), r.in_kind.toFixed(2), '']));
    data.by_program.forEach((r) => out.push(['Allocation program', r.label, r.count, '', '', r.allocated.toFixed(2)]));
    data.by_status.forEach((r) => out.push(['Status (all donations)', r.label, r.count, '', '', '']));
    await logActivity(req, `EXPORT_DONATION_REPORT (${dates.from || 'start'} to ${dates.to || 'today'})`, 'Donation reports');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="donation-report-${new Date().toISOString().slice(0, 10)}.csv"`);
    return res.send(`﻿${csv(out)}`);
  }
  await logActivity(req, 'VIEW_DONATION_REPORTS', 'Donation reports');
  res.json({ success: true, data });
};

exports._internal = { nextAction, stepper };
