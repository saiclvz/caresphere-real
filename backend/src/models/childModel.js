const { pool } = require('../config/db');
const env = require('../config/env');
const { encrypt, decrypt } = require('../utils/crypto');
const { likeParam } = require('../utils/validate');

// Age is always computed from date of birth by the database, never stored.
const AGE = 'TIMESTAMPDIFF(YEAR, c.dob, CURDATE())';

const LIST_COLS = `c.child_id, c.first_name, c.last_name, c.full_name, c.gender, c.dob, c.admission_date,
  c.status, c.urgent_needs, c.public_bio, c.is_public, c.updated_at,
  (c.profile_photo_path IS NOT NULL) AS has_photo,
  ${AGE} AS age,
  (${AGE} >= ${Number(env.transitionAge)} AND c.status = 'Active') AS transition_flag,
  tr.review_status AS transition_status`;

// Encrypted at rest (AES-256-GCM, PHI key); only returned with a health-access token.
const PHI_FIELDS = ['blood_type', 'allergies', 'vaccinations', 'prescriptions', 'doctor_notes'];
const CASE_FIELDS = ['background_care_info', 'guardian_family_info'];

function withPhotoUrl(row) {
  if (!row) return row;
  const v = row.updated_at ? new Date(row.updated_at).getTime() || 0 : 0;
  return { ...row, has_photo: !!row.has_photo, is_public: !!row.is_public, transition_flag: !!row.transition_flag,
    profile_photo_url: row.has_photo ? `/children/${row.child_id}/photo?v=${v}` : null };
}

module.exports = {
  PHI_FIELDS,
  CASE_FIELDS,

  /** Default order: youngest first (ascending age). */
  async list({ status, search, flagged } = {}) {
    const where = [];
    const params = [];
    if (status) { where.push('c.status = ?'); params.push(status); }
    if (flagged) where.push(`${AGE} >= ${Number(env.transitionAge)} AND c.status = 'Active'`);
    if (search) {
      where.push('(c.child_id LIKE ? OR c.full_name LIKE ? OR c.status LIKE ? OR c.urgent_needs LIKE ?)');
      const p = likeParam(search);
      params.push(p, p, p, p);
    }
    const [rows] = await pool.query(
      `SELECT ${LIST_COLS}
         FROM tbl_children c LEFT JOIN tbl_transition_reviews tr ON tr.child_id = c.child_id
        ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
        ORDER BY c.dob DESC, c.child_id`, params);
    return rows.map(withPhotoUrl);
  },

  async findById(id) {
    const [rows] = await pool.query(
      `SELECT ${LIST_COLS}, c.created_at, c.profile_photo_path,
              (SELECT COUNT(*) FROM tbl_health_history h WHERE h.child_id = c.child_id) AS has_health_record
         FROM tbl_children c LEFT JOIN tbl_transition_reviews tr ON tr.child_id = c.child_id
        WHERE c.child_id = ?`, [id]);
    return withPhotoUrl(rows[0] || null);
  },

  async photoPath(id) {
    const [rows] = await pool.query('SELECT profile_photo_path, is_public, status FROM tbl_children WHERE child_id = ?', [id]);
    return rows[0] || null;
  },

  /** Generates the next ID in the form CS-YYYY-0001 inside the caller's transaction. */
  async nextChildId(conn) {
    const year = new Date().getFullYear();
    const prefix = `CS-${year}-`;
    const [rows] = await conn.query(
      'SELECT child_id FROM tbl_children WHERE child_id LIKE ? ORDER BY child_id DESC LIMIT 1 FOR UPDATE',
      [`${prefix}%`]);
    const last = rows[0] ? Number(rows[0].child_id.slice(prefix.length)) : 0;
    return `${prefix}${String(last + 1).padStart(4, '0')}`;
  },

  async insert(conn, c) {
    await conn.query(
      `INSERT INTO tbl_children (child_id, first_name, last_name, gender, dob, admission_date, status,
         urgent_needs, public_bio, is_public, background_care_info, guardian_family_info, profile_photo_path, qr_token)
       VALUES (?, ?, ?, ?, ?, ?, 'Active', ?, ?, ?, ?, ?, ?, ?)`,
      [c.child_id, c.first_name, c.last_name, c.gender, c.dob, c.admission_date, c.urgent_needs, c.public_bio,
        c.is_public ? 1 : 0, encrypt(c.background_care_info, env.phiKey), encrypt(c.guardian_family_info, env.phiKey),
        c.profile_photo_path || null, c.qr_token]);
  },

  async update(id, fields, conn = pool) {
    const data = { ...fields };
    for (const f of CASE_FIELDS) if (f in data) data[f] = encrypt(data[f], env.phiKey);
    const keys = Object.keys(data);
    if (!keys.length) return;
    await conn.query(`UPDATE tbl_children SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE child_id = ?`,
      [...keys.map((k) => data[k]), id]);
  },

  async remove(id) {
    await pool.query('DELETE FROM tbl_children WHERE child_id = ?', [id]);
  },

  async hasProtectedHistory(id) {
    const [[row]] = await pool.query(
      `SELECT (SELECT COUNT(*) FROM tbl_child_discharge_history WHERE child_id = ?) +
              (SELECT COUNT(*) FROM tbl_adoption_applications WHERE child_id = ?) AS n`, [id, id]);
    return Number(row.n) > 0;
  },

  // ---------------- Protected: case files + PHI ----------------
  async getCaseFiles(id) {
    const [rows] = await pool.query('SELECT background_care_info, guardian_family_info FROM tbl_children WHERE child_id = ?', [id]);
    if (!rows[0]) return null;
    const out = {};
    for (const f of CASE_FIELDS) out[f] = decrypt(rows[0][f], env.phiKey);
    return out;
  },

  async getHealth(childId) {
    const [rows] = await pool.query(
      `SELECT h.*, u.full_name AS last_updated_by_name
         FROM tbl_health_history h LEFT JOIN tbl_users u ON u.user_id = h.last_updated_by
        WHERE h.child_id = ?`, [childId]);
    const row = rows[0];
    if (!row) return null;
    const out = { child_id: row.child_id, updated_at: row.updated_at, last_updated_by_name: row.last_updated_by_name };
    for (const f of PHI_FIELDS) out[f] = decrypt(row[f], env.phiKey);
    return out;
  },

  async upsertHealth(childId, health, userId, conn = pool) {
    const enc = PHI_FIELDS.map((f) => encrypt(health[f], env.phiKey));
    await conn.query(
      `INSERT INTO tbl_health_history
         (child_id, blood_type, allergies, vaccinations, prescriptions, doctor_notes, last_updated_by)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         blood_type = VALUES(blood_type), allergies = VALUES(allergies),
         vaccinations = VALUES(vaccinations), prescriptions = VALUES(prescriptions),
         doctor_notes = VALUES(doctor_notes), last_updated_by = VALUES(last_updated_by)`,
      [childId, ...enc, userId]);
  },

  // ---------------- Discharge history ----------------
  async insertDischarge(conn, d) {
    await conn.query(
      `INSERT INTO tbl_child_discharge_history
         (child_id, discharge_reason, report_of_what_happened, discharge_date, reported_by, previous_status)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [d.child_id, d.discharge_reason, d.report_of_what_happened, d.discharge_date, d.reported_by, d.previous_status]);
  },

  async dischargeHistory(id) {
    const [rows] = await pool.query(
      `SELECT d.discharge_id, d.discharge_reason, d.report_of_what_happened, d.discharge_date, d.previous_status,
              d.created_at, u.full_name AS reported_by_name, r.role_name AS reported_by_role
         FROM tbl_child_discharge_history d
         JOIN tbl_users u ON u.user_id = d.reported_by JOIN tbl_roles r ON r.role_id = u.role_id
        WHERE d.child_id = ? ORDER BY d.created_at DESC, d.discharge_id DESC`, [id]);
    return rows;
  },

  /** Adoption status history for one child, derived from applications and their reviews. */
  async adoptionHistory(id) {
    const [rows] = await pool.query(
      `SELECT a.application_id, a.reference_no, a.status, a.legal_name, a.submitted_at, a.completed_at,
              rv.status_from, rv.status_to, rv.created_at AS changed_at, u.full_name AS changed_by
         FROM tbl_adoption_applications a
         LEFT JOIN tbl_adoption_reviews rv ON rv.application_id = a.application_id AND rv.status_to IS NOT NULL
         LEFT JOIN tbl_users u ON u.user_id = rv.reviewer_id
        WHERE a.child_id = ? ORDER BY a.submitted_at DESC, rv.created_at`, [id]);
    const apps = new Map();
    for (const r of rows) {
      if (!apps.has(r.application_id)) {
        apps.set(r.application_id, { application_id: r.application_id, reference_no: r.reference_no, status: r.status,
          applicant: r.legal_name, submitted_at: r.submitted_at, completed_at: r.completed_at, changes: [] });
      }
      if (r.status_to) apps.get(r.application_id).changes.push({ from: r.status_from, to: r.status_to, at: r.changed_at, by: r.changed_by });
    }
    return [...apps.values()];
  },

  // ---------------- Transition Review (18+) ----------------
  /** Flags every Active child who has turned 18. Never changes status or deletes. */
  async syncTransitionFlags() {
    const [result] = await pool.query(
      `INSERT IGNORE INTO tbl_transition_reviews (child_id, review_status)
       SELECT c.child_id, 'For Review' FROM tbl_children c
        WHERE c.status = 'Active' AND ${AGE} >= ?`, [env.transitionAge]);
    return result.affectedRows;
  },

  // ---------------- Public (sanitised) profiles ----------------
  /**
   * Donors and adoption applicants only ever see: a privacy name (first name +
   * last initial), age, gender, photo, public bio and needs, and only for
   * children an administrator has marked as public.
   */
  async publicList({ search, forAdoption = false } = {}) {
    const where = ["c.status = 'Active'", 'c.is_public = TRUE'];
    const params = [];
    if (forAdoption) where.push(`${AGE} < ${Number(env.transitionAge)}`);
    if (search) {
      where.push('(c.first_name LIKE ? OR c.public_bio LIKE ? OR c.urgent_needs LIKE ?)');
      const p = likeParam(search);
      params.push(p, p, p);
    }
    const [rows] = await pool.query(
      `SELECT c.child_id, c.first_name, LEFT(c.last_name, 1) AS last_initial, c.gender, c.public_bio, c.urgent_needs,
              c.updated_at, (c.profile_photo_path IS NOT NULL) AS has_photo,
              ${AGE} AS age, TIMESTAMPDIFF(MONTH, c.dob, CURDATE()) AS age_months
         FROM tbl_children c WHERE ${where.join(' AND ')}
        ORDER BY c.dob DESC`, params);
    return rows.map((r) => ({
      child_id: r.child_id,
      display_name: `${r.first_name} ${r.last_initial}.`,
      gender: r.gender,
      age: r.age,
      age_label: r.age >= 1 ? `${r.age} yr${r.age === 1 ? '' : 's'}` : `${r.age_months} mo`,
      public_bio: r.public_bio,
      urgent_needs: r.urgent_needs,
      photo_url: r.has_photo ? `/public-children/${r.child_id}/photo?v=${new Date(r.updated_at).getTime() || 0}` : null,
    }));
  },

  async publicEligible(ids, { forAdoption = false } = {}) {
    if (!ids.length) return [];
    const [rows] = await pool.query(
      `SELECT c.child_id FROM tbl_children c
        WHERE c.child_id IN (?) AND c.status = 'Active' AND c.is_public = TRUE
          ${forAdoption ? `AND ${AGE} < ${Number(env.transitionAge)}` : ''}`, [ids]);
    return rows.map((r) => r.child_id);
  },
};
