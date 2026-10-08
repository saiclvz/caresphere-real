const ExcelJS = require('exceljs');
const { pool } = require('../config/db');
const Settings = require('../models/settingsModel');
const pdf = require('../services/pdfService');
const { requireDate, localToday } = require('../utils/validate');
const { readPagination } = require('../utils/pagination');
const { logActivity } = require('../utils/audit');
const A = require('../services/auditLog');
const C = require('../config/auditCategories');

/**
 * GET /api/audit-logs?category=&type=&ended=&from=&to=&user_id=&event=&q=&page=&limit= (Admin)
 * One log over the activity, health-access and unlock tables; filtered, sorted (newest first) and
 * paged on the server. Rows carry friendly labels and reference numbers only.
 */
exports.list = async (req, res) => {
  const paging = readPagination(req.query) || { page: 1, limit: 20 };
  const result = await A.list(req.query, paging);
  res.json({ success: true, data: result.rows, pagination: result.pagination });
};

/** GET /api/audit-logs/options?from=&to= (Admin) - dropdown contents, with category counts for the date range. */
exports.options = async (req, res) => {
  const [counts, users] = await Promise.all([A.categoryCounts(req.query), A.users()]);
  res.json({ success: true, data: {
    categories: C.CATEGORIES.map((c) => ({ ...c, count: counts[c.key] || 0 })), total: counts.all,
    record_types: C.RECORD_TYPES, ended: C.ENDED.map(({ key, label }) => ({ key, label })),
    events: C.EVENTS.map(({ key, label, category }) => ({ key, label, category })), users,
  } });
};

/** GET /api/audit-logs/export (Admin) - the filtered entries as Excel: category, friendly action, raw code, reference only. */
exports.exportXlsx = async (req, res) => {
  const rows = await A.all(req.query);
  const label = Object.fromEntries(C.CATEGORIES.map((c) => [c.key, c.label]));
  const wb = new ExcelJS.Workbook();
  wb.creator = 'CareSphere';
  wb.created = new Date();
  const ws = wb.addWorksheet('Audit log', { views: [{ state: 'frozen', ySplit: 1 }] });
  ws.columns = [
    { header: 'When', key: 'at', width: 21 }, { header: 'Category', key: 'category', width: 24 }, { header: 'User', key: 'user_name', width: 24 },
    { header: 'Role', key: 'user_role', width: 10 }, { header: 'Action', key: 'label', width: 44 }, { header: 'Event code', key: 'code', width: 40 },
    { header: 'Record', key: 'record', width: 20 }, { header: 'Device', key: 'device', width: 10 }, { header: 'Detail', key: 'detail', width: 44 },
  ];
  ws.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
  ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F172A' } };
  rows.forEach((r) => ws.addRow({ ...r, category: label[r.category] || r.category, record: r.record?.label || '' }));
  ws.autoFilter = { from: 'A1', to: 'I1' };
  await logActivity(req, `EXPORT_AUDIT_LOG (${rows.length} rows; ${A.describeFilters(req.query)})`, 'Audit log');
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="CareSphere-Audit-Log-${localToday()}.xlsx"`);
  await wb.xlsx.write(res);
  res.end();
};

/** GET /api/reports/compliance?from&to - PDF */
exports.complianceReport = async (req, res) => {
  const today = localToday();
  const from = req.query.from ? requireDate(req.query.from, 'from') : `${today.slice(0, 7)}-01`;
  const to = req.query.to ? requireDate(req.query.to, 'to') : today;
  const p = [from, to];
  const one = async (sql, params = []) => (await pool.query(sql, params))[0][0];

  const children = await one(
    `SELECT SUM(status = 'Active') AS active, SUM(status = 'Discharged') AS discharged, SUM(status = 'Adopted') AS adopted,
            SUM(status = 'Active' AND TIMESTAMPDIFF(YEAR, dob, CURDATE()) >= 18) AS transition_flagged,
            SUM(status = 'Active' AND NOT EXISTS (SELECT 1 FROM tbl_health_history h WHERE h.child_id = c.child_id)) AS missing_health
       FROM tbl_children c`);
  const phi = await one(
    `SELECT SUM(event = 'TOKEN_ISSUED') AS grants, SUM(event = 'VIEW') AS views, SUM(event = 'UPDATE') AS updates,
            SUM(event = 'TOKEN_DENIED') AS denied, SUM(event = 'TOKEN_EXPIRED') AS expired
       FROM tbl_health_data_access_logs WHERE DATE(created_at) BETWEEN ? AND ?`, p);
  const adoptions = await one(
    `SELECT COUNT(*) AS submitted,
            (SELECT COUNT(*) FROM tbl_adoption_applications WHERE DATE(finalized_at) BETWEEN ? AND ?) AS completed,
            SUM(status IN (?)) AS open
       FROM tbl_adoption_applications WHERE submitted_at IS NOT NULL AND DATE(submitted_at) BETWEEN ? AND ?`,
    [...p, require('../config/adoptionWorkflow').ACTIVE.filter((x) => x !== 'Draft'), ...p]);
  const discharges = await one('SELECT COUNT(*) AS count FROM tbl_child_discharge_history WHERE discharge_date BETWEEN ? AND ?', p);
  const inventory = await one(
    `SELECT COUNT(*) AS total, SUM(quantity <= min_threshold) AS low FROM tbl_inventory`);
  const [lowItems] = await pool.query(
    'SELECT item_name, quantity, min_threshold FROM tbl_inventory WHERE quantity <= min_threshold ORDER BY quantity');
  const donations = await one(
    `SELECT SUM(status = 'Received') AS count, COALESCE(SUM(CASE WHEN status = 'Received' THEN amount END), 0) AS total,
            SUM(status = 'Pending') AS pending,
            SUM(allocation_notes IS NULL OR TRIM(allocation_notes) = '') AS unallocated
       FROM tbl_donations WHERE DATE(created_at) BETWEEN ? AND ?`, p);
  const visitors = await one(
    `SELECT COUNT(*) AS count, SUM(check_out_time IS NULL) AS open
       FROM tbl_visitors WHERE DATE(check_in_time) BETWEEN ? AND ?`, p);
  const meals = await one('SELECT COUNT(*) AS count FROM tbl_meals WHERE scheduled_date BETWEEN ? AND ?', p);

  // The audit section follows the Activity log filters (period = From/To, or this month).
  const auditQuery = { ...req.query, from, to };
  const counts = await A.categoryCounts(auditQuery);
  const filtered = await A.list(auditQuery, { page: 1, limit: 10 });
  const audit = {
    filters: A.describeFilters(auditQuery), total: filtered.pagination.total,
    by_category: C.CATEGORIES.map((c) => ({ label: c.label, count: counts[c.key] || 0 })),
  };
  const n = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, Number(v) || 0]));
  const data = {
    from, to,
    generated_at: new Date().toLocaleString('en-PH'),
    generated_by: req.user.full_name,
    children: n(children), phi: n(phi), adoptions: n(adoptions), discharges: n(discharges),
    inventory: { ...n(inventory), low_items: lowItems },
    donations: n(donations), visitors: n(visitors), meals: n(meals), audit,
  };

  await logActivity(req, `GENERATE_COMPLIANCE_REPORT (${A.describeFilters(auditQuery)})`, 'Reports');
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="CareSphere-Compliance-${from}-to-${to}.pdf"`);
  pdf.complianceReport(res, data, await Settings.getAll());
};

