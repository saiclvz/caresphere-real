/**
 * Donor directory (Donations > Donors): donor records DNR-NNNN, made from donor accounts and walk-in names.
 * Donor identity and contact details are for Admin and Staff with the "Donor directory" duty only; anyone else
 * gets ACCESS DENIED here. Contact details are masked until "Reveal", which is logged. Anonymous gifts never
 * appear on a donor's profile (they show as "Anonymous donor" everywhere). Records are never merged or deleted
 * automatically: possible duplicates are only flagged.
 */
const { pool } = require('../config/db');
const HttpError = require('../utils/HttpError');
const { toInt, likeParam, oneOf } = require('../utils/validate');
const { logActivity } = require('../utils/audit');
const { decField } = require('../utils/fieldCrypto');
const { readPagination, pageInfo } = require('../utils/pagination');
const Donation = require('../models/donationModel');
const C = require('../config/donorConfidentiality');
const L = require('../config/donationLifecycle');

const DENIED = 'ACCESS DENIED – You are not authorized to view this information.';
function requireDirectory(req) {
  if (!C.canSeeDonors(req.user) || req.user.role === 'Donor') throw new HttpError(403, DENIED, { duty: 'donor_directory' });
}

const COUNTED = Donation.COUNTED_SQL;
const STATS = `
  (SELECT COUNT(*) FROM tbl_donations d WHERE d.donor_ref_id = r.donor_ref_id AND d.is_anonymous = FALSE AND ${COUNTED}) AS donation_count,
  (SELECT COALESCE(SUM(CASE WHEN d.payment_method <> 'In-kind' THEN d.amount END), 0) FROM tbl_donations d WHERE d.donor_ref_id = r.donor_ref_id AND d.is_anonymous = FALSE AND ${COUNTED}) AS cash_total,
  (SELECT MIN(d.created_at) FROM tbl_donations d WHERE d.donor_ref_id = r.donor_ref_id AND d.is_anonymous = FALSE AND d.status <> 'Voided') AS first_donation_at,
  (SELECT MAX(d.created_at) FROM tbl_donations d WHERE d.donor_ref_id = r.donor_ref_id AND d.is_anonymous = FALSE AND d.status <> 'Voided') AS last_donation_at,
  (SELECT COUNT(*) FROM tbl_donors x WHERE x.name_key = r.name_key AND x.donor_ref_id <> r.donor_ref_id) AS same_name_count`;

const masked = (r) => ({
  contact: r.contact_enc ? C.maskContact(decField(r.contact_enc)) : null,
  email: r.email ? C.maskEmail(r.email) : null,
});

/** GET /api/donor-records?q=&type=Individual|Organization&origin=account|walk_in&page=&limit= */
exports.list = async (req, res) => {
  requireDirectory(req);
  const where = [];
  const params = [];
  if (req.query.q) { const p = likeParam(String(req.query.q).slice(0, 100)); where.push('(r.display_name LIKE ? OR r.donor_code LIKE ?)'); params.push(p, p); }
  if (req.query.type) { where.push('r.donor_type = ?'); params.push(oneOf(req.query.type, L.DONOR_TYPES, 'Donor type')); }
  if (req.query.origin) { where.push('r.origin = ?'); params.push(oneOf(req.query.origin, ['account', 'walk_in', 'staff'], 'Source')); }
  const sql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const [[{ n }]] = await pool.query(`SELECT COUNT(*) AS n FROM tbl_donors r ${sql}`, params);
  const info = pageInfo(readPagination(req.query) || { page: 1, limit: 20 }, Number(n));
  const [rows] = await pool.query(`SELECT r.donor_ref_id, r.donor_code, r.donor_type, r.display_name, r.origin, r.user_id, r.contact_enc, u.email, ${STATS}
      FROM tbl_donors r LEFT JOIN tbl_users u ON u.user_id = r.user_id ${sql}
      ORDER BY COALESCE((SELECT MAX(d.created_at) FROM tbl_donations d WHERE d.donor_ref_id = r.donor_ref_id), r.created_at) DESC, r.donor_ref_id DESC LIMIT ? OFFSET ?`,
  [...params, info.limit, info.offset]);
  await logActivity(req, 'VIEW_DONOR_DIRECTORY', 'Donor directory');
  res.json({ success: true, pagination: info, data: rows.map((r) => ({
    donor_ref_id: r.donor_ref_id, donor_code: r.donor_code, donor_type: r.donor_type, display_name: r.display_name, origin: r.origin, has_account: Boolean(r.user_id),
    donation_count: Number(r.donation_count), cash_total: Number(r.cash_total), last_donation_at: r.last_donation_at, possible_duplicate: Number(r.same_name_count) > 0, ...masked(r),
  })) });
};

async function loadDonor(req) {
  requireDirectory(req);
  const id = toInt(req.params.id, 'donor', { min: 1 });
  const [[r]] = await pool.query(`SELECT r.*, u.email, u.is_active AS account_active, ${STATS} FROM tbl_donors r LEFT JOIN tbl_users u ON u.user_id = r.user_id WHERE r.donor_ref_id = ?`, [id]);
  if (!r) throw new HttpError(404, 'Donor not found.');
  return r;
}

/** GET /api/donor-records/:id - profile: overview, donations, documents, utilization, communication, audit (Admin). */
exports.getOne = async (req, res) => {
  const r = await loadDonor(req);
  const id = r.donor_ref_id;
  const isAdmin = req.user.role === 'Admin';
  const filters = { donorRefId: id, canSeeNames: true };
  const all = (await Donation.list(filters)).filter((d) => !d.is_anonymous);
  const counted = all.filter((d) => L.COUNTED.includes(d.status));
  const ids = all.map((d) => d.donation_id);
  const q = async (sql, args) => (ids.length ? (await pool.query(sql, args))[0] : []);
  const [acks, docs, uses] = await Promise.all([
    q(`SELECT k.donation_id, d.donation_no, k.version, k.issued_at, k.reissue_reason FROM tbl_donation_acknowledgments k JOIN tbl_donations d ON d.donation_id = k.donation_id
        WHERE k.donation_id IN (?) ORDER BY k.issued_at DESC`, [ids]),
    q(`SELECT x.document_id, x.donation_id, d.donation_no, x.kind, x.label, x.uploaded_at FROM tbl_donation_documents x JOIN tbl_donations d ON d.donation_id = x.donation_id
        WHERE x.donation_id IN (?) ORDER BY x.uploaded_at DESC`, [ids]),
    q(`SELECT x.donation_id, d.donation_no, x.kind, x.program, x.quantity, x.amount, x.used_on, l.item_name FROM tbl_donation_distributions x
        JOIN tbl_donations d ON d.donation_id = x.donation_id LEFT JOIN tbl_donation_item_lines l ON l.line_id = x.line_id
        WHERE x.donation_id IN (?) AND d.status <> 'Voided' ORDER BY x.used_on DESC, x.distribution_id DESC`, [ids]),
  ]);
  // Communication: what the donor was sent (titles only; nothing sensitive is in a notification).
  const [sent] = r.user_id ? await pool.query('SELECT title, created_at, is_read FROM tbl_notifications WHERE user_id = ? AND category = ? ORDER BY created_at DESC LIMIT 50', [r.user_id, 'donations']) : [[]];
  const audit = isAdmin ? (await pool.query(`SELECT l.action_performed, l.timestamp AS created_at, l.user_role, u.full_name AS user_name FROM tbl_activity_logs l LEFT JOIN tbl_users u ON u.user_id = l.user_id
      WHERE l.target_entity = ? ORDER BY l.log_id DESC LIMIT 100`, [`Donor #${id}`]))[0] : null;
  await logActivity(req, 'VIEW_DONOR_PROFILE', `Donor #${id}`);
  const cash = counted.filter((d) => !d.in_kind);
  const kind = counted.filter((d) => d.in_kind);
  res.json({ success: true, data: {
    donor_ref_id: id, donor_code: r.donor_code, donor_type: r.donor_type, display_name: r.display_name, origin: r.origin, has_account: Boolean(r.user_id),
    account_active: r.user_id ? Boolean(r.account_active) : null, created_at: r.created_at, ...masked(r), possible_duplicate: Number(r.same_name_count) > 0,
    overview: {
      cash_total: cash.reduce((s, d) => s + d.amount, 0), in_kind_value: kind.reduce((s, d) => s + (d.estimated_value || 0), 0), in_kind_no_value: kind.filter((d) => d.estimated_value === null).length,
      donation_count: counted.length, cash_count: cash.length, in_kind_count: kind.length, first_donation_at: r.first_donation_at, last_donation_at: r.last_donation_at,
    },
    donations: all.map((d) => require('./donationController').rowFor(d, req.user)),
    documents: { acknowledgments: acks, files: docs }, utilization: uses.map((u) => ({ ...u, amount: u.amount === null ? null : Number(u.amount) })),
    communication: { acknowledgments: acks.length, notifications: sent }, audit,
  } });
};

/** POST /api/donor-records/:id/reveal - the full contact details, once; logged. */
exports.reveal = async (req, res) => {
  const r = await loadDonor(req);
  await logActivity(req, 'DONOR_CONTACT_REVEALED', `Donor #${r.donor_ref_id}`);
  res.json({ success: true, data: { contact: r.contact_enc ? decField(r.contact_enc) : null, email: r.email || null } });
};

/** GET /api/donor-records/duplicates (Admin, directory) - records with the same name, for a person to check. Never merged here. */
exports.duplicates = async (req, res) => {
  requireDirectory(req);
  const [rows] = await pool.query(`SELECT r.name_key, GROUP_CONCAT(r.donor_code ORDER BY r.donor_code SEPARATOR ', ') AS codes, COUNT(*) AS n
      FROM tbl_donors r GROUP BY r.name_key HAVING n > 1 ORDER BY r.name_key`);
  res.json({ success: true, data: rows.map((x) => ({ codes: x.codes.split(', '), count: Number(x.n) })) });
};

exports.DENIED = DENIED;
