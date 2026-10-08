const { pool } = require('../config/db');
const Donation = require('../models/donationModel');

/** GET /api/dashboard/summary (Admin, Staff) */
exports.summary = async (req, res) => {
  const [[stats]] = await pool.query(
    `SELECT
       (SELECT COUNT(*) FROM tbl_children WHERE status = 'Active') AS active_children,
       (SELECT COUNT(*) FROM tbl_inventory WHERE quantity <= min_threshold) AS low_stock,
       (SELECT COUNT(*) FROM tbl_visitors WHERE DATE(check_in_time) = CURDATE()) AS visitors_today,
       (SELECT COUNT(*) FROM tbl_visitors WHERE check_out_time IS NULL) AS visitors_on_site`);

  // Same totals as the Donations page (no filters): count = all donations, total = received amounts.
  const donations = await Donation.summary();

  const [donationTrend] = await pool.query(
    `SELECT DATE_FORMAT(created_at, '%Y-%m') AS month, SUM(amount) AS total, COUNT(*) AS count
       FROM tbl_donations
      WHERE status = 'Received' AND created_at >= DATE_FORMAT(CURDATE() - INTERVAL 5 MONTH, '%Y-%m-01')
      GROUP BY month ORDER BY month`);

  const [ageGroups] = await pool.query(
    `SELECT CASE
              WHEN TIMESTAMPDIFF(YEAR, dob, CURDATE()) < 1 THEN 'Under 1'
              WHEN TIMESTAMPDIFF(YEAR, dob, CURDATE()) < 4 THEN '1-3'
              WHEN TIMESTAMPDIFF(YEAR, dob, CURDATE()) < 7 THEN '4-6'
              WHEN TIMESTAMPDIFF(YEAR, dob, CURDATE()) < 13 THEN '7-12'
              ELSE '13+' END AS age_group,
            SUM(gender = 'Male') AS male, SUM(gender = 'Female') AS female
       FROM tbl_children WHERE status = 'Active'
      GROUP BY age_group
      ORDER BY FIELD(age_group, 'Under 1', '1-3', '4-6', '7-12', '13+')`);

  const [lowItems] = await pool.query(
    `SELECT item_id, item_name, category, quantity, min_threshold
       FROM tbl_inventory WHERE quantity <= min_threshold ORDER BY quantity ASC LIMIT 6`);

  const [mealsToday] = await pool.query(
    `SELECT meal_type, menu_description FROM tbl_meals WHERE scheduled_date = CURDATE()
      ORDER BY FIELD(meal_type, 'Breakfast', 'Lunch', 'Snack', 'Dinner')`);

  // Fill the last 6 months so the chart has no gaps.
  const months = [];
  const d = new Date();
  d.setDate(1);
  for (let i = 5; i >= 0; i -= 1) {
    const m = new Date(d.getFullYear(), d.getMonth() - i, 1);
    const key = `${m.getFullYear()}-${String(m.getMonth() + 1).padStart(2, '0')}`;
    const hit = donationTrend.find((r) => r.month === key);
    months.push({ month: key, total: hit ? Number(hit.total) : 0, count: hit ? Number(hit.count) : 0 });
  }

  res.json({
    success: true,
    data: {
      stats: Object.fromEntries(Object.entries(stats).map(([k, v]) => [k, Number(v)])),
      donations: { count: donations.count, received_total: donations.received_total },
      donation_trend: months,
      age_groups: ageGroups.map((g) => ({ ...g, male: Number(g.male), female: Number(g.female) })),
      low_items: lowItems,
      meals_today: mealsToday,
    },
  });
};

/**
 * GET /api/dashboard/due-soon (Admin, Staff; confidentiality undertaking required)
 * Trial custody ending and NACC 60-day deadlines within 14 days (or overdue), and trial
 * custody cases without a monitoring report in the last 30 days. References only.
 */
exports.dueSoon = async (req, res) => {
  const WF = require('../config/adoptionWorkflow');
  const [trial] = await pool.query(
    `SELECT application_id, reference_no, trial_end AS due, DATEDIFF(trial_end, CURDATE()) AS days_left
       FROM tbl_adoption_applications WHERE status = 'Trial custody' AND archived_at IS NULL AND trial_end <= CURDATE() + INTERVAL ? DAY`, [WF.DUE_SOON_DAYS]);
  const [nacc] = await pool.query(
    `SELECT application_id, reference_no, nacc_deadline AS due, DATEDIFF(nacc_deadline, CURDATE()) AS days_left
       FROM tbl_adoption_applications WHERE status IN ('Endorsed to NACC', 'Awaiting NACC decision') AND archived_at IS NULL
        AND nacc_deadline <= CURDATE() + INTERVAL ? DAY`, [WF.DUE_SOON_DAYS]);
  const [monitoring] = await pool.query(
    `SELECT a.application_id, a.reference_no,
            COALESCE(MAX(d.uploaded_at), a.trial_start) AS last_report,
            DATEDIFF(CURDATE(), DATE(COALESCE(MAX(d.uploaded_at), a.trial_start))) AS days_since
       FROM tbl_adoption_applications a
       LEFT JOIN tbl_adoption_documents d ON d.application_id = a.application_id AND d.doc_type = 'monitoring_report' AND d.status = 'Uploaded'
      WHERE a.status = 'Trial custody' AND a.archived_at IS NULL
      GROUP BY a.application_id HAVING days_since >= ?`, [WF.MONITORING_INTERVAL_DAYS]);
  const items = [
    ...trial.map((r) => ({ kind: 'trial_custody_end', label: 'Trial custody ends', application_id: r.application_id, reference_no: r.reference_no, due: r.due, days_left: Number(r.days_left) })),
    ...nacc.map((r) => ({ kind: 'nacc_deadline', label: 'NACC 60-day deadline', application_id: r.application_id, reference_no: r.reference_no, due: r.due, days_left: Number(r.days_left) })),
    ...monitoring.map((r) => ({ kind: 'monitoring_report', label: 'Monthly monitoring report due', application_id: r.application_id, reference_no: r.reference_no,
      due: r.last_report, days_left: WF.MONITORING_INTERVAL_DAYS - Number(r.days_since) })),
  ].sort((a, b) => a.days_left - b.days_left);
  res.json({ success: true, data: items });
};
