/**
 * Moves existing assignments into the ONE assignment list (migration 032). Run it yourself after `npm run migrate`;
 * nothing runs it automatically.
 *
 *   node scripts/migrateChildAccess.js                                        dry run: does everything inside a
 *                                                                             transaction, prints the report, then
 *                                                                             rolls it all back
 *   node scripts/migrateChildAccess.js --apply --admin-email you@example.com  applies it (one transaction)
 *
 * Both write backend/child-access-migration-report.txt (case and reference numbers and staff names only, never a
 * child's name).
 *
 * What it does (only for records not converted yet; running it again changes nothing):
 *  - Each child's case worker (assigned_staff_id) becomes that child's PRIMARY assignment.
 *  - Each adoption application's and transition review's assigned staff becomes its primary assignment.
 *  - An assignment to a deactivated account is kept as history and the record is marked "needs reassignment".
 *  - Active children with no case worker are listed as Unassigned and marked, and Admins get one alert.
 * Staff duties, children, test data and the audit log are not changed. The rollout mode stays "Log only".
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');

const apply = process.argv.includes('--apply');
const emailArg = (() => { const i = process.argv.indexOf('--admin-email'); return i > 0 ? process.argv[i + 1] : null; })();

const TYPES = [
  ['child', 'tbl_children', 'child_id', "status = 'Active'", 'Child'],
  ['adoption_application', 'tbl_adoption_applications', 'application_id', "status NOT IN ('Draft', 'Closed', 'Declined', 'Withdrawn')", 'Application'],
  ['transition_review', 'tbl_transition_reviews', 'review_id', "closed_at IS NULL AND review_status <> 'Completed'", 'Transition review'],
];

async function convert(conn) {
  const Assign = require('../src/services/assignment');
  const report = { converted: [], deactivated: [], unassigned: [], already: 0 };
  for (const [type, table, id, open, label] of TYPES) {
    const ref = type === 'adoption_application' ? 'reference_no' : type === 'transition_review' ? 'child_id' : 'child_id';
    const [rows] = await conn.query(
      `SELECT CAST(x.${id} AS CHAR) AS record_id, x.${ref} AS ref, x.assigned_staff_id, (${open}) AS is_open, u.full_name AS staff, u.is_active
         FROM ${table} x LEFT JOIN tbl_users u ON u.user_id = x.assigned_staff_id ORDER BY x.${id}`);
    for (const r of rows) {
      if (await Assign.converted(conn, type, r.record_id)) { report.already += 1; continue; }
      const name = `${label} ${type === 'transition_review' ? `#${r.record_id} (case ${r.ref})` : r.ref || r.record_id}`;
      if (r.assigned_staff_id) {
        await Assign.convertOne(conn, type, r.record_id);
        report.converted.push(`${name}: ${r.staff} -> primary${r.is_active ? '' : ' (account deactivated)'}`);
        if (!r.is_active && Number(r.is_open)) {
          await Assign.flag(conn, type, r.record_id, r.assigned_staff_id, 'account_deactivated');
          report.deactivated.push(name);
        }
      } else if (type === 'child' && Number(r.is_open)) {
        await Assign.flag(conn, 'child', r.record_id, null, 'no_case_worker');
        report.unassigned.push(name);
      }
    }
  }
  const total = report.unassigned.length + report.deactivated.length;
  if (total) {
    const Notify = require('../src/services/notifications');
    await Notify.toAdmins(conn, 'admin_needs_reassignment', { params: { count: total, why: 'Found when the assignments were moved to the new assignment list.' }, groupKey: 'cra_migration' });
  }
  return report;
}

function write(report) {
  const out = [
    `Child record access: assignment conversion (${apply ? 'APPLIED' : 'DRY RUN - nothing was changed'}) ${new Date().toISOString()}`, '',
    `Converted to primary assignments: ${report.converted.length}`, ...report.converted.map((x) => ` - ${x}`), '',
    `Marked "needs reassignment" (assigned account is deactivated): ${report.deactivated.length}`, ...report.deactivated.map((x) => ` - ${x}`), '',
    `Active children without a case worker (Unassigned, Admin alerted): ${report.unassigned.length}`, ...report.unassigned.map((x) => ` - ${x}`), '',
    `Already converted (skipped): ${report.already}`, '',
    'Not changed: Staff duties, children, test data, the audit log. The rollout mode stays "Log only" until you switch it in Settings.',
  ];
  const text = out.join('\n');
  fs.writeFileSync(path.join(__dirname, '..', 'child-access-migration-report.txt'), text);
  console.log(text);
  console.log(`\nReport saved to backend${path.sep}child-access-migration-report.txt`);
}

async function main() {
  const mysql = require('mysql2/promise');
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST || '127.0.0.1', port: Number(process.env.DB_PORT) || 3306, user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '', database: process.env.DB_NAME || 'caresphere_db',
  });
  try {
    if (apply) {
      if (!emailArg) throw new Error('Add --admin-email <your admin email> so the conversion is recorded under your account.');
      const [[a]] = await conn.query("SELECT u.user_id FROM tbl_users u JOIN tbl_roles r ON r.role_id = u.role_id WHERE u.email = ? AND r.role_name = 'Admin' AND u.is_active = TRUE", [emailArg]);
      if (!a) throw new Error('No active Admin account with that email.');
      await conn.beginTransaction();
      const report = await convert(conn);
      await conn.query("INSERT INTO tbl_activity_logs (user_id, user_role, action_performed, target_entity) VALUES (?, 'Admin', ?, 'Assignments')",
        [a.user_id, `CRA_ASSIGNMENT_BULK (migration: ${report.converted.length} converted, ${report.unassigned.length} unassigned)`]);
      await conn.commit();
      write(report);
    } else {
      await conn.beginTransaction();
      const report = await convert(conn);
      await conn.rollback();
      write(report);
    }
  } catch (err) {
    try { await conn.rollback(); } catch { /* not started */ }
    console.error(`[child-access] ${err.message}`);
    process.exitCode = 1;
  } finally { await conn.end(); process.exit(); }
}

if (require.main === module) main();
module.exports = { convert };
