/**
 * OPTIONAL demo case for presentations: ADP-2026-0004, applicant Josh Layug, child Rain Sese, Regular,
 * assigned to Sai Calvez, at Documents (status "Documents requested"). Run it yourself; nothing runs it
 * automatically. A dry run (no options) only reports what it would do.
 *
 * It never creates a child, an applicant or a staff account, and never copies a child: all three must
 * already exist (register Rain Sese in Children, the applicant through Register, the staff member in User
 * accounts). If any is missing, or the case already exists, it stops without changing anything.
 *
 *   node scripts/seedAdoptionDemo.js
 *   node scripts/seedAdoptionDemo.js --confirm
 */
require('dotenv').config();
const mysql = require('mysql2/promise');
const { newPublicRef } = require('../src/utils/publicRef');

const CASE = { reference: 'ADP-2026-0004', applicant: 'Josh Layug', child: 'Rain Sese', staff: 'Sai Calvez', type: 'Regular' };
const confirm = process.argv.includes('--confirm');

(async () => {
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST || '127.0.0.1', port: Number(process.env.DB_PORT) || 3306, user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '', database: process.env.DB_NAME || 'caresphere_db',
  });
  try {
    const [children] = await conn.query("SELECT child_id, full_name, status FROM tbl_children WHERE full_name = ? OR CONCAT(first_name, ' ', last_name) = ?", [CASE.child, CASE.child]);
    const [applicants] = await conn.query("SELECT u.user_id, u.full_name, u.email FROM tbl_users u JOIN tbl_roles r ON r.role_id = u.role_id WHERE r.role_name = 'Donor' AND u.full_name = ? AND u.is_active = TRUE", [CASE.applicant]);
    const [staff] = await conn.query("SELECT u.user_id FROM tbl_users u JOIN tbl_roles r ON r.role_id = u.role_id WHERE r.role_name = 'Staff' AND u.full_name = ? AND u.is_active = TRUE", [CASE.staff]);
    const [[existing]] = await conn.query('SELECT application_id, status FROM tbl_adoption_applications WHERE reference_no = ?', [CASE.reference]);
    const problems = [];
    if (children.length !== 1) problems.push(children.length ? `More than one child named ${CASE.child}: link the case by hand instead.` : `Child "${CASE.child}" is not in Children. Register the child there first (this script never creates or copies a child).`);
    if (applicants.length !== 1) problems.push(applicants.length ? `More than one applicant account named ${CASE.applicant}.` : `Applicant account "${CASE.applicant}" doesn't exist. Register it first.`);
    if (staff.length !== 1) problems.push(`Staff account "${CASE.staff}" doesn't exist (or isn't unique). Create it in User accounts first.`);
    if (existing) problems.push(`${CASE.reference} already exists (status ${existing.status}). Nothing to do.`);
    if (applicants.length === 1) {
      const [[active]] = await conn.query("SELECT reference_no FROM tbl_adoption_applications WHERE applicant_id = ? AND status NOT IN ('Declined', 'Withdrawn', 'Closed')", [applicants[0].user_id]);
      if (active) problems.push(`${CASE.applicant} already has an active application (${active.reference_no || 'draft'}).`);
    }
    if (problems.length) { console.log('Not created:'); problems.forEach((p) => console.log(`  - ${p}`)); return; }
    const child = children[0]; const applicant = applicants[0];
    console.log(`Would create ${CASE.reference}: ${CASE.applicant} (user #${applicant.user_id}) for existing child ${child.child_id}, ${CASE.type}, assigned to ${CASE.staff}, status "Documents requested".`);
    if (!confirm) { console.log('Dry run: nothing was changed. Add --confirm to create it.'); return; }
    await conn.beginTransaction();
    try {
      const publicRef = newPublicRef();
      const [r] = await conn.query(
        `INSERT INTO tbl_adoption_applications (applicant_id, public_ref, reference_no, application_type, status, current_page, submitted_at, created_at,
           created_by_staff, target_child_id, assigned_staff_id, assigned_by, assigned_at)
         VALUES (?, ?, ?, ?, 'Documents requested', 9, NOW(), NOW(), ?, ?, ?, ?, NOW())`,
        [applicant.user_id, publicRef, CASE.reference, CASE.type, staff[0].user_id, child.child_id, staff[0].user_id, staff[0].user_id]);
      const id = r.insertId;
      await conn.query('INSERT INTO tbl_applicant_details (application_id, legal_name, email) VALUES (?, ?, ?)', [id, applicant.full_name, applicant.email]);
      const [h1] = await conn.query("INSERT INTO tbl_application_status_history (application_id, from_status, to_status, changed_by) VALUES (?, 'Draft', 'Submitted', ?)", [id, staff[0].user_id]);
      const [h2] = await conn.query("INSERT INTO tbl_application_status_history (application_id, from_status, to_status, changed_by) VALUES (?, 'Submitted', 'Documents requested', ?)", [id, staff[0].user_id]);
      await conn.query("INSERT INTO tbl_application_document_requests (application_id, history_id, doc_type, message, requested_by) VALUES (?, ?, 'birth_certificate', 'Demo request', ?)", [id, h2.insertId, staff[0].user_id]);
      await conn.query("INSERT INTO tbl_adoption_stage_events (application_id, stage_key, action, summary, actor_id) VALUES (?, 'inquiry', 'case_opened', 'Demo case opened (seed script)', ?)", [id, staff[0].user_id]);
      await conn.query("INSERT INTO tbl_activity_logs (user_id, user_role, action_performed, target_entity) VALUES (?, 'Staff', ?, ?)", [staff[0].user_id, `ADOPTION_CASE_OPENED_BY_STAFF (${CASE.reference}, demo seed)`, `Application #${id}`]);
      await conn.commit();
      console.log(`Created ${CASE.reference} (application #${id}, history #${h1.insertId}, #${h2.insertId}).`);
    } catch (err) { await conn.rollback(); throw err; }
  } catch (err) {
    console.error(`[seed] ${err.message}`);
    process.exitCode = 1;
  } finally { await conn.end(); }
})();
