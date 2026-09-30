const { pool } = require('../config/db');
const { likeParam } = require('../utils/validate');

const STATUSES = ['Submitted', 'Under Review', 'Additional Documents Required', 'Approved', 'Rejected', 'Completed'];
const OPEN = ['Submitted', 'Under Review', 'Additional Documents Required', 'Approved'];

// Document checklist shown to applicants with Submitted / Missing indicators.
const DOC_TYPES = {
  government_id: { label: 'Valid government-issued ID', required: true },
  background_check: { label: 'NBI or police clearance (background check)', required: true },
  proof_of_income: { label: 'Proof of income or employment', required: false },
  other: { label: 'Other supporting document', required: false },
};

const LIST_COLS = `a.application_id, a.reference_no, a.status, a.legal_name, a.email, a.contact_number,
  a.child_id, a.submitted_at, a.updated_at, a.completed_at, a.applicant_id,
  c.first_name AS child_first_name, LEFT(c.last_name, 1) AS child_last_initial, c.status AS child_status,
  (SELECT COUNT(DISTINCT d.doc_type) FROM tbl_adoption_documents d
     WHERE d.application_id = a.application_id AND d.doc_type IN ('government_id', 'background_check')) AS required_docs_submitted`;

module.exports = {
  STATUSES, OPEN, DOC_TYPES,

  async list({ status, search, applicantId } = {}) {
    const where = [];
    const params = [];
    if (applicantId) { where.push('a.applicant_id = ?'); params.push(applicantId); }
    if (status) { where.push('a.status = ?'); params.push(status); }
    if (search) {
      where.push('(a.reference_no LIKE ? OR a.legal_name LIKE ? OR a.email LIKE ? OR c.full_name LIKE ? OR a.status LIKE ?)');
      const p = likeParam(search);
      params.push(p, p, p, p, p);
    }
    const [rows] = await pool.query(
      `SELECT ${LIST_COLS} FROM tbl_adoption_applications a JOIN tbl_children c ON c.child_id = a.child_id
        ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
        ORDER BY FIELD(a.status, 'Submitted', 'Additional Documents Required', 'Under Review', 'Approved', 'Completed', 'Rejected'),
                 a.submitted_at DESC`, params);
    return rows;
  },

  async findById(id) {
    const [rows] = await pool.query(
      `SELECT a.*, c.first_name AS child_first_name, LEFT(c.last_name, 1) AS child_last_initial,
              c.full_name AS child_full_name, c.status AS child_status,
              TIMESTAMPDIFF(YEAR, c.dob, CURDATE()) AS child_age
         FROM tbl_adoption_applications a JOIN tbl_children c ON c.child_id = a.child_id
        WHERE a.application_id = ?`, [id]);
    return rows[0] || null;
  },

  async documents(applicationId) {
    const [rows] = await pool.query(
      `SELECT d.document_id, d.doc_type, d.original_name, d.mime_type, d.size_bytes, d.uploaded_at, u.full_name AS uploaded_by_name
         FROM tbl_adoption_documents d JOIN tbl_users u ON u.user_id = d.uploaded_by
        WHERE d.application_id = ? ORDER BY d.uploaded_at`, [applicationId]);
    return rows;
  },

  async document(applicationId, documentId) {
    const [rows] = await pool.query('SELECT * FROM tbl_adoption_documents WHERE application_id = ? AND document_id = ?',
      [applicationId, documentId]);
    return rows[0] || null;
  },

  async reviews(applicationId) {
    const [rows] = await pool.query(
      `SELECT rv.review_id, rv.status_from, rv.status_to, rv.note, rv.created_at, rv.reviewer_id,
              u.full_name AS reviewer_name, r.role_name AS reviewer_role
         FROM tbl_adoption_reviews rv JOIN tbl_users u ON u.user_id = rv.reviewer_id JOIN tbl_roles r ON r.role_id = u.role_id
        WHERE rv.application_id = ? ORDER BY rv.created_at, rv.review_id`, [applicationId]);
    return rows;
  },

  async hasOpenApplication(applicantId, childId) {
    const [rows] = await pool.query(
      `SELECT 1 FROM tbl_adoption_applications WHERE applicant_id = ? AND child_id = ? AND status IN (?) LIMIT 1`,
      [applicantId, childId, OPEN]);
    return rows.length > 0;
  },

  async nextReference(conn) {
    const prefix = `ADP-${new Date().getFullYear()}-`;
    const [rows] = await conn.query(
      'SELECT reference_no FROM tbl_adoption_applications WHERE reference_no LIKE ? ORDER BY reference_no DESC LIMIT 1 FOR UPDATE',
      [`${prefix}%`]);
    const last = rows[0] ? Number(rows[0].reference_no.slice(prefix.length)) : 0;
    return `${prefix}${String(last + 1).padStart(4, '0')}`;
  },

  async insert(conn, a) {
    const [res] = await conn.query(
      `INSERT INTO tbl_adoption_applications
        (reference_no, applicant_id, child_id, legal_name, date_of_birth, contact_number, email, address, civil_status,
         occupation, employment_details, spouse_details, household_members, living_conditions, caregiving_experience,
         reason_for_adoption, declaration_accepted, consented_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, TRUE, NOW())`,
      [a.reference_no, a.applicant_id, a.child_id, a.legal_name, a.date_of_birth, a.contact_number, a.email, a.address,
        a.civil_status, a.occupation, a.employment_details, a.spouse_details, a.household_members, a.living_conditions,
        a.caregiving_experience, a.reason_for_adoption]);
    return res.insertId;
  },

  async insertDocument(d) {
    const [res] = await pool.query(
      `INSERT INTO tbl_adoption_documents (application_id, doc_type, original_name, mime_type, size_bytes, storage_key, uploaded_by)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [d.application_id, d.doc_type, d.original_name, d.mime_type, d.size_bytes, d.storage_key, d.uploaded_by]);
    return res.insertId;
  },

  async addReview(conn, r) {
    await conn.query(
      'INSERT INTO tbl_adoption_reviews (application_id, reviewer_id, status_from, status_to, note) VALUES (?, ?, ?, ?, ?)',
      [r.application_id, r.reviewer_id, r.status_from || null, r.status_to || null, r.note || null]);
  },
};
