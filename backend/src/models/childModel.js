const { pageInfo } = require('../utils/pagination');
const { newPublicRef } = require('../utils/publicRef');
const { pool, withTransaction } = require('../config/db');
const env = require('../config/env');
const { encrypt, decrypt } = require('../utils/crypto');
const { likeParam } = require('../utils/validate');

// Age is always computed from date of birth by the database, never stored.
const AGE = 'TIMESTAMPDIFF(YEAR, c.dob, CURDATE())';

const LIST_COLS = `c.child_id, c.first_name, c.last_name, c.full_name, c.gender, c.dob, c.admission_date,
  c.public_ref, c.assigned_staff_id, (SELECT full_name FROM tbl_users WHERE user_id = c.assigned_staff_id) AS assigned_staff_name, c.status, c.urgent_needs, c.public_bio, c.is_public, c.available_for_adoption, c.placement_status,
  c.cdclaa_number, c.cdclaa_date, c.cdclaa_verified_at, c.updated_at,
  (c.profile_photo_path IS NOT NULL) AS has_photo,
  ${AGE} AS age,
  (${AGE} >= ${Number(env.transitionAge)} AND c.status = 'Active') AS transition_flag,
  tr.review_status AS transition_status, tr.review_id AS transition_review_id`;

// Encrypted at rest (AES-256-GCM, PHI key); only returned with a health-access token.
const PHI_FIELDS = ['blood_type', 'allergies', 'vaccinations', 'prescriptions', 'doctor_notes'];
const CASE_FIELDS = ['background_care_info', 'guardian_family_info'];

function withPhotoUrl(row) {
  if (!row) return row;
  const v = row.updated_at ? new Date(row.updated_at).getTime() || 0 : 0;
  return { ...row, has_photo: !!row.has_photo, is_public: !!row.is_public, available_for_adoption: !!row.available_for_adoption,
    transition_flag: !!row.transition_flag,
    profile_photo_url: row.has_photo ? `/children/${row.child_id}/photo?v=${v}` : null };
}

const CHILD_SORTS = {
  recent: 'c.updated_at DESC, c.child_id DESC', registered: 'c.created_at DESC, c.child_id DESC',
  case: 'c.child_id ASC', name: 'c.full_name ASC, c.child_id ASC', age: 'c.dob DESC, c.child_id ASC',
};

module.exports = {
  PHI_FIELDS,
  CASE_FIELDS,

  /** Default order: youngest first (ascending age). */
  /**
   * Children list (youngest first). With `paging` ({ page, limit } from utils/pagination),
   * returns { rows, pagination }; without it, returns every matching row.
   */
  /**
   * Child records list. Default order: most recent activity. Age is only a sort the user picks.
   * sort: recent | registered | case | name | age
   */
  async list({ status, search, flagged, paging, sort = 'recent' } = {}) {
    const where = [];
    const params = [];
    if (status) { where.push('c.status = ?'); params.push(status); }
    if (flagged) where.push(`${AGE} >= ${Number(env.transitionAge)} AND c.status = 'Active'`);
    if (search) {
      where.push('(c.child_id LIKE ? OR c.full_name LIKE ? OR c.status LIKE ? OR c.urgent_needs LIKE ?)');
      const p = likeParam(search);
      params.push(p, p, p, p);
    }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const select = `SELECT ${LIST_COLS}
         FROM tbl_children c LEFT JOIN tbl_transition_reviews tr ON tr.child_id = c.child_id
        ${whereSql}
        ORDER BY ${CHILD_SORTS[sort] || CHILD_SORTS.recent}`;
    if (!paging) {
      const [rows] = await pool.query(select, params);
      return rows.map(withPhotoUrl);
    }
    const [[{ n }]] = await pool.query(`SELECT COUNT(*) AS n FROM tbl_children c ${whereSql}`, params);
    const info = pageInfo(paging, Number(n));
    const [rows] = await pool.query(`${select} LIMIT ? OFFSET ?`, [...params, info.limit, info.offset]);
    const { offset, ...pagination } = info;
    return { rows: rows.map(withPhotoUrl), pagination };
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
    const [rows] = await pool.query('SELECT profile_photo_path, is_public, available_for_adoption, status FROM tbl_children WHERE child_id = ?', [id]);
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
      `INSERT INTO tbl_children (child_id, public_ref, first_name, last_name, gender, dob, admission_date, status,
         urgent_needs, public_bio, is_public, available_for_adoption, background_care_info, guardian_family_info, profile_photo_path, qr_token)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'Active', ?, ?, ?, ?, ?, ?, ?, ?)`,
      [c.child_id, newPublicRef(), c.first_name, c.last_name, c.gender, c.dob, c.admission_date, c.urgent_needs, c.public_bio,
        c.is_public ? 1 : 0, c.available_for_adoption ? 1 : 0, encrypt(c.background_care_info, env.phiKey), encrypt(c.guardian_family_info, env.phiKey),
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

  /**
   * Deletes a child. The "whole child record" protected entry is created automatically the first
   * time staff open the child's page; when no token was ever issued for it, it goes with the child.
   */
  async remove(id) {
    await withTransaction(async (conn) => {
      await conn.query(
        `DELETE g FROM tbl_protected_grants g JOIN tbl_protected_records r ON r.record_id = g.record_id
          WHERE r.child_id = ? AND r.record_type = 'child_record'`, [id]);
      await conn.query(
        `DELETE r FROM tbl_protected_records r LEFT JOIN tbl_protected_tokens t ON t.record_id = r.record_id
          WHERE r.child_id = ? AND r.record_type = 'child_record' AND t.token_id IS NULL`, [id]);
      await conn.query('DELETE FROM tbl_children WHERE child_id = ?', [id]);
    });
  },

  /** Records that must be kept: discharge, adoption, CDCLAA, sealed records, releases, or tokens issued for the child. */
  async hasProtectedHistory(id) {
    const [[row]] = await pool.query(
      `SELECT (SELECT COUNT(*) FROM tbl_child_discharge_history WHERE child_id = ?) +
              (SELECT COUNT(*) FROM tbl_adoption_applications WHERE matched_child_id = ?) +
              (SELECT COUNT(*) FROM tbl_children WHERE child_id = ? AND cdclaa_number IS NOT NULL) +
              (SELECT COUNT(*) FROM tbl_sealed_records WHERE child_id = ?) +
              (SELECT COUNT(*) FROM tbl_transition_events e JOIN tbl_transition_reviews tr ON tr.review_id = e.review_id WHERE tr.child_id = ?) +
              (SELECT COUNT(*) FROM tbl_information_releases WHERE child_id = ?) +
              (SELECT COUNT(*) FROM tbl_protected_tokens t JOIN tbl_protected_records r ON r.record_id = t.record_id WHERE r.child_id = ?) AS n`,
      [id, id, id, id, id, id, id]);
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

  /** Adoption history for one child: applications matched to the child and their status changes (staff view). */
  async adoptionHistory(id) {
    const [rows] = await pool.query(
      `SELECT a.application_id, a.reference_no, a.status, a.application_type, ad.legal_name, a.submitted_at, a.finalized_at,
              h.from_status, h.to_status, h.created_at AS changed_at, u.full_name AS changed_by
         FROM tbl_adoption_applications a
         LEFT JOIN tbl_applicant_details ad ON ad.application_id = a.application_id
         LEFT JOIN tbl_application_status_history h ON h.application_id = a.application_id AND h.to_status IS NOT NULL
         LEFT JOIN tbl_users u ON u.user_id = h.changed_by
        WHERE ? IN (a.matched_child_id, a.target_child_id, a.link_child_id) AND a.status <> 'Draft' ORDER BY a.submitted_at DESC, h.created_at, h.history_id`, [id]);
    const apps = new Map();
    for (const r of rows) {
      if (!apps.has(r.application_id)) {
        apps.set(r.application_id, { application_id: r.application_id, reference_no: r.reference_no, status: r.status, application_type: r.application_type,
          applicant: r.legal_name, submitted_at: r.submitted_at, finalized_at: r.finalized_at, completed_at: r.finalized_at, changes: [] });
      }
      if (r.to_status) apps.get(r.application_id).changes.push({ from: r.from_status, to: r.to_status, at: r.changed_at, by: r.changed_by });
    }
    return [...apps.values()];
  },

  // ---------------- Transition Review (18+) ----------------
  /** Flags every Active child who has turned 18. Never changes status or deletes. */
  /**
   * Adds Active children who turned 18 to Transition Review and, in the same transaction, tells every
   * Admin (case number only; one grouped notification when several are added together).
   */
  async syncTransitionFlags() {
    return withTransaction(async (conn) => {
      const [due] = await conn.query(
        `SELECT c.child_id FROM tbl_children c LEFT JOIN tbl_transition_reviews tr ON tr.child_id = c.child_id
          WHERE c.status = 'Active' AND ${AGE} >= ? AND tr.review_id IS NULL FOR UPDATE`, [env.transitionAge]);
      if (!due.length) return 0;
      // The review goes to the child's assigned case worker when that account is active (Admin can change it).
      await conn.query(
        `INSERT IGNORE INTO tbl_transition_reviews (child_id, review_status, assigned_staff_id, assigned_at)
         SELECT c.child_id, 'For Review', IF(u.is_active, c.assigned_staff_id, NULL), IF(u.is_active, NOW(), NULL)
           FROM tbl_children c LEFT JOIN tbl_users u ON u.user_id = c.assigned_staff_id WHERE c.child_id IN (?)`, [due.map((d) => d.child_id)]);
      const [created] = await conn.query('SELECT review_id, child_id, assigned_staff_id FROM tbl_transition_reviews WHERE child_id IN (?)', [due.map((d) => d.child_id)]);
      const Notify = require('../services/notifications');
      for (const r of created) {
        await conn.query("INSERT INTO tbl_transition_events (review_id, stage_key, action, summary, to_value) VALUES (?, 'identify', 'review_created', 'Turned 18: transition review created (not discharged)', 'For Review')", [r.review_id]);
        if (r.assigned_staff_id) await Notify.emit(conn, 'assigned', { userId: r.assigned_staff_id, entityType: 'transition_review', entityId: r.review_id, params: { id: r.review_id, ref: r.child_id, kind: 'transition_review' }, groupKey: `tr_created:${r.review_id}` });
      }
      await Notify.toAdmins(conn, 'admin_child_turned_18', {
        params: { count: due.length, ref: due[0].child_id }, groupKey: `turned_18:${due.map((d) => d.child_id).join(',').slice(0, 120)}`,
      });
      return due.length;
    });
  },

  // ---------------- Public (sanitised) profiles ----------------
  /**
   * Donors and adoption applicants only ever see: a privacy name (first name +
   * last initial), age, gender, photo, public bio and needs, and only for
   * children an administrator has marked as public (donations), or that staff have
   * marked as available for adoption (Adopt a Child).
   */
  async publicList({ search, forAdoption = false, paging } = {}) {
    const where = ["c.status = 'Active'"];
    const params = [];
    // Adopt a Child: Available, verified CDCLAA, not already placed.
    if (forAdoption) where.push('c.available_for_adoption = TRUE', 'c.cdclaa_verified_at IS NOT NULL', "c.placement_status = 'None'", `${AGE} < ${Number(env.transitionAge)}`);
    else where.push('c.is_public = TRUE');
    if (search) {
      where.push('(c.first_name LIKE ? OR c.public_bio LIKE ? OR c.urgent_needs LIKE ?)');
      const p = likeParam(search);
      params.push(p, p, p);
    }
    let pagination = null;
    let limitSql = '';
    const limitParams = [];
    if (paging) {
      const [[{ n }]] = await pool.query(`SELECT COUNT(*) AS n FROM tbl_children c WHERE ${where.join(' AND ')}`, params);
      const { offset, ...info } = pageInfo(paging, Number(n));
      pagination = info;
      limitSql = 'LIMIT ? OFFSET ?';
      limitParams.push(info.limit, offset);
    }
    const [rows] = await pool.query(
      `SELECT c.child_id, c.first_name, LEFT(c.last_name, 1) AS last_initial, c.gender, c.public_bio, c.urgent_needs,
              c.updated_at, (c.profile_photo_path IS NOT NULL) AS has_photo,
              ${AGE} AS age, TIMESTAMPDIFF(MONTH, c.dob, CURDATE()) AS age_months
         FROM tbl_children c WHERE ${where.join(' AND ')}
        ORDER BY c.dob DESC, c.child_id ${limitSql}`, [...params, ...limitParams]);
    const mapped = rows.map((r) => ({
      child_id: r.child_id,
      display_name: `${r.first_name} ${r.last_initial}.`,
      gender: r.gender,
      age: r.age,
      age_label: r.age >= 1 ? `${r.age} yr${r.age === 1 ? '' : 's'}` : `${r.age_months} mo`,
      // Adopt a Child (RA 7610 / RA 11930): no photo or other identifying details for donors.
      public_bio: forAdoption ? null : r.public_bio,
      urgent_needs: forAdoption ? null : r.urgent_needs,
      photo_url: !forAdoption && r.has_photo ? `/public-children/${r.child_id}/photo?v=${new Date(r.updated_at).getTime() || 0}` : null,
    }));
    return paging ? { rows: mapped, pagination } : mapped;
  },

};
