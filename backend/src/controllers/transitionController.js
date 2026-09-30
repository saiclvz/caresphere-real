const { pool } = require('../config/db');
const HttpError = require('../utils/HttpError');
const { oneOf, toInt, trimOrNull, likeParam } = require('../utils/validate');
const { logActivity } = require('../utils/audit');
const { syncFlags } = require('./childController');

const STATUSES = ['For Review', 'In Progress', 'Completed'];

const SELECT = `SELECT tr.review_id, tr.child_id, tr.review_status, tr.notes, tr.housing_goal, tr.vocational_goal,
    tr.education_goal, tr.flagged_at, tr.updated_at, u.full_name AS updated_by_name,
    c.full_name, c.gender, c.dob, c.status AS child_status, TIMESTAMPDIFF(YEAR, c.dob, CURDATE()) AS age
  FROM tbl_transition_reviews tr
  JOIN tbl_children c ON c.child_id = tr.child_id
  LEFT JOIN tbl_users u ON u.user_id = tr.updated_by`;

/** GET /api/transition-reviews?status=&q=  - children flagged at 18+ (never discharged automatically) */
exports.list = async (req, res) => {
  await syncFlags(true);
  const where = [];
  const params = [];
  if (req.query.status) { where.push('tr.review_status = ?'); params.push(oneOf(req.query.status, STATUSES, 'status')); }
  if (req.query.q) {
    where.push('(c.full_name LIKE ? OR c.child_id LIKE ? OR tr.review_status LIKE ?)');
    const p = likeParam(req.query.q);
    params.push(p, p, p);
  }
  const [rows] = await pool.query(`${SELECT} ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
    ORDER BY FIELD(tr.review_status, 'For Review', 'In Progress', 'Completed'), c.dob`, params);
  res.json({ success: true, data: rows });
};

/** PUT /api/transition-reviews/:id  { review_status, notes, housing_goal, vocational_goal, education_goal } */
exports.update = async (req, res) => {
  const id = toInt(req.params.id, 'id', { min: 1 });
  const [[current]] = await pool.query('SELECT review_id, child_id, review_status FROM tbl_transition_reviews WHERE review_id = ?', [id]);
  if (!current) throw new HttpError(404, 'Transition review not found.');
  const status = req.body.review_status ? oneOf(req.body.review_status, STATUSES, 'review_status') : current.review_status;
  await pool.query(
    `UPDATE tbl_transition_reviews SET review_status = ?, notes = ?, housing_goal = ?, vocational_goal = ?, education_goal = ?,
            updated_by = ? WHERE review_id = ?`,
    [status, trimOrNull(req.body.notes, 10000), trimOrNull(req.body.housing_goal, 3000), trimOrNull(req.body.vocational_goal, 3000),
      trimOrNull(req.body.education_goal, 3000), req.user.user_id, id]);
  await logActivity(req, status !== current.review_status ? `TRANSITION_${status.toUpperCase().replace(/\s+/g, '_')}` : 'UPDATE_TRANSITION_REVIEW',
    `Child ${current.child_id}`);
  const [[row]] = await pool.query(`${SELECT} WHERE tr.review_id = ?`, [id]);
  res.json({ success: true, data: row });
};
