/**
 * Cash and walk-in controls.
 *  - Dual control: cash (or a converted statement deposit) above the setting cash_dual_control_threshold stays
 *    'Pending' (not counted, no acknowledgment) until a second person confirms it was received: an Admin, or Staff
 *    with Donations, who did not record it.
 *  - Daily cash count: Staff or Admin with Donations enter the cash counted for a day; the system shows the cash
 *    donations recorded that day and the difference; an Admin signs it off (not the person who counted, unless they
 *    are the only active Admin, which is recorded).
 *  - Alerts to Admin: voids, corrections after acknowledgment, cash recorded outside office hours, many cash entries
 *    by one person in a day, several voids by one person in a day.
 * Acknowledgment numbers are sequential (ACK-YYYY-NNNN, donationLifecycle.acknowledge); they are not secrets: the
 * random receipt code is what proves a receipt.
 */
const { pool, withTransaction } = require('../config/db');
const HttpError = require('../utils/HttpError');
const { limits } = require('./claimSettings');
const { toCents, centsToDecimal, dbToCents, formatPeso } = require('../utils/money');
const { logActivityWith, logActivity } = require('../utils/audit');
const { hasDuty } = require('../middleware/requireDuty');

const OFFICE = { start: 7, end: 19 };
const MANY_CASH_PER_DAY = 5;
const MANY_VOIDS_PER_DAY = 2;
const Notify = () => require('./notifications');
const LC = () => require('./donationLifecycle');

async function needsDualControl(conn, cents) {
  const L = await limits(conn);
  return L.cash_dual_control_threshold > 0 && cents > L.cash_dual_control_threshold * 100;
}

async function askSecondPerson(conn, req, donationId) {
  const [[d]] = await conn.query('SELECT donation_no FROM tbl_donations WHERE donation_id = ?', [donationId]);
  const params = { ref: d.donation_no, id: donationId };
  await Notify().toAdmins(conn, 'admin_cash_confirm', { params, exceptUserId: req.user.user_id, groupKey: `cash_confirm:${donationId}` });
  await Notify().toStaffWithDuties(conn, 'staff_cash_confirm', ['donations'], { params, exceptUserId: req.user.user_id, groupKey: `cash_confirm:${donationId}` });
}

/** POST /donations/:id/confirm-cash - the second person confirms the cash was received. */
async function confirmCash(req, id) {
  if (req.user.role !== 'Admin' && !(req.user.role === 'Staff' && hasDuty(req, 'donations'))) throw new HttpError(403, 'ACCESS DENIED – You are not authorized to view this information.');
  await withTransaction(async (conn) => {
    const d = await LC().lockDonation(conn, id);
    if (d.dual_control !== 'Waiting') throw new HttpError(409, 'This donation is not waiting for a second confirmation.');
    if (d.recorded_by === req.user.user_id) throw new HttpError(403, 'You recorded this donation, so someone else must confirm it.');
    await conn.query("UPDATE tbl_donations SET dual_control = 'Approved' WHERE donation_id = ?", [d.donation_id]);
    await conn.query("INSERT INTO tbl_donation_approvals (donation_id, kind, verified_amount, requested_by, status, decided_by, decided_at) VALUES (?, 'cash_dual_control', ?, ?, 'Approved', ?, NOW())",
      [d.donation_id, d.amount, d.recorded_by || req.user.user_id, req.user.user_id]);
    const full = { ...d, amount: Number(d.amount) };
    await LC().setStatus(conn, req, full, 'Received', 'Cash confirmed by a second person');
    if (!(await LC().allocationProblems(conn, full)).length) await LC().setStatus(conn, req, full, 'Accepted', 'Allocation recorded with the donation');
    await logActivityWith(conn, req, `DONATION_CASH_CONFIRMED (PHP ${d.amount})`, `Donation #${d.donation_id}`);
  });
}

async function alert(conn, d, what, exceptUserId) {
  await Notify().toAdmins(conn, 'admin_donation_alert', { params: { ref: d.donation_no || `#${d.donation_id}`, id: d.donation_id, what }, exceptUserId, groupKey: `donation_alert:${d.donation_id}:${what}` });
}

/** After a staff member records cash: office hours and volume checks. */
async function afterCashRecorded(conn, req, donationId) {
  const [[d]] = await conn.query('SELECT donation_id, donation_no FROM tbl_donations WHERE donation_id = ?', [donationId]);
  const hour = new Date().getHours();
  if (hour < OFFICE.start || hour >= OFFICE.end) await alert(conn, d, 'cash recorded outside office hours', req.user.user_id);
  const [[n]] = await conn.query("SELECT COUNT(*) AS n FROM tbl_donations WHERE recorded_by = ? AND payment_method = 'Cash' AND created_at >= CURDATE()", [req.user.user_id]);
  if (Number(n.n) > MANY_CASH_PER_DAY) await alert(conn, d, `${n.n} cash entries by one staff member today`, req.user.user_id);
}

async function afterVoid(conn, req, d) {
  await alert(conn, d, 'voided', req.user.user_id);
  const [[n]] = await conn.query('SELECT COUNT(*) AS n FROM tbl_donations WHERE voided_by = ? AND voided_at >= NOW() - INTERVAL 1 DAY', [req.user.user_id]);
  if (Number(n.n) > MANY_VOIDS_PER_DAY) await alert(conn, d, `${n.n} voids by one person in a day`, req.user.user_id);
}

const afterCorrection = (conn, req, d, field) => alert(conn, d, `${field.replace(/_/g, ' ')} corrected after acknowledgment`, req.user.user_id);

// ---------------------------------------------------------------- daily cash count

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const today = () => { const x = new Date(); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`; };

async function expectedCash(conn, date) {
  const [[r]] = await conn.query(
    `SELECT COALESCE(SUM(amount), 0) AS total, COUNT(*) AS n FROM tbl_donations
      WHERE payment_method = 'Cash' AND status NOT IN ('Voided', 'Rejected', 'Cancelled') AND DATE(created_at) = ?`, [date]);
  return { cents: dbToCents(r.total), count: Number(r.n) };
}

function requireCashDuty(req) {
  if (req.user.role !== 'Admin' && !(req.user.role === 'Staff' && hasDuty(req, 'donations'))) throw new HttpError(403, 'ACCESS DENIED – You are not authorized to view this information.');
}

/** GET /cash-counts?from=&to= - the last 31 days by default, with the expected cash for each. */
async function list(req) {
  requireCashDuty(req);
  const [rows] = await pool.query(
    `SELECT c.count_id, c.count_date, c.expected_cash, c.counted_cash, c.note, c.counted_at, cu.full_name AS counted_by_name, c.counted_by,
            c.signed_off_at, su.full_name AS signed_off_by_name
       FROM tbl_cash_counts c JOIN tbl_users cu ON cu.user_id = c.counted_by LEFT JOIN tbl_users su ON su.user_id = c.signed_off_by
      WHERE c.count_date >= CURDATE() - INTERVAL 60 DAY ORDER BY c.count_date DESC`);
  const t = today();
  const exp = await expectedCash(pool, t);
  await logActivity(req, 'VIEW_CASH_COUNTS', 'Daily cash count');
  return {
    today: { date: t, expected_cash: exp.cents / 100, cash_donations: exp.count, counted: rows.some((r) => String(r.count_date).slice(0, 10) === t) },
    rows: rows.map((r) => ({ ...r, expected_cash: Number(r.expected_cash), counted_cash: Number(r.counted_cash), difference: Number(r.counted_cash) - Number(r.expected_cash),
      can_sign: req.user.role === 'Admin' && !r.signed_off_at })),
  };
}

/** POST /cash-counts { date, counted_cash, note? } - one count per day; it can't be changed once signed off. */
async function submit(req, body) {
  requireCashDuty(req);
  const date = String(body?.date || today());
  if (!DATE.test(date) || date > today()) throw new HttpError(422, 'Choose the day counted (today or earlier).', { errors: { date: 'Today or earlier.' } });
  const counted = toCents(body?.counted_cash, 'Cash counted', { min: 0, max: 99999999 });
  const note = String(body?.note || '').trim().slice(0, 500) || null;
  return withTransaction(async (conn) => {
    const exp = await expectedCash(conn, date);
    const [[cur]] = await conn.query('SELECT count_id, signed_off_at FROM tbl_cash_counts WHERE count_date = ? FOR UPDATE', [date]);
    if (cur?.signed_off_at) throw new HttpError(409, 'This day was already signed off. Ask an administrator if it needs a correction.');
    if (Math.abs(counted - exp.cents) > 0 && !note) throw new HttpError(422, 'The count differs from the cash recorded. Explain the difference.', { errors: { note: 'Explain the difference.' } });
    if (cur) {
      await conn.query('UPDATE tbl_cash_counts SET expected_cash = ?, counted_cash = ?, note = ?, counted_by = ?, counted_at = NOW() WHERE count_id = ?', [centsToDecimal(exp.cents), centsToDecimal(counted), note, req.user.user_id, cur.count_id]);
    } else {
      await conn.query('INSERT INTO tbl_cash_counts (count_date, expected_cash, counted_cash, note, counted_by) VALUES (?, ?, ?, ?, ?)', [date, centsToDecimal(exp.cents), centsToDecimal(counted), note, req.user.user_id]);
    }
    const diff = counted - exp.cents;
    await logActivityWith(conn, req, `CASH_COUNT_RECORDED (${date}, counted PHP ${centsToDecimal(counted)}, expected PHP ${centsToDecimal(exp.cents)})`, `Cash count ${date}`);
    await Notify().toAdmins(conn, 'admin_cash_count', { params: { date, difference: diff ? formatPeso(diff) : null }, exceptUserId: req.user.user_id, groupKey: `cash_count:${date}` });
    return { date, expected_cash: exp.cents / 100, counted_cash: counted / 100, difference: diff / 100 };
  });
}

/** POST /cash-counts/:id/sign-off (Admin) */
async function signOff(req, id) {
  if (req.user.role !== 'Admin') throw new HttpError(403, 'An administrator signs off the cash count.');
  await withTransaction(async (conn) => {
    const [[c]] = await conn.query('SELECT * FROM tbl_cash_counts WHERE count_id = ? FOR UPDATE', [id]);
    if (!c) throw new HttpError(404, 'Cash count not found.');
    if (c.signed_off_at) throw new HttpError(409, 'Already signed off.');
    let self = false;
    if (c.counted_by === req.user.user_id) {
      const [[a]] = await conn.query("SELECT COUNT(*) AS n FROM tbl_users u JOIN tbl_roles r ON r.role_id = u.role_id WHERE r.role_name = 'Admin' AND u.is_active = TRUE AND u.user_id <> ?", [req.user.user_id]);
      if (Number(a.n) > 0) throw new HttpError(403, 'You counted this cash, so another administrator must sign it off.');
      self = true;
    }
    await conn.query('UPDATE tbl_cash_counts SET signed_off_by = ?, signed_off_at = NOW() WHERE count_id = ?', [req.user.user_id, id]);
    await logActivityWith(conn, req, `CASH_COUNT_SIGNED_OFF (${String(c.count_date).slice(0, 10)}${self ? ', by the person who counted: the only active Admin' : ''})`, `Cash count #${id}`);
  });
}

module.exports = { needsDualControl, askSecondPerson, confirmCash, afterCashRecorded, afterVoid, afterCorrection, list, submit, signOff, expectedCash };
