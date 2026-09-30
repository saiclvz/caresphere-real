const { pool } = require('../config/db');
const { likeParam } = require('../utils/validate');

module.exports = {
  async list({ from, to, search }) {
    const params = [from, to];
    let extra = '';
    if (search) {
      extra = 'AND (m.menu_description LIKE ? OR m.meal_type LIKE ? OR m.dietary_tags LIKE ?)';
      const p = likeParam(search);
      params.push(p, p, p);
    }
    const [rows] = await pool.query(
      `SELECT m.meal_id, m.meal_type, m.menu_description, m.scheduled_date, m.dietary_tags, m.is_active, m.logged_by,
              u.full_name AS logged_by_name
         FROM tbl_meals m LEFT JOIN tbl_users u ON u.user_id = m.logged_by
        WHERE m.scheduled_date BETWEEN ? AND ? ${extra}
        ORDER BY m.scheduled_date, FIELD(m.meal_type, 'Breakfast', 'Lunch', 'Snack', 'Dinner')`, params);
    return rows.map((r) => ({ ...r, is_active: !!r.is_active }));
  },
  async findById(id) {
    const [rows] = await pool.query('SELECT * FROM tbl_meals WHERE meal_id = ?', [id]);
    return rows[0] ? { ...rows[0], is_active: !!rows[0].is_active } : null;
  },
  async create(m) {
    const [res] = await pool.query(
      'INSERT INTO tbl_meals (meal_type, menu_description, scheduled_date, dietary_tags, logged_by) VALUES (?, ?, ?, ?, ?)',
      [m.meal_type, m.menu_description, m.scheduled_date, m.dietary_tags, m.logged_by]);
    return res.insertId;
  },
  async update(id, m) {
    await pool.query(
      'UPDATE tbl_meals SET meal_type = ?, menu_description = ?, scheduled_date = ?, dietary_tags = ?, logged_by = ? WHERE meal_id = ?',
      [m.meal_type, m.menu_description, m.scheduled_date, m.dietary_tags, m.logged_by, id]);
  },
  async setActive(id, active, userId) {
    await pool.query('UPDATE tbl_meals SET is_active = ?, logged_by = ? WHERE meal_id = ?', [active ? 1 : 0, userId, id]);
  },
  async remove(id) {
    await pool.query('DELETE FROM tbl_meals WHERE meal_id = ?', [id]);
  },
};
