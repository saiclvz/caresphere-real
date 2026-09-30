const ExcelJS = require('exceljs');
const { pool } = require('../config/db');
const Log = require('../models/logModel');
const Settings = require('../models/settingsModel');
const pdf = require('../services/pdfService');
const { toInt, requireDate, localToday, likeParam } = require('../utils/validate');
const { logActivity } = require('../utils/audit');

function filters(q) {
  return {
    userId: q.user_id ? toInt(q.user_id, 'user_id', { min: 1 }) : undefined,
    entity: q.entity ? String(q.entity).slice(0, 50) : undefined,
    action: q.action ? String(q.action).slice(0, 50) : undefined,
    from: q.from ? requireDate(q.from, 'from') : undefined,
    to: q.to ? requireDate(q.to, 'to') : undefined,
    search: (q.search || q.q) ? String(q.search || q.q).slice(0, 100) : undefined,
  };
}

exports.list = async (req, res) => {
  const page = req.query.page ? toInt(req.query.page, 'page', { min: 1 }) : 1;
  const pageSize = req.query.page_size ? toInt(req.query.page_size, 'page_size', { min: 10, max: 200 }) : 50;
  res.json({ success: true, ...(await Log.list(filters(req.query), { page, pageSize })) });
};

/** GET /api/audit-logs/export - .xlsx via exceljs */
exports.exportXlsx = async (req, res) => {
  const rows = await Log.all(filters(req.query));
  const wb = new ExcelJS.Workbook();
  wb.creator = 'CareSphere';
  wb.created = new Date();
  const ws = wb.addWorksheet('Audit log', { views: [{ state: 'frozen', ySplit: 1 }] });
  ws.columns = [
    { header: 'Log ID', key: 'log_id', width: 10 },
    { header: 'Timestamp', key: 'timestamp', width: 21 },
    { header: 'User', key: 'full_name', width: 26 },
    { header: 'Role', key: 'role', width: 10 },
    { header: 'Action', key: 'action_performed', width: 48 },
    { header: 'Target', key: 'target_entity', width: 26 },
    { header: 'IP address', key: 'ip_address', width: 18 },
  ];
  ws.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
  ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F172A' } };
  rows.forEach((r) => ws.addRow(r));
  ws.autoFilter = { from: 'A1', to: 'G1' };

  await logActivity(req, `EXPORT_AUDIT_LOG (${rows.length} rows)`, 'Audit log');
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
    `SELECT COUNT(*) AS submitted, SUM(status = 'Completed') AS completed, SUM(status IN ('Submitted','Under Review','Additional Documents Required','Approved')) AS open
       FROM tbl_adoption_applications WHERE DATE(submitted_at) BETWEEN ? AND ?`, p);
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

  const n = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, Number(v) || 0]));
  const data = {
    from, to,
    generated_at: new Date().toLocaleString('en-PH'),
    generated_by: req.user.full_name,
    children: n(children), phi: n(phi), adoptions: n(adoptions), discharges: n(discharges),
    inventory: { ...n(inventory), low_items: lowItems },
    donations: n(donations), visitors: n(visitors), meals: n(meals),
  };

  await logActivity(req, `GENERATE_COMPLIANCE_REPORT (${from} to ${to})`, 'Reports');
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="CareSphere-Compliance-${from}-to-${to}.pdf"`);
  pdf.complianceReport(res, data, await Settings.getAll());
};

/** GET /api/audit-logs/health-access?q=&from=&to= (Admin) - every grant, denial, view, update and expiry */
exports.healthAccess = async (req, res) => {
  const where = [];
  const params = [];
  if (req.query.from) { where.push('DATE(l.created_at) >= ?'); params.push(requireDate(req.query.from, 'from')); }
  if (req.query.to) { where.push('DATE(l.created_at) <= ?'); params.push(requireDate(req.query.to, 'to')); }
  if (req.query.q) {
    where.push('(u.full_name LIKE ? OR l.child_id LIKE ? OR l.event LIKE ? OR l.detail LIKE ?)');
    const p = likeParam(req.query.q);
    params.push(p, p, p, p);
  }
  const [rows] = await pool.query(
    `SELECT l.log_id, l.child_id, l.event, l.detail, l.ip_address, l.created_at, u.full_name AS user_name, r.role_name AS user_role
       FROM tbl_health_data_access_logs l
       LEFT JOIN tbl_users u ON u.user_id = l.user_id LEFT JOIN tbl_roles r ON r.role_id = u.role_id
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY l.created_at DESC, l.log_id DESC LIMIT 1000`, params);
  res.json({ success: true, data: rows });
};
