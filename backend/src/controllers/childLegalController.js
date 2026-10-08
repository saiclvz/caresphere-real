/**
 * Child legal records for adoption: the CDCLAA (Certificate Declaring a Child Legally
 * Available for Adoption, RA 11642) and the sealed original birth record.
 * Both files are protected records: Staff open them only with a token, Admin directly
 * (sealed records also need a reason and the NACC order number).
 */
const { pool, withTransaction } = require('../config/db');
const HttpError = require('../utils/HttpError');
const { saveUpload, deleteUpload, MB } = require('../utils/files');
const { logActivity } = require('../utils/audit');
const P = require('../services/protectedRecords');
const env = require('../config/env');
const { deviceType } = require('../utils/device');
const { CHILD_SECTIONS } = require('../config/adoptionSensitive');
const U = require('../services/unlockService');

/** Admin: always open. Staff: only during an unlock session for this child (purpose + QR + Token ID). */
async function childAccess(req, childId) {
  if (req.user.role === 'Admin') return { unlocked: true, admin: true };
  const s = await U.sessionFor(req, 'health', childId);
  return { unlocked: Boolean(s), expires_at: s?.expires_at || null, remaining_seconds: s?.remaining_seconds || 0, purpose: s?.purpose || null };
}

const DOC_OPTS = { allowed: ['pdf', 'png', 'jpg'], maxBytes: 10 * MB };
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const SEALED_KINDS = { original_birth_certificate: 'Original birth certificate', natural_parents_identity: "Natural parents' identity" };

async function child(id, conn = pool, lock = false) {
  const [[c]] = await conn.query(`SELECT * FROM tbl_children WHERE child_id = ? ${lock ? 'FOR UPDATE' : ''}`, [id]);
  if (!c) throw new HttpError(404, 'Child record not found.');
  return c;
}

/** CDCLAA summary for the child page (no file key). */
async function cdclaaSummary(childId) {
  const c = await child(childId);
  const [[rec]] = await pool.query("SELECT record_id, public_id FROM tbl_protected_records WHERE child_id = ? AND record_type = 'cdclaa' ORDER BY record_id DESC LIMIT 1", [childId]);
  return {
    number: c.cdclaa_number, date: c.cdclaa_date, has_file: !!c.cdclaa_storage_key, file_name: c.cdclaa_original_name,
    verified_at: c.cdclaa_verified_at, verified: !!c.cdclaa_verified_at, placement_status: c.placement_status,
    available_for_adoption: !!c.available_for_adoption, original_birth_sealed: !!c.original_birth_sealed,
    protected_record: rec || null,
  };
}

/**
 * GET /api/children/:id/cdclaa (Admin, Staff)
 * Staff without a token for this child get only the locked summary (verified or not, placement).
 */
exports.getCdclaa = async (req, res) => {
  const summary = await cdclaaSummary(req.params.id);
  const access = await childAccess(req, req.params.id);
  const sensitive = { unlocked: access.unlocked, admin: !!access.admin, expires_at: access.expires_at || null,
    remaining_seconds: access.remaining_seconds || 0, purpose: access.purpose || null, sections: CHILD_SECTIONS };
  if (!access.unlocked) {
    return res.json({ success: true, data: { locked: true, verified: summary.verified, placement_status: summary.placement_status,
      available_for_adoption: summary.available_for_adoption, original_birth_sealed: summary.original_birth_sealed, sensitive } });
  }
  await logActivity(req, `VIEW_CHILD_ADOPTION_LEGAL (${deviceType(req) || 'unknown device'})`, `Child ${req.params.id}`);
  await U.logEvent(req, { recordType: 'health', recordId: req.params.id, event: 'view_sections', purpose: access.admin ? 'Admin full access' : access.purpose, detail: 'CDCLAA' });
  res.json({ success: true, data: { ...summary, locked: false, sensitive } });
};

/**
 * PUT /api/children/:id/assign (Admin) { staff_user_id | null } - the child's case worker (health records).
 * Shared assignment logic (services/assignment.js): who/when, audit with old and new staff, notification,
 * and other staff's open unlocks for the child end.
 */
exports.assignStaff = async (req, res) => {
  const c = await child(req.params.id);
  await require('../services/assignment').assign(req, 'child', c.child_id, req.body?.staff_user_id, c.child_id);
  const [[r]] = await pool.query('SELECT c.assigned_staff_id, u.full_name AS assigned_staff_name FROM tbl_children c LEFT JOIN tbl_users u ON u.user_id = c.assigned_staff_id WHERE c.child_id = ?', [c.child_id]);
  res.json({ success: true, data: r });
};
