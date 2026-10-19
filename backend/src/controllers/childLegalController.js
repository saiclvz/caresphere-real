/**
 * Child legal records for adoption: the CDCLAA (Certificate Declaring a Child Legally
 * Available for Adoption, RA 11642) and the sealed original birth record.
 * Both files are protected records: Staff open them only with a token, Admin directly
 * (sealed records also need a reason and the NACC order number).
 */
const { pool, withTransaction } = require('../config/db');
const HttpError = require('../utils/HttpError');
const { saveUpload, discardUnsavedUpload, MB } = require('../utils/files');
const Retained = require('../services/retainedFiles');
const { logActivity } = require('../utils/audit');
const P = require('../services/protectedRecords');
const env = require('../config/env');
const { deviceType } = require('../utils/device');
const { CHILD_SECTIONS } = require('../config/adoptionSensitive');
const U = require('../services/unlockService');

/** Level 3 through the child record policy: Admin always; Staff only when assigned, during an unlock session. */
async function childAccess(req, childId) {
  return require('../services/childAccess').sensitiveAccess(req, childId);
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
 * PUT /api/children/:id/cdclaa (Admin, Staff) { number, date, file? }
 * Recording or changing the CDCLAA clears its verification, and the child stops being
 * Available for adoption until an Admin verifies it again.
 */
exports.saveCdclaa = async (req, res) => {
  const id = req.params.id;
  // Level 3 (adoption legal record): Admin, or the assigned Staff member during an unlock session.
  const gate = await childAccess(req, id);
  if (!gate.unlocked) throw new HttpError(403, 'Unlock the child record to record the CDCLAA.', { locked: true });
  const number = String(req.body?.number || '').trim();
  const date = String(req.body?.date || '').trim();
  if (!number) throw new HttpError(400, 'CDCLAA number is required.');
  if (number.length > 80) throw new HttpError(400, 'CDCLAA number can be up to 80 characters.');
  if (!DATE.test(date)) throw new HttpError(400, 'Enter the CDCLAA issue date.');
  const saved = req.body?.file ? saveUpload(req.body.file, { ...DOC_OPTS, folder: 'child-legal', label: 'CDCLAA copy' }) : null;
  let oldKey = null;
  try {
    await withTransaction(async (conn) => {
      const c = await child(id, conn, true);
      if (c.status !== 'Active') throw new HttpError(409, `The child is ${c.status.toLowerCase()}; the CDCLAA can no longer change.`);
      const set = { cdclaa_number: number, cdclaa_date: date, cdclaa_recorded_by: req.user.user_id, cdclaa_verified_at: null, cdclaa_verified_by: null,
        available_for_adoption: 0 };
      if (saved) {
        oldKey = c.cdclaa_storage_key;
        // The previous copy stays on disk, recorded as Replaced (files are never deleted).
        if (oldKey) await Retained.retain(conn, req, { area: 'cdclaa', childId: id, key: oldKey, originalName: c.cdclaa_original_name, mime: c.cdclaa_mime, sha: c.cdclaa_sha256, status: 'Replaced', replacedByKey: saved.storage_key });
        Object.assign(set, { cdclaa_storage_key: saved.storage_key, cdclaa_original_name: saved.original_name, cdclaa_mime: saved.mime_type,
          cdclaa_size: saved.size_bytes, cdclaa_sha256: saved.sha256 });
      }
      const keys = Object.keys(set);
      await conn.query(`UPDATE tbl_children SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE child_id = ?`, [...keys.map((k) => set[k]), id]);
      const [[rec]] = await conn.query("SELECT record_id FROM tbl_protected_records WHERE child_id = ? AND record_type = 'cdclaa'", [id]);
      if (!rec && (saved || c.cdclaa_storage_key)) await P.createRecord(conn, { type: 'cdclaa', label: `CDCLAA, ${id}`, childId: id, createdBy: req.user.user_id });
    });
  } catch (err) {
    if (saved) discardUnsavedUpload(saved.storage_key);
    throw err;
  }
  await logActivity(req, `CDCLAA_RECORDED${saved ? ' (file uploaded)' : ''}`, `Child ${id}`);
  res.json({ success: true, data: await cdclaaSummary(id) });
};

/** POST /api/children/:id/cdclaa/verify (Admin) - requires number, date and an uploaded copy. */
exports.verifyCdclaa = async (req, res) => {
  const id = req.params.id;
  const c = await child(id);
  if (!c.cdclaa_number || !c.cdclaa_date || !c.cdclaa_storage_key) throw new HttpError(409, 'Record the CDCLAA number, issue date and an uploaded copy before verifying.');
  await pool.query('UPDATE tbl_children SET cdclaa_verified_at = NOW(), cdclaa_verified_by = ? WHERE child_id = ?', [req.user.user_id, id]);
  await logActivity(req, 'CDCLAA_VERIFIED', `Child ${id}`);
  res.json({ success: true, data: await cdclaaSummary(id) });
};

/** GET /api/children/:id/sealed-records (Admin) - list only: the records show as "Sealed". */
exports.listSealed = async (req, res) => {
  const c = await child(req.params.id);
  const [rows] = await pool.query(
    `SELECT s.sealed_id, s.kind, s.uploaded_at, pr.record_id, pr.public_id
       FROM tbl_sealed_records s LEFT JOIN tbl_protected_records pr ON pr.sealed_id = s.sealed_id
      WHERE s.child_id = ? ORDER BY s.uploaded_at`, [c.child_id]);
  res.json({ success: true, data: { original_birth_sealed: !!c.original_birth_sealed, records: rows.map((r) => ({ ...r, label: SEALED_KINDS[r.kind], sealed: true })) } });
};

/** POST /api/children/:id/sealed-records (Admin) { kind, file } - always a protected record. */
exports.uploadSealed = async (req, res) => {
  const id = req.params.id;
  const kind = String(req.body?.kind || '');
  if (!SEALED_KINDS[kind]) throw new HttpError(400, 'Choose the original birth certificate or the natural parents\' identity.');
  await child(id);
  const saved = saveUpload(req.body?.file, { ...DOC_OPTS, folder: 'sealed', label: SEALED_KINDS[kind] });
  try {
    await withTransaction(async (conn) => {
      const [r] = await conn.query(
        `INSERT INTO tbl_sealed_records (child_id, kind, original_name, mime_type, size_bytes, storage_key, sha256, uploaded_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, [id, kind, saved.original_name, saved.mime_type, saved.size_bytes, saved.storage_key, saved.sha256, req.user.user_id]);
      await P.createRecord(conn, { type: 'sealed_birth_record', label: `Sealed birth record, ${id}`, childId: id, sealedId: r.insertId, createdBy: req.user.user_id });
      await conn.query('UPDATE tbl_children SET original_birth_sealed = TRUE WHERE child_id = ?', [id]);
    });
  } catch (err) {
    discardUnsavedUpload(saved.storage_key);
    throw err;
  }
  await logActivity(req, `SEALED_RECORD_STORED (${kind})`, `Child ${id}`);
  return exports.listSealed(req, res);
};

/** GET /api/adoptions-matchable-children (Admin, Staff) - Active, under 18, Available, verified CDCLAA, not placed. */
exports.matchable = async (req, res) => {
  const [rows] = await pool.query(
    `SELECT child_id, full_name, first_name, LEFT(last_name, 1) AS last_initial, gender, TIMESTAMPDIFF(YEAR, dob, CURDATE()) AS age,
            cdclaa_number, cdclaa_verified_at
       FROM tbl_children
      WHERE status = 'Active' AND archived_at IS NULL AND available_for_adoption = TRUE AND placement_status = 'None' AND cdclaa_verified_at IS NOT NULL
        AND TIMESTAMPDIFF(YEAR, dob, CURDATE()) < ? ORDER BY first_name, last_name`, [Number(env.transitionAge)]);
  // Staff see the first name and last initial (directory level); the full name is in the core record.
  const P = require('../services/childAccess');
  res.json({ success: true, data: req.user.role === 'Admin' ? rows : rows.map((r) => ({ ...r, full_name: P.displayName(r), last_initial: r.last_initial })) });
};

exports.cdclaaSummary = cdclaaSummary;


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
