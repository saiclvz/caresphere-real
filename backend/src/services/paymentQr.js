/**
 * Settings > Payment QR (Admin only; Staff can never change it). A swapped QR or account name can divert real
 * donations, so every change to a QR image, account name, account number or bank / wallet name:
 *   - needs the Admin to re-authenticate (password and two-step code; services/reauth.js) and give a reason;
 *   - needs a second Admin's approval when the home has two or more active Admins (setting payment_qr_second_admin);
 *   - is decoded on the server first (services/qrImage.js): an image that can't be decoded is refused, a QR Ph name
 *     that doesn't fit the account name is flagged, and the decoded text is shown to the Admins before it applies;
 *   - becomes a new immutable version (the old image is kept) and notifies every Admin.
 * Donors only ever see the current version of an enabled method, as an image stored by CareSphere.
 */
const { pool, withTransaction } = require('../config/db');
const HttpError = require('../utils/HttpError');
const Notify = require('./notifications');
const { logActivityWith, logActivity } = require('../utils/audit');
const { saveBuffer, readUpload, discardUnsavedUpload } = require('../utils/files');
const { readImage, decodeAndClean, namesMatch } = require('./qrImage');
const reauth = require('./reauth');
const links = require('../utils/signedLinks');
const { mask } = require('../utils/reference');
const { sha256 } = require('../utils/crypto');
const { limits } = require('./claimSettings');
const { QR_PROBLEMS } = require('../config/donationClaims');

const GROUPS = ['E-wallet', 'Bank transfer'];
const text = (v, max) => { const s = String(v ?? '').trim().replace(/\s+/g, ' '); return s ? s.slice(0, max) : null; };

function cleanDetails(b) {
  const errors = {};
  const label = text(b.label, 60);
  if (!label || label.length < 2) errors.label = 'Enter the label donors see (for example GCash).';
  const group = String(b.method_group || '');
  if (!GROUPS.includes(group)) errors.method_group = 'Choose E-wallet or Bank transfer.';
  const accountName = text(b.account_name, 120);
  if (!accountName || accountName.length < 2) errors.account_name = 'Enter the account name exactly as donors will see it in their app.';
  const accountNumber = text(b.account_number, 60);
  if (accountNumber && !/^[0-9 +-]{4,40}$/.test(accountNumber)) errors.account_number = 'Digits, spaces, + and dashes only.';
  const bankName = text(b.bank_name, 120);
  if (group === 'Bank transfer' && !bankName) errors.bank_name = 'Enter the bank name.';
  const instructions = text(b.instructions, 1000);
  const reason = text(b.reason, 500);
  if (!reason || reason.length < 5) errors.reason = 'Give the reason for this change (at least 5 characters).';
  if (Object.keys(errors).length) throw new HttpError(422, 'Some details need attention.', { errors });
  return { label, method_group: group, account_name: accountName, account_number: accountNumber, bank_name: bankName, instructions, reason };
}

async function activeAdmins(conn) {
  const [[r]] = await conn.query("SELECT COUNT(*) AS n FROM tbl_users u JOIN tbl_roles r ON r.role_id = u.role_id WHERE r.role_name = 'Admin' AND u.is_active = TRUE");
  return Number(r.n);
}

function nameCheck(decoded, accountName) {
  if (decoded.emv) return decoded.emv.name ? (namesMatch(decoded.emv.name, accountName) ? 'match' : 'mismatch') : 'no_name';
  return 'not_qrph';
}

/** POST /payment-qr/preview { image, account_name } - decode only (nothing is saved): what the Admin checks before saving. */
async function preview(req, body) {
  const decoded = await decodeAndClean(readImage(body?.image));
  const accountName = text(body?.account_name, 120) || '';
  return {
    qr_format: decoded.emv ? 'qrph' : 'other', decoded_text: decoded.text, decoded_name: decoded.emv?.name || null,
    name_check: nameCheck(decoded, accountName), currency: decoded.emv?.currency || null, country: decoded.emv?.country || null,
  };
}

const CHANGE_COLS = `c.change_id, c.method_id, c.action, c.label, c.method_group, c.account_name, c.account_number, c.bank_name, c.instructions, c.qr_format,
  c.qr_decoded_text, c.qr_decoded_name, c.name_mismatch, c.reason, c.requested_by, ru.full_name AS requested_by_name, c.requested_at, c.needs_second, c.status,
  c.decided_by, du.full_name AS decided_by_name, c.decided_at, c.decision_note, c.version_id`;
const CHANGE_FROM = 'FROM tbl_payment_qr_changes c JOIN tbl_users ru ON ru.user_id = c.requested_by LEFT JOIN tbl_users du ON du.user_id = c.decided_by';

async function slugFor(conn, label) {
  const base = String(label).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 20) || 'method';
  for (let i = 0; i < 50; i += 1) {
    const code = i ? `${base}_${i + 1}` : base;
    const [[x]] = await conn.query('SELECT method_id FROM tbl_payment_methods WHERE code = ?', [code]);
    if (!x) return code;
  }
  throw new HttpError(409, 'Choose a different label.');
}

/** Applies an approved change: a new immutable version and the method now points to it. */
async function apply(conn, req, ch, approverId) {
  let methodId = ch.method_id;
  if (ch.action === 'create') {
    const [[order]] = await conn.query('SELECT COALESCE(MAX(sort_order), 0) + 10 AS n FROM tbl_payment_methods');
    const [r] = await conn.query(
      "INSERT INTO tbl_payment_methods (code, name, method_group, method_type, enabled, sort_order, instructions, updated_by, created_at) VALUES (?, ?, ?, 'qr', TRUE, ?, ?, ?, NOW())",
      [await slugFor(conn, ch.label), ch.label, ch.method_group, Number(order.n), ch.instructions, ch.requested_by]);
    methodId = r.insertId;
  }
  const [[last]] = await conn.query('SELECT COALESCE(MAX(version_no), 0) AS n FROM tbl_payment_qr_versions WHERE method_id = ?', [methodId]);
  const [v] = await conn.query(
    `INSERT INTO tbl_payment_qr_versions (method_id, version_no, label, method_group, account_name, account_number, bank_name, instructions, qr_storage_key, qr_sha256,
       qr_format, qr_decoded_name, qr_payload_sha256, reason, change_id, created_by, approved_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [methodId, Number(last.n) + 1, ch.label, ch.method_group, ch.account_name, ch.account_number, ch.bank_name, ch.instructions, ch.qr_storage_key, ch.qr_sha256,
      ch.qr_format, ch.qr_decoded_name, sha256(ch.qr_decoded_text || ''), ch.reason, ch.change_id, ch.requested_by, approverId]);
  await conn.query(
    `UPDATE tbl_payment_methods SET name = ?, method_group = ?, current_version_id = ?, qr_updated_at = NOW(), instructions = ?,
       last_confirmed_by = ?, last_confirmed_at = NOW(), updated_by = ? WHERE method_id = ?`,
    [ch.label, ch.method_group, v.insertId, ch.instructions, approverId || ch.requested_by, approverId || ch.requested_by, methodId]);
  await conn.query("UPDATE tbl_payment_qr_changes SET status = 'Applied', method_id = ?, version_id = ?, decided_by = COALESCE(?, decided_by), decided_at = NOW() WHERE change_id = ?",
    [methodId, v.insertId, approverId, ch.change_id]);
  await logActivityWith(conn, req, `PAYMENT_QR_APPLIED (${ch.label}, version ${Number(last.n) + 1}, account ${mask(ch.account_number) || 'no number'})`, `Payment method #${methodId}`);
  await Notify.toAdmins(conn, 'admin_qr_change', { params: { label: ch.label, step: 'applied' }, groupKey: `qr_change:${ch.change_id}:applied` });
  return { method_id: methodId, version_id: v.insertId };
}

/**
 * POST /payment-qr/changes (Admin, X-Reauth) { method_id?, label, method_group, account_name, account_number?, bank_name?,
 * instructions?, image, reason }. Applies at once when no second Admin is needed; otherwise waits for one.
 */
async function requestChange(req, body) {
  const b = body || {};
  const methodId = b.method_id === undefined || b.method_id === null || b.method_id === '' ? null : Number(b.method_id);
  if (methodId !== null && !(Number.isInteger(methodId) && methodId > 0)) throw new HttpError(400, 'Unknown payment method.');
  const d = cleanDetails(b);
  const decoded = await decodeAndClean(readImage(b.image));
  const check = nameCheck(decoded, d.account_name);
  if (check === 'mismatch' && b.confirm_mismatch !== true) {
    throw new HttpError(409, `The name inside this QR code ("${decoded.emv.name}") doesn't match the account name you typed. Check the QR. If it is right, confirm to save it anyway.`,
      { name_mismatch: true, decoded_name: decoded.emv.name, decoded_text: decoded.text });
  }
  const saved = saveBuffer(decoded.clean, { folder: 'payment-qr', ext: 'png', mime: 'image/png', name: 'qr.png' });
  try {
    return await withTransaction(async (conn) => {
      await reauth.consume(conn, req, 'payment_qr');
      if (methodId) {
        const [[m]] = await conn.query('SELECT method_id FROM tbl_payment_methods WHERE method_id = ? FOR UPDATE', [methodId]);
        if (!m) throw new HttpError(404, 'Payment method not found.');
        const [[open]] = await conn.query("SELECT change_id FROM tbl_payment_qr_changes WHERE method_id = ? AND status = 'Pending'", [methodId]);
        if (open) throw new HttpError(409, 'A change for this method is already waiting for approval. Approve, reject or cancel it first.');
      }
      const L = await limits(conn);
      const needsSecond = L.payment_qr_second_admin === 1 && (await activeAdmins(conn)) >= 2;
      const [r] = await conn.query(
        `INSERT INTO tbl_payment_qr_changes (method_id, action, label, method_group, account_name, account_number, bank_name, instructions, qr_storage_key, qr_sha256, qr_format,
           qr_decoded_text, qr_decoded_name, name_mismatch, reason, requested_by, needs_second)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [methodId, methodId ? 'update_qr' : 'create', d.label, d.method_group, d.account_name, d.account_number, d.bank_name, d.instructions, saved.storage_key, saved.sha256,
          decoded.emv ? 'qrph' : 'other', decoded.text, decoded.emv?.name || null, check === 'mismatch' ? 1 : 0, d.reason, req.user.user_id, needsSecond ? 1 : 0]);
      await logActivityWith(conn, req, `PAYMENT_QR_CHANGE_REQUESTED (${d.label}${check === 'mismatch' ? ', name mismatch confirmed' : ''})`, `Payment QR change #${r.insertId}`);
      const [[ch]] = await conn.query('SELECT * FROM tbl_payment_qr_changes WHERE change_id = ?', [r.insertId]);
      if (!needsSecond) {
        const out = await apply(conn, req, ch, null);
        return { change_id: r.insertId, status: 'Applied', ...out };
      }
      await Notify.toAdmins(conn, 'admin_qr_change', { params: { label: d.label, step: 'requested' }, groupKey: `qr_change:${r.insertId}:requested` });
      return { change_id: r.insertId, status: 'Pending' };
    });
  } catch (err) { discardUnsavedUpload(saved.storage_key); throw err; }
}

async function lockPending(conn, id) {
  const [[ch]] = await conn.query("SELECT * FROM tbl_payment_qr_changes WHERE change_id = ? FOR UPDATE", [id]);
  if (!ch) throw new HttpError(404, 'Change not found.');
  if (ch.status !== 'Pending') throw new HttpError(409, `This change was already ${ch.status.toLowerCase()}.`);
  return ch;
}

/** POST /payment-qr/changes/:id/approve (a different Admin, X-Reauth) { note? } */
async function approve(req, id, body) {
  return withTransaction(async (conn) => {
    const ch = await lockPending(conn, id);
    if (ch.requested_by === req.user.user_id) throw new HttpError(403, 'Another administrator must approve a change you requested.');
    await reauth.consume(conn, req, 'payment_qr');
    await conn.query('UPDATE tbl_payment_qr_changes SET decision_note = ? WHERE change_id = ?', [text(body?.note, 500), id]);
    await logActivityWith(conn, req, `PAYMENT_QR_CHANGE_APPROVED (${ch.label})`, `Payment QR change #${id}`);
    return { status: 'Applied', ...(await apply(conn, req, ch, req.user.user_id)) };
  });
}

/** POST /payment-qr/changes/:id/reject { note } (another Admin) or /cancel (the requester). The stored image is kept. */
async function reject(req, id, body, { cancel = false } = {}) {
  return withTransaction(async (conn) => {
    const ch = await lockPending(conn, id);
    if (cancel && ch.requested_by !== req.user.user_id) throw new HttpError(403, 'Only the Admin who requested a change can cancel it.');
    const note = text(body?.note, 500);
    if (!cancel && !note) throw new HttpError(422, 'Give the reason for rejecting.', { errors: { note: 'Give the reason.' } });
    await conn.query('UPDATE tbl_payment_qr_changes SET status = ?, decided_by = ?, decided_at = NOW(), decision_note = ? WHERE change_id = ?',
      [cancel ? 'Cancelled' : 'Rejected', req.user.user_id, note, id]);
    await logActivityWith(conn, req, `PAYMENT_QR_CHANGE_${cancel ? 'CANCELLED' : 'REJECTED'} (${ch.label})`, `Payment QR change #${id}`);
    await Notify.toAdmins(conn, 'admin_qr_change', { params: { label: ch.label, step: cancel ? 'cancelled' : 'rejected' }, groupKey: `qr_change:${id}:closed` });
    return { status: cancel ? 'Cancelled' : 'Rejected' };
  });
}

/** PUT /payment-qr/methods/:id { enabled?, sort_order? } - not the account details or instructions (those need a change request). */
async function updateSettings(req, id, body) {
  const b = body || {};
  const fields = {};
  if (b.enabled !== undefined) fields.enabled = b.enabled === true ? 1 : 0;
  if (b.sort_order !== undefined) {
    const n = Number(b.sort_order);
    if (!Number.isInteger(n) || n < 0 || n > 999) throw new HttpError(422, 'Display order: a whole number from 0 to 999.', { errors: { sort_order: '0 to 999.' } });
    fields.sort_order = n;
  }
  // Instructions are shown next to the QR, so they change only through a change request (re-authentication, reason, approval).
  if (b.instructions !== undefined) throw new HttpError(400, 'Change the instructions with "Change QR or details" (it needs a reason and re-authentication).');
  if (!Object.keys(fields).length) throw new HttpError(400, 'Nothing to change.');
  return withTransaction(async (conn) => {
    const [[m]] = await conn.query('SELECT method_id, name, current_version_id FROM tbl_payment_methods WHERE method_id = ? FOR UPDATE', [id]);
    if (!m) throw new HttpError(404, 'Payment method not found.');
    if (fields.enabled === 1 && !m.current_version_id) throw new HttpError(409, 'Upload the QR first (a method without a QR is never shown to donors).');
    await conn.query(`UPDATE tbl_payment_methods SET ${Object.keys(fields).map((k) => `${k} = ?`).join(', ')}, updated_by = ? WHERE method_id = ?`, [...Object.values(fields), req.user.user_id, id]);
    await logActivityWith(conn, req, `UPDATE_PAYMENT_METHOD (${m.name}: ${Object.keys(fields).join(', ')}${fields.enabled !== undefined ? (fields.enabled ? ', enabled' : ', disabled') : ''})`, `Payment method #${id}`);
    if (fields.enabled !== undefined) await Notify.toAdmins(conn, 'admin_qr_change', { params: { label: m.name, step: fields.enabled ? 'applied (method enabled)' : 'applied (method disabled)' }, groupKey: `qr_enabled:${id}:${Date.now()}` });
    return { ok: true };
  });
}

/** POST /payment-qr/methods/:id/confirm - "I checked this QR against the home's account": last confirmed by [Admin] on [date]. */
async function confirm(req, id) {
  const [r] = await pool.query('UPDATE tbl_payment_methods SET last_confirmed_by = ?, last_confirmed_at = NOW() WHERE method_id = ? AND current_version_id IS NOT NULL', [req.user.user_id, id]);
  if (!r.affectedRows) throw new HttpError(404, 'Payment method not found, or it has no QR yet.');
  await logActivity(req, 'PAYMENT_QR_CONFIRMED', `Payment method #${id}`);
}

const imageLink = (req, versionId) => (versionId ? links.url(links.sign({ kind: 'qr', id: versionId, userId: req.user.user_id })) : null);

/** Admin list: every method, its current version, waiting changes and open donor reports. */
async function adminList(req) {
  const [methods] = await pool.query(
    `SELECT m.method_id, m.code, m.name AS label, m.method_group, m.enabled, m.sort_order, m.instructions, m.current_version_id, m.qr_updated_at, m.last_confirmed_at,
            lc.full_name AS last_confirmed_by_name, v.version_no, v.account_name, v.account_number, v.bank_name, v.qr_format, v.qr_decoded_name, v.created_at AS version_at,
            (SELECT COUNT(*) FROM tbl_qr_problem_reports p WHERE p.method_id = m.method_id AND p.status = 'Open') AS open_problems
       FROM tbl_payment_methods m LEFT JOIN tbl_payment_qr_versions v ON v.version_id = m.current_version_id LEFT JOIN tbl_users lc ON lc.user_id = m.last_confirmed_by
      ORDER BY m.sort_order, m.method_id`);
  const [pending] = await pool.query(`SELECT ${CHANGE_COLS} ${CHANGE_FROM} WHERE c.status = 'Pending' ORDER BY c.requested_at`);
  const [problems] = await pool.query(
    `SELECT p.report_id, p.method_id, m.name AS label, p.problem, p.note, p.created_at, p.status FROM tbl_qr_problem_reports p JOIN tbl_payment_methods m ON m.method_id = p.method_id
      WHERE p.status = 'Open' ORDER BY p.created_at DESC LIMIT 100`);
  const L = await limits();
  return {
    methods: methods.map((m) => ({ ...m, enabled: !!m.enabled, open_problems: Number(m.open_problems), qr_url: imageLink(req, m.current_version_id) })),
    pending: pending.map((c) => ({ ...c, needs_second: !!c.needs_second, name_mismatch: !!c.name_mismatch, mine: c.requested_by === req.user.user_id,
      qr_url: links.url(links.sign({ kind: 'qr_change', id: c.change_id, userId: req.user.user_id })) })),
    problems: problems.map((p) => ({ ...p, problem_label: QR_PROBLEMS[p.problem] || p.problem })),
    second_admin_required: L.payment_qr_second_admin === 1 && (await activeAdmins(pool)) >= 2,
    controls: Object.entries(require('../config/donationClaims').SETTINGS).map(([key, c]) => ({ key, label: c.label, min: c.min, max: c.max, value: L[key], toggle: c.min === 0 && c.max === 1 })),
  };
}

/** Version history of one method (images of old versions are kept and viewable by Admin). */
async function versions(req, methodId) {
  const [rows] = await pool.query(
    `SELECT v.version_id, v.version_no, v.label, v.method_group, v.account_name, v.account_number, v.bank_name, v.qr_format, v.qr_decoded_name, v.reason, v.created_at,
            cu.full_name AS created_by_name, au.full_name AS approved_by_name
       FROM tbl_payment_qr_versions v JOIN tbl_users cu ON cu.user_id = v.created_by LEFT JOIN tbl_users au ON au.user_id = v.approved_by
      WHERE v.method_id = ? ORDER BY v.version_no DESC`, [methodId]);
  const [changes] = await pool.query(`SELECT ${CHANGE_COLS} ${CHANGE_FROM} WHERE c.method_id = ? ORDER BY c.requested_at DESC LIMIT 50`, [methodId]);
  return { versions: rows.map((v) => ({ ...v, qr_url: imageLink(req, v.version_id) })), changes: changes.map((c) => ({ ...c, qr_decoded_text: undefined })) };
}

/** What donors see on the Donate page: enabled methods with a current QR only. */
async function donorMethods(req, conn = pool) {
  const [rows] = await conn.query(
    `SELECT m.method_id, m.code, m.name AS label, m.method_group, v.instructions, v.version_id, v.account_name, v.account_number, v.bank_name, v.created_at AS updated_on
       FROM tbl_payment_methods m JOIN tbl_payment_qr_versions v ON v.version_id = m.current_version_id
      WHERE m.enabled = TRUE ORDER BY m.sort_order, m.method_id`);
  return rows.map((m) => ({ ...m, qr_url: imageLink(req, m.version_id) }));
}

/** Image bytes for a signed link. Donors and Staff: the current version of an enabled method only. Admin: any version or pending change. */
async function imageFor(req, versionId) {
  const [[v]] = await pool.query(
    `SELECT v.version_id, v.qr_storage_key, (m.current_version_id = v.version_id AND m.enabled = TRUE) AS live FROM tbl_payment_qr_versions v
       JOIN tbl_payment_methods m ON m.method_id = v.method_id WHERE v.version_id = ?`, [versionId]);
  if (!v || (req.user.role !== 'Admin' && !v.live)) throw new HttpError(404, 'This link has expired. Open the file again from its page.');
  return { body: readUpload(v.qr_storage_key), mime: 'image/png', name: `payment-qr-${versionId}.png` };
}

/** Admin: the image of a change still waiting for approval (shown with its decoded text). */
async function changeImage(req, changeId) {
  if (req.user.role !== 'Admin') throw new HttpError(404, 'Not found.');
  const [[c]] = await pool.query('SELECT qr_storage_key FROM tbl_payment_qr_changes WHERE change_id = ?', [changeId]);
  if (!c) throw new HttpError(404, 'Not found.');
  return { body: readUpload(c.qr_storage_key), mime: 'image/png', name: `payment-qr-change-${changeId}.png` };
}

/** POST /donor/qr-problems { method_id, problem, note? } - alerts every Admin. */
async function reportProblem(req, body) {
  const methodId = Number(body?.method_id);
  const problem = String(body?.problem || '');
  if (!QR_PROBLEMS[problem]) throw new HttpError(422, 'Choose what is wrong.', { errors: { problem: 'Choose what is wrong.' } });
  const note = text(body?.note, 500);
  return withTransaction(async (conn) => {
    const [[m]] = await conn.query('SELECT method_id, name, current_version_id FROM tbl_payment_methods WHERE method_id = ? AND enabled = TRUE AND current_version_id IS NOT NULL', [methodId]);
    if (!m) throw new HttpError(404, 'Payment method not found.');
    const [[recent]] = await conn.query("SELECT COUNT(*) AS n FROM tbl_qr_problem_reports WHERE reported_by = ? AND created_at > NOW() - INTERVAL 1 DAY", [req.user.user_id]);
    if (Number(recent.n) >= 5) throw new HttpError(429, 'Thank you. You already sent several reports today; the home has been alerted.');
    const [r] = await conn.query('INSERT INTO tbl_qr_problem_reports (method_id, version_id, reported_by, problem, note) VALUES (?, ?, ?, ?, ?)',
      [m.method_id, m.current_version_id, req.user.user_id, problem, note]);
    await logActivityWith(conn, req, `PAYMENT_QR_PROBLEM_REPORTED (${m.name}, ${problem})`, `Payment method #${m.method_id}`);
    await Notify.toAdmins(conn, 'admin_qr_problem', { params: { label: m.name }, groupKey: `qr_problem:${r.insertId}` });
    return { report_id: r.insertId };
  });
}

async function resolveProblem(req, id, body) {
  const note = text(body?.note, 500);
  if (!note) throw new HttpError(422, 'Describe what you checked or changed.', { errors: { note: 'Required.' } });
  const [r] = await pool.query("UPDATE tbl_qr_problem_reports SET status = 'Resolved', resolved_by = ?, resolved_at = NOW(), resolution_note = ? WHERE report_id = ? AND status = 'Open'", [req.user.user_id, note, id]);
  if (!r.affectedRows) throw new HttpError(404, 'Open report not found.');
  await logActivity(req, 'PAYMENT_QR_PROBLEM_RESOLVED', `QR problem report #${id}`);
}

/** The printable "Donation QR sheet" for the front desk (Admin): current QR of each enabled method with its version date. */
async function sheet(req) {
  const methods = await donorMethods(req);
  const [[org]] = await pool.query("SELECT setting_value AS v FROM tbl_settings WHERE setting_key = 'org_name'");
  await logActivity(req, 'PRINT_DONATION_QR_SHEET', 'Payment QR');
  return { org_name: org?.v || 'CareSphere', printed_at: new Date().toISOString(), methods };
}

module.exports = { preview, requestChange, approve, reject, updateSettings, confirm, adminList, versions, donorMethods, imageFor, changeImage, reportProblem, resolveProblem, sheet, imageLink, cleanDetails };
