const { pool } = require('../config/db');

/** GET /api/dashboard/summary (Admin, Staff) */
exports.summary = async (req, res) => {
  const [[stats]] = await pool.query(
    `SELECT
       (SELECT COUNT(*) FROM tbl_children WHERE status = 'Active') AS active_children,
       (SELECT COUNT(*) FROM tbl_inventory WHERE quantity <= min_threshold) AS low_stock,
       (SELECT COUNT(*) FROM tbl_visitors WHERE DATE(check_in_time) = CURDATE()) AS visitors_today,
       (SELECT COUNT(*) FROM tbl_visitors WHERE check_out_time IS NULL) AS visitors_on_site,
       (SELECT COALESCE(SUM(amount), 0) FROM tbl_donations
         WHERE YEAR(created_at) = YEAR(CURDATE()) AND MONTH(created_at) = MONTH(CURDATE())) AS donations_this_month`);

  const [donationTrend] = await pool.query(
    `SELECT DATE_FORMAT(created_at, '%Y-%m') AS month, SUM(amount) AS total, COUNT(*) AS count
       FROM tbl_donations
      WHERE created_at >= DATE_FORMAT(CURDATE() - INTERVAL 5 MONTH, '%Y-%m-01')
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
      donation_trend: months,
      age_groups: ageGroups.map((g) => ({ ...g, male: Number(g.male), female: Number(g.female) })),
      low_items: lowItems,
      meals_today: mealsToday,
    },
  });
};
