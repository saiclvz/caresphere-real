/**
 * OPTIONAL demo data for Transition Review (18+), for presentations. Run it yourself; nothing runs it automatically.
 * A dry run (no options) only reports what it would do.
 *
 *   Rain Sese     - flagged 2026-10-02, assigned to Sai Calvez, proposed pathway Independent Living, For Review
 *   Mia Salongga  - flagged 2026-10-01, assigned to Mika Santos, goals Housing, Vocational, Education, Completed
 *                   (shown as "completed before the 9-stage workflow": no stage records are invented)
 *
 * It never creates a child or a staff account and never changes a date of birth: each child must already exist
 * in Children and be 18 or older (the case number is the child's own ID). Missing or under-18 children are
 * reported and skipped. An existing review is only updated by --confirm, and never moved backwards.
 *
 *   node scripts/seedTransitionDemo.js
 *   node scripts/seedTransitionDemo.js --confirm
 */
require('dotenv').config();
const mysql = require('mysql2/promise');

const DEMO = [
  { child: 'Rain Sese', flagged: '2026-10-02 09:00:00', staff: 'Sai Calvez', status: 'For Review', pathway: 'Independent Living' },
  { child: 'Mia Salongga', flagged: '2026-10-01 09:00:00', staff: 'Mika Santos', status: 'Completed',
    goals: { housing_goal: 'Stable, affordable housing arranged before leaving care.', vocational_goal: 'Vocational training enrolment.', education_goal: 'Continue senior high school / college.' } },
];
const confirm = process.argv.includes('--confirm');

(async () => {
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST || '127.0.0.1', port: Number(process.env.DB_PORT) || 3306, user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '', database: process.env.DB_NAME || 'caresphere_db',
  });
  try {
    for (const d of DEMO) {
      const [kids] = await conn.query("SELECT child_id, status, TIMESTAMPDIFF(YEAR, dob, CURDATE()) AS age FROM tbl_children WHERE full_name = ?", [d.child]);
      if (kids.length !== 1) { console.log(`- ${d.child}: ${kids.length ? 'more than one child with this name; skipped' : 'not in Children; register the child first (this script never creates one)'}.`); continue; }
      const k = kids[0];
      if (Number(k.age) < 18) { console.log(`- ${d.child} (${k.child_id}): age ${k.age}. The review appears automatically at 18; this script never changes a date of birth. Skipped.`); continue; }
      const [staff] = await conn.query("SELECT u.user_id FROM tbl_users u JOIN tbl_roles r ON r.role_id = u.role_id WHERE u.full_name = ? AND u.is_active = TRUE AND r.role_name = 'Staff'", [d.staff]);
      const staffId = staff.length === 1 ? staff[0].user_id : null;
      const [[rev]] = await conn.query('SELECT review_id, review_status, assessment_started_at FROM tbl_transition_reviews WHERE child_id = ?', [k.child_id]);
      if (rev && (rev.assessment_started_at || (rev.review_status !== 'For Review' && d.status === 'For Review'))) {
        console.log(`- ${d.child} (${k.child_id}): the review is already ${rev.review_status}${rev.assessment_started_at ? ' with workflow records' : ''}; left as it is.`); continue;
      }
      console.log(`- ${d.child} (${k.child_id}, age ${k.age}): ${rev ? 'update' : 'create'} review, flagged ${d.flagged.slice(0, 10)}, ${d.status}, staff ${staffId ? d.staff : `${d.staff} not found (left unassigned)`}.`);
      if (!confirm) continue;
      await conn.beginTransaction();
      try {
        let id = rev?.review_id;
        if (!id) { const [r] = await conn.query("INSERT INTO tbl_transition_reviews (child_id, review_status, flagged_at) VALUES (?, 'For Review', ?)", [k.child_id, d.flagged]); id = r.insertId; }
        await conn.query(`UPDATE tbl_transition_reviews SET flagged_at = ?, review_status = ?, assigned_staff_id = COALESCE(?, assigned_staff_id), assigned_at = IF(? IS NULL, assigned_at, NOW()),
                proposed_pathway = COALESCE(?, proposed_pathway), housing_goal = COALESCE(?, housing_goal), vocational_goal = COALESCE(?, vocational_goal), education_goal = COALESCE(?, education_goal)
          WHERE review_id = ?`, [d.flagged, d.status, staffId, staffId, d.pathway || null, d.goals?.housing_goal || null, d.goals?.vocational_goal || null, d.goals?.education_goal || null, id]);
        await conn.query("INSERT INTO tbl_transition_events (review_id, stage_key, action, summary, to_value) VALUES (?, 'identify', 'demo_seed', 'Demo data set by the seed script', ?)", [id, d.status]);
        await conn.commit();
      } catch (err) { await conn.rollback(); throw err; }
    }
    if (!confirm) console.log('Dry run: nothing was changed. Add --confirm to apply.');
    else console.log('Done.');
  } catch (err) {
    console.error(`[seed] ${err.message}`);
    process.exitCode = 1;
  } finally { await conn.end(); }
})();
