const { pool } = require('../config/db');
const { likeParam } = require('../utils/validate');
const { FIELDS, OTHER_CITY, RETIRED_DOC_TYPES } = require('../config/adoptionForm');
const { CITY_LISTS } = require('../config/phAddress');
const WF = require('../config/adoptionWorkflow');
const { encField, decField } = require('../utils/fieldCrypto');
const { newPublicRef } = require('../utils/publicRef');

const { STATUSES, ACTIVE, FINAL } = WF;
/** How a status is shown in the UI (all statuses are already plain language). */
/** Display labels. The stored status stays 'Declined' (migration 009); it is shown as "Rejected". */
const LABELS = { Declined: 'Rejected' };
/** Sensitive applicant fields stored encrypted (RA 10173). Legal name and email stay readable for search. */
const ENCRYPTED = new Set(['date_of_birth', 'contact_number', 'house_unit', 'street', 'subdivision', 'barangay', 'province',
  'postal_code', 'id_type', 'id_type_other', 'living_conditions', 'caregiving_experience', 'adoptee_dob', 'adoptee_relationship',
  'id_number', 'id_expiry', 'id_name', 'id_dob', 'adoptee_name']);
const dec = (k, v) => (ENCRYPTED.has(k) ? decField(v) : (v ?? ''));

// Columns of tbl_applicant_details that map 1:1 to form fields.
const DETAIL_FIELDS = [
  'legal_name', 'date_of_birth', 'contact_number', 'email', 'house_unit', 'street', 'subdivision', 'barangay', 'province',
  'postal_code', 'civil_status', 'employment_status', 'occupation', 'employer', 'position', 'employment_length',
  'income_source', 'housing', 'living_conditions', 'caregiving_experience', 'id_type', 'id_type_other',
  'citizenship', 'children_10_plus', 'nonmarital_children_10_plus', 'has_adopted_before', 'adoptee_dob', 'adoptee_relationship',
  'id_number', 'id_expiry', 'id_name', 'id_dob', 'adoptee_name', 'pref_age_range', 'pref_special_needs', 'pref_siblings', 'pref_space',
];

const LIST_COLS = `a.application_id, a.reference_no, a.status, a.application_type, a.is_legacy, a.applicant_id, a.matched_child_id,
  a.trial_end, a.nacc_deadline, a.order_number, a.archived_at, a.assigned_staff_id, asu.full_name AS assigned_staff_name, asu.is_active AS assigned_staff_active,
  a.submitted_at, a.updated_at, a.created_at, a.decided_at, a.withdrawn_at, a.finalized_at,
  ad.legal_name, ad.email, ad.contact_number,
  c.first_name AS child_first_name, LEFT(c.last_name, 1) AS child_last_initial, c.full_name AS child_full_name,
  (SELECT COUNT(*) FROM tbl_application_document_requests r WHERE r.application_id = a.application_id AND r.status = 'Open'
    AND r.doc_type NOT IN ('divorce_or_death_certificate', 'child_abuse_clearance', 'fingerprint_clearance')) AS open_requests`;

const FROM = `FROM tbl_adoption_applications a
  LEFT JOIN tbl_applicant_details ad ON ad.application_id = a.application_id
  LEFT JOIN tbl_children c ON c.child_id = a.matched_child_id
  LEFT JOIN tbl_users asu ON asu.user_id = a.assigned_staff_id
  LEFT JOIN tbl_users aby ON aby.user_id = a.assigned_by`;

const dateOnly = (v) => (v ? (typeof v === 'string' ? v.slice(0, 10) : new Date(v).toISOString().slice(0, 10)) : '');

module.exports = {
  STATUSES, ACTIVE, FINAL, LABELS,

  /**
   * Applications list.
   *  - applicantId: a donor's own applications (drafts included).
   *  - otherwise staff view: drafts are never listed (not submitted yet).
   */
  /** Applications per status (the summary cards), with the same archive rule as the list. */
  async statusCounts({ includeArchived = false } = {}) {
    const [rows] = await pool.query(`SELECT status, COUNT(*) AS n FROM tbl_adoption_applications WHERE status <> 'Draft' ${includeArchived ? '' : 'AND archived_at IS NULL'} GROUP BY status`);
    return Object.fromEntries(rows.map((r) => [r.status, Number(r.n)]));
  },

  async list({ status, statuses, search, applicantId, includeArchived = false, referenceSearchOnly = false, assigned } = {}) {
    const where = [];
    const params = [];
    if (applicantId) { where.push('a.applicant_id = ?'); params.push(applicantId); } else where.push("a.status <> 'Draft'");
    if (!includeArchived) where.push('a.archived_at IS NULL');
    if (status) { where.push('a.status = ?'); params.push(status); }
    if (statuses?.length) { where.push('a.status IN (?)'); params.push(statuses); }
    // Unassigned also covers records assigned to a deactivated account.
    // Assignment filters use the one assignment service (own, backup and temporary rows, and the child's case worker).
    if (assigned) {
      const ids = [...await require('../services/assignment').recordIdsFor(pool, 'adoption_application', assigned === 'none' ? null : Number(assigned))].map(Number);
      if (assigned === 'none') { if (ids.length) { where.push('a.application_id NOT IN (?)'); params.push(ids); } }
      else if (ids.length) { where.push('a.application_id IN (?)'); params.push(ids); } else where.push('1 = 0');
    }
    if (search && referenceSearchOnly) {
      // Staff: by reference only, so a name search can't reveal who applied.
      where.push('a.reference_no LIKE ?');
      params.push(likeParam(search));
    } else if (search) {
      where.push('(a.reference_no LIKE ? OR ad.legal_name LIKE ? OR ad.email LIKE ?)');
      const p = likeParam(search);
      params.push(p, p, p);
    }
    const [rows] = await pool.query(
      `SELECT ${LIST_COLS}, cc.child_id AS case_child_id, cc.full_name AS case_child_name, a.application_type AS adoption_type,
              (SELECT MAX(h.created_at) FROM tbl_application_status_history h WHERE h.application_id = a.application_id AND h.to_status = a.status) AS stage_since
         ${FROM} LEFT JOIN tbl_children cc ON cc.child_id = COALESCE(a.matched_child_id, a.target_child_id, a.link_child_id)
        WHERE ${where.join(' AND ')}
        ORDER BY FIELD(a.status, ${STATUSES.map(() => '?').join(', ')}), COALESCE(a.submitted_at, a.created_at) DESC`, [...params, ...STATUSES]);
    return rows;
  },

  async findById(id, conn = pool, { lock = false } = {}) {
    const [rows] = await conn.query(
      `SELECT a.*, ad.legal_name, ad.email AS applicant_email, asu.full_name AS assigned_staff_name, asu.is_active AS assigned_staff_active,
              aby.full_name AS assigned_by_name,
              c.first_name AS child_first_name, LEFT(c.last_name, 1) AS child_last_initial, c.full_name AS child_full_name,
              c.status AS child_status, c.available_for_adoption AS child_available, c.placement_status AS child_placement,
              TIMESTAMPDIFF(YEAR, c.dob, CURDATE()) AS child_age, (c.cdclaa_verified_at IS NOT NULL) AS child_cdclaa_verified
         ${FROM} WHERE a.application_id = ? ${lock ? 'FOR UPDATE' : ''}`, [id]);
    return rows[0] || null;
  },

  /** The application's answers in the same shape the form sends (city "Other" handled). */
  async form(id) {
    const [[d]] = await pool.query('SELECT * FROM tbl_applicant_details WHERE application_id = ?', [id]);
    const [[s]] = await pool.query('SELECT details FROM tbl_applicant_spouse WHERE application_id = ?', [id]);
    const [members] = await pool.query(
      'SELECT full_name, age, relationship FROM tbl_household_members WHERE application_id = ? ORDER BY sort_order, member_id', [id]);
    const [[a]] = await pool.query('SELECT reason_for_adoption FROM tbl_adoption_applications WHERE application_id = ?', [id]);
    const form = {};
    for (const f of DETAIL_FIELDS) form[f] = dec(f, d?.[f]);
    form.date_of_birth = dateOnly(form.date_of_birth);
    form.adoptee_dob = dateOnly(form.adoptee_dob);
    form.id_expiry = dateOnly(form.id_expiry);
    form.id_dob = dateOnly(form.id_dob);
    try { form.clearances = d?.clearances ? JSON.parse(decField(d.clearances)) : []; } catch { form.clearances = []; }
    const city = decField(d?.city);
    const hasList = Boolean(CITY_LISTS[form.province]);
    if (d?.city_is_other && hasList) { form.city = OTHER_CITY; form.city_other = city; } else { form.city = city; form.city_other = ''; }
    form.spouse_details = decField(s?.details);
    form.household_members = members.map((m) => ({ full_name: decField(m.full_name), age: decField(m.age), relationship: decField(m.relationship) }));
    form.reason_for_adoption = decField(a?.reason_for_adoption);
    return form;
  },

  /** Saves the keys present in a cleaned (partial) form. Run inside a transaction. */
  async saveForm(conn, id, f) {
    const cols = DETAIL_FIELDS.filter((k) => k in f);
    const set = {};
    for (const k of cols) set[k] = f[k] === '' ? null : (ENCRYPTED.has(k) ? encField(f[k]) : f[k]);
    if ('clearances' in f) set.clearances = encField(JSON.stringify(f.clearances || []));
    if ('city' in f || 'city_other' in f || 'province' in f) {
      const [[raw]] = await conn.query('SELECT province, city, city_is_other FROM tbl_applicant_details WHERE application_id = ?', [id]);
      const cur = raw ? { ...raw, province: decField(raw.province), city: decField(raw.city) } : null;
      const province = 'province' in f ? f.province : cur?.province;
      const list = CITY_LISTS[province];
      const city = 'city' in f ? f.city : (cur?.city_is_other && list ? OTHER_CITY : cur?.city);
      if (city === OTHER_CITY) { set.city = encField(f.city_other || null); set.city_is_other = list ? 1 : 0; } else { set.city = encField(city || null); set.city_is_other = 0; }
      // Changing the province clears the city (the browser does this too).
      if ('province' in f && cur && f.province !== cur.province && !('city' in f)) { set.city = null; set.city_is_other = 0; }
    }
    const keys = Object.keys(set);
    if (keys.length) {
      await conn.query(
        `INSERT INTO tbl_applicant_details (application_id, ${keys.join(', ')}) VALUES (?, ${keys.map(() => '?').join(', ')})
         ON DUPLICATE KEY UPDATE ${keys.map((k) => `${k} = VALUES(${k})`).join(', ')}`, [id, ...keys.map((k) => set[k])]);
    }
    if ('spouse_details' in f) {
      await conn.query(
        'INSERT INTO tbl_applicant_spouse (application_id, details) VALUES (?, ?) ON DUPLICATE KEY UPDATE details = VALUES(details)',
        [id, encField(f.spouse_details || null)]);
    }
    if ('household_members' in f) {
      await conn.query('DELETE FROM tbl_household_members WHERE application_id = ?', [id]);
      for (const [i, m] of f.household_members.entries()) {
        await conn.query(
          'INSERT INTO tbl_household_members (application_id, full_name, age, relationship, sort_order) VALUES (?, ?, ?, ?, ?)',
          [id, encField(m.full_name || '-'), encField(/^\d+$/.test(String(m.age)) ? String(Number(m.age)) : null), encField(m.relationship || '-'), i]);
      }
    }
    if ('reason_for_adoption' in f) {
      await conn.query('UPDATE tbl_adoption_applications SET reason_for_adoption = ? WHERE application_id = ?', [encField(f.reason_for_adoption || null), id]);
    }
  },

  /** Legacy (pre-v3) fields, read-only for staff. */
  legacy(app) {
    if (!app.is_legacy) return null;
    return {
      address: decField(app.legacy_address), occupation: app.legacy_occupation, employment_details: decField(app.legacy_employment_details),
      spouse_details: decField(app.legacy_spouse_details), household_members: decField(app.legacy_household_members),
      living_conditions: decField(app.legacy_living_conditions), caregiving_experience: decField(app.legacy_caregiving_experience),
    };
  },

  async documents(id, conn = pool) {
    const [rows] = await conn.query(
      `SELECT d.document_id, d.doc_type, d.page, d.original_name, d.mime_type, d.size_bytes, d.status, d.request_id, d.uploaded_at,
              d.uploaded_by, d.sha256, u.full_name AS uploaded_by_name, pr.record_id AS protected_record_id, pr.public_id AS protected_public_id,
              d.verification_status, DATE_FORMAT(d.issued_date, '%Y-%m-%d') AS issued_date, d.reviewed_at, d.review_note, rv.full_name AS reviewed_by_name
         FROM tbl_adoption_documents d JOIN tbl_users u ON u.user_id = d.uploaded_by
         LEFT JOIN tbl_users rv ON rv.user_id = d.reviewed_by
         LEFT JOIN tbl_protected_records pr ON pr.document_id = d.document_id
        WHERE d.application_id = ? AND d.archived_at IS NULL ORDER BY d.page, d.doc_type, d.uploaded_at`, [id]);
    return rows;
  },

  async document(id, docId) {
    const [rows] = await pool.query('SELECT * FROM tbl_adoption_documents WHERE application_id = ? AND document_id = ? AND archived_at IS NULL', [id, docId]);
    return rows[0] || null;
  },

  async insertDocument(conn, d) {
    const [res] = await conn.query(
      `INSERT INTO tbl_adoption_documents (application_id, doc_type, page, original_name, mime_type, size_bytes, storage_key, sha256, uploaded_by, request_id, issued_date)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [d.application_id, d.doc_type, d.page ?? null, d.original_name, d.mime_type, d.size_bytes, d.storage_key, d.sha256 || null, d.uploaded_by, d.request_id || null, d.issued_date || null]);
    return res.insertId;
  },

  /** Status history. Donors get only status, remark and time. */
  async history(id, { forDonor = false } = {}) {
    const [rows] = await pool.query(
      `SELECT h.history_id, h.from_status, h.to_status, h.remark_to_applicant, h.created_at, h.changed_by,
              u.full_name AS changed_by_name, r.role_name AS changed_by_role
         FROM tbl_application_status_history h
         LEFT JOIN tbl_users u ON u.user_id = h.changed_by LEFT JOIN tbl_roles r ON r.role_id = u.role_id
        WHERE h.application_id = ? ORDER BY h.created_at, h.history_id`, [id]);
    if (!forDonor) return rows;
    return rows.map(({ history_id, from_status, to_status, remark_to_applicant, created_at }) => ({ history_id, from_status, to_status, remark_to_applicant, created_at }));
  },

  async addHistory(conn, h) {
    const [res] = await conn.query(
      'INSERT INTO tbl_application_status_history (application_id, from_status, to_status, changed_by, remark_to_applicant) VALUES (?, ?, ?, ?, ?)',
      [h.application_id, h.from_status || null, h.to_status || null, h.changed_by || null, h.remark || null]);
    return res.insertId;
  },

  /** Internal notes. Never call this for a donor response. */
  async notes(id) {
    const [rows] = await pool.query(
      `SELECT n.note_id, n.history_id, n.note, n.created_at, n.author_id, u.full_name AS author_name, r.role_name AS author_role
         FROM tbl_application_notes n JOIN tbl_users u ON u.user_id = n.author_id JOIN tbl_roles r ON r.role_id = u.role_id
        WHERE n.application_id = ? ORDER BY n.created_at, n.note_id`, [id]);
    return rows;
  },

  async addNote(conn, n) {
    const [res] = await conn.query('INSERT INTO tbl_application_notes (application_id, history_id, author_id, note) VALUES (?, ?, ?, ?)',
      [n.application_id, n.history_id || null, n.author_id, n.note]);
    return res.insertId;
  },

  async requests(id, { forDonor = false } = {}) {
    const [rows] = await pool.query(
      `SELECT r.request_id, r.doc_type, r.message, r.status, r.requested_at, r.fulfilled_at, r.closed_at, u.full_name AS requested_by_name
         FROM tbl_application_document_requests r JOIN tbl_users u ON u.user_id = r.requested_by
        WHERE r.application_id = ? AND r.doc_type NOT IN (?) ORDER BY r.requested_at DESC, r.request_id DESC`, [id, RETIRED_DOC_TYPES]);
    return forDonor ? rows.map(({ requested_by_name, ...r }) => r) : rows;
  },

  async interviews(id, { forDonor = false } = {}) {
    const [rows] = await pool.query(
      `SELECT i.interview_id, i.kind, i.scheduled_at, i.details, i.created_at, u.full_name AS created_by_name
         FROM tbl_application_interviews i JOIN tbl_users u ON u.user_id = i.created_by
        WHERE i.application_id = ? ORDER BY i.scheduled_at DESC`, [id]);
    return forDonor ? rows.map(({ created_by_name, ...i }) => i) : rows;
  },

  /** The donor's active application, other than `exceptId`. Locks the donor's row first so two tabs can't race. */
  async activeFor(conn, applicantId, exceptId = null) {
    await conn.query('SELECT user_id FROM tbl_users WHERE user_id = ? FOR UPDATE', [applicantId]);
    const [rows] = await conn.query(
      `SELECT application_id, reference_no, status FROM tbl_adoption_applications
        WHERE applicant_id = ? AND status IN (?) ${exceptId ? 'AND application_id <> ?' : ''} LIMIT 1`,
      exceptId ? [applicantId, ACTIVE, exceptId] : [applicantId, ACTIVE]);
    return rows[0] || null;
  },

  async nextReference(conn) {
    const prefix = `ADP-${new Date().getFullYear()}-`;
    const [rows] = await conn.query(
      'SELECT reference_no FROM tbl_adoption_applications WHERE reference_no LIKE ? ORDER BY reference_no DESC LIMIT 1 FOR UPDATE',
      [`${prefix}%`]);
    const last = rows[0] ? Number(rows[0].reference_no.slice(prefix.length)) : 0;
    return `${prefix}${String(last + 1).padStart(4, '0')}`;
  },

  async createDraft(conn, user, type = 'Regular') {
    const [res] = await conn.query(
      "INSERT INTO tbl_adoption_applications (applicant_id, public_ref, application_type, status, current_page, created_at) VALUES (?, ?, ?, 'Draft', 1, NOW())",
      [user.user_id, newPublicRef(), type]);
    await conn.query('INSERT INTO tbl_applicant_details (application_id, legal_name, email) VALUES (?, ?, ?)',
      [res.insertId, user.full_name, user.email]);
    return res.insertId;
  },

  FIELD_KEYS: Object.keys(FIELDS),
};
