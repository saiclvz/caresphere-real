const bcrypt = require('bcryptjs');
const env = require('../config/env');
const User = require('../models/userModel');
const HttpError = require('../utils/HttpError');
const { requireFields, isEmail, oneOf, toBool } = require('../utils/validate');
const { logActivity, logActivityWith, logChange, diff } = require('../utils/audit');
const { withTransaction } = require('../config/db');
const Notify = require('../services/notifications');
const { DUTIES, DUTY_KEYS, DEFAULT_DUTIES } = require('../config/staffDuties');

/** A list of duty keys from the request, checked against config/staffDuties.js. */
function cleanDuties(raw) {
  const list = Array.isArray(raw) ? [...new Set(raw.map(String))] : [];
  const bad = list.filter((d) => !DUTY_KEYS.includes(d));
  if (bad.length) throw new HttpError(400, `Unknown duties: ${bad.join(', ')}.`);
  return list;
}

/**
 * Activating or deactivating an account, its audit entry and notifications in one transaction:
 * other Admins (info), the donor themself, and, for a Staff account, Admins are told how many
 * records lost their active assigned staff member.
 */
async function changeActive(req, user, active) {
  await withTransaction(async (conn) => {
    await User.setActive(user.user_id, active, conn);
    // Deactivation ends every session, unlock session and protected-record grant of the account at once.
    if (!active) await conn.query('UPDATE tbl_users SET tokens_valid_after = NOW() WHERE user_id = ?', [user.user_id]);
    await logActivityWith(conn, req, active ? 'REACTIVATE_USER' : 'DEACTIVATE_USER', `User #${user.user_id} (${user.email})`);
    await Notify.toAdmins(conn, 'admin_account_changed', { params: { role: user.role, change: active ? 'reactivated' : 'deactivated', id: user.user_id }, exceptUserId: req.user.user_id });
    if (user.role === 'Donor') await Notify.emit(conn, active ? 'account_reactivated' : 'account_deactivated', { userId: user.user_id });
    // A deactivated Staff account: its unlock sessions end and its records are marked "needs reassignment"
    // (one assignment service; Admins get one alert with the count).
    if (user.role === 'Staff' && !active) await require('../services/assignment').staffLostAccess(conn, req, user.user_id, { reason: 'account_deactivated' });
  });
}
const { problem: passwordProblem } = require('../utils/passwordPolicy');
const mfa = require('../services/mfaService');

const ROLES = ['Admin', 'Staff', 'Donor'];
const TEMP_PASSWORD_HOURS = 72;

/** Validates a role. "Applicant" was merged into Donor and is rejected with a clear message. */
function cleanRole(value) {
  if (String(value ?? '').trim().toLowerCase() === 'applicant') {
    throw new HttpError(400, 'The Applicant role no longer exists. Adoption features are part of the Donor role, so use "Donor".');
  }
  return oneOf(value, ROLES, 'role');
}

exports.list = async (req, res) => {
  const role = req.query.role ? cleanRole(req.query.role) : undefined;
  let rows = await User.list({ role });
  const q = String(req.query.q || '').trim().toLowerCase();
  if (q) rows = rows.filter((u) => [u.full_name, u.email, u.role].some((v) => String(v).toLowerCase().includes(q)));
  res.json({ success: true, data: rows });
};

exports.create = async (req, res) => {
  requireFields(req.body, ['full_name', 'email', 'password', 'role']);
  const email = String(req.body.email).trim().toLowerCase();
  const fullName = String(req.body.full_name).trim();
  if (!isEmail(email) || email.length > 100) throw new HttpError(400, 'Enter a valid email address.');
  if (fullName.length < 2 || fullName.length > 100) throw new HttpError(400, 'Full name must be 2-100 characters.');
  const weak = passwordProblem(String(req.body.password), { email, name: fullName });
  if (weak) throw new HttpError(400, weak);
  if (!req.body.confirm_password) throw new HttpError(400, 'Confirm password is required.');
  if (String(req.body.confirm_password) !== String(req.body.password)) throw new HttpError(400, 'Passwords do not match.');
  const role = cleanRole(req.body.role);
  if (await User.findByEmailWithHash(email)) throw new HttpError(409, 'An account with this email already exists.');

  const hash = await bcrypt.hash(String(req.body.password), env.bcryptRounds);
  const roleId = await User.roleId(role);
  const id = await withTransaction(async (conn) => {
    const newId = await User.create({ full_name: fullName, email, password_hash: hash, role_id: roleId }, conn);
    // The password an Admin types is temporary: one sign-in, then the user must choose their own (within 72 hours).
    await conn.query('UPDATE tbl_users SET must_change_password = TRUE, temp_password_expires_at = NOW() + INTERVAL ? HOUR WHERE user_id = ?', [TEMP_PASSWORD_HOURS, newId]);
    await logActivityWith(conn, req, `CREATE_USER (${role}, temporary password)`, `User #${newId}`);
    // A new Staff account gets the duties chosen in the form (every duty if none were sent).
    if (role === 'Staff') {
      const duties = req.body.duties === undefined ? DEFAULT_DUTIES : cleanDuties(req.body.duties);
      await User.setDuties(conn, newId, duties, req.user.user_id);
      await logActivityWith(conn, req, `UPDATE_DUTIES (none -> ${duties.join(', ') || 'none'})`, `User #${newId}`);
    }
    await Notify.toAdmins(conn, 'admin_account_changed', { params: { role, change: 'created', id: newId }, exceptUserId: req.user.user_id });
    return newId;
  });
  res.status(201).json({ success: true, data: await User.findById(id) });
};

/** Rules for turning an account off. Throws 409 with a clear message. */
async function assertCanDeactivate(req, user) {
  if (user.user_id === req.user.user_id) throw new HttpError(409, 'You cannot deactivate your own account.');
  if (user.role === 'Admin' && user.is_active && (await User.countActiveAdmins()) <= 1) {
    throw new HttpError(409, 'This is the last active administrator. Activate or create another administrator first.');
  }
}

exports.update = async (req, res) => {
  const id = Number(req.params.id);
  const user = await User.findById(id);
  if (!user) throw new HttpError(404, 'User not found.');

  const fields = {};
  if (req.body.full_name !== undefined) {
    const v = String(req.body.full_name).trim();
    if (v.length < 2 || v.length > 100) throw new HttpError(400, 'Full name must be 2-100 characters.');
    fields.full_name = v;
  }
  if (req.body.email !== undefined) {
    const v = String(req.body.email).trim().toLowerCase();
    if (!isEmail(v)) throw new HttpError(400, 'Enter a valid email address.');
    fields.email = v;
  }
  const demoting = req.body.role !== undefined && req.body.role !== 'Admin' && user.role === 'Admin';
  if (demoting && id === req.user.user_id) throw new HttpError(409, 'You cannot remove your own administrator access.');
  if (demoting && user.is_active && (await User.countActiveAdmins()) <= 1) {
    throw new HttpError(409, 'At least one active administrator must remain.');
  }
  if (req.body.role !== undefined) fields.role_id = await User.roleId(cleanRole(req.body.role));
  // Active status changes go through the same rules as the Deactivate/Reactivate action.
  const nextActive = req.body.is_active !== undefined ? toBool(req.body.is_active) : !!user.is_active;
  const activeChanged = nextActive !== !!user.is_active;
  if (activeChanged && !nextActive) await assertCanDeactivate(req, user);
  if (req.body.password) {
    const weak = passwordProblem(String(req.body.password), { email: fields.email || user.email, name: fields.full_name || user.full_name });
    if (weak) throw new HttpError(400, weak);
    if (!req.body.confirm_password) throw new HttpError(400, 'Confirm new password is required.');
    if (String(req.body.confirm_password) !== String(req.body.password)) throw new HttpError(400, 'Passwords do not match.');
    fields.password_hash = await bcrypt.hash(String(req.body.password), env.bcryptRounds);
  }
  // Two-step verification is only for Admins: changing an Admin to another role clears it.
  const leavingAdmin = req.body.role !== undefined && cleanRole(req.body.role) !== 'Admin' && user.role === 'Admin';

  if (Object.keys(fields).length) {
    await User.update(id, fields);
    // A password set by an Admin is temporary; a role change or a new password ends every session of that account
    // (the user signs in again with the new rights).
    if (fields.password_hash) await require('../config/db').pool.query('UPDATE tbl_users SET must_change_password = TRUE, temp_password_expires_at = NOW() + INTERVAL ? HOUR WHERE user_id = ?', [TEMP_PASSWORD_HOURS, id]);
    if (fields.password_hash || fields.role_id !== undefined) {
      await require('../config/db').pool.query('UPDATE tbl_users SET tokens_valid_after = NOW() WHERE user_id = ?', [id]);
      await require('../services/unlockService').endForUser(id).catch(() => {});
      await require('../services/protectedRecords').revokeGrantsForUser(id).catch(() => {});
    }
    // Becoming Staff starts with every duty (Admin can narrow them); leaving Staff clears them.
    if (fields.role_id !== undefined) {
      const newRole = cleanRole(req.body.role);
      if (newRole === 'Staff' && user.role !== 'Staff') await withTransaction((conn) => User.setDuties(conn, id, DEFAULT_DUTIES, req.user.user_id));
      if (newRole !== 'Staff' && user.role === 'Staff') {
        await withTransaction(async (conn) => {
          await User.setDuties(conn, id, [], req.user.user_id);
          await require('../services/assignment').staffLostAccess(conn, req, id, { reason: 'duty_removed' });
        });
      }
    }
    if (leavingAdmin) {
      await mfa.reset(id);
      await logActivity(req, 'MFA_CLEARED (no longer an administrator)', `User #${id}`);
    }
    // Changed fields with previous and new values; the password is only "changed".
    const after = { ...fields };
    if (after.role_id !== undefined) { after.role = cleanRole(req.body.role); delete after.role_id; }
    const changes = diff({ ...user, password_hash: 'x' }, after, { sensitive: ['password_hash'], labels: { full_name: 'Name', email: 'Email', role: 'Role', password_hash: 'Password' } });
    await logChange(null, req, `UPDATE_USER (${Object.keys(fields).filter((k) => k !== 'password_hash').join(', ') || 'password'})`, `User #${id}`, { changes });
  }
  if (activeChanged) await changeActive(req, user, nextActive);
  res.json({ success: true, data: await User.findById(id) });
};

/**
 * PUT /api/users/:id/active { is_active } (Admin) - Deactivate or Reactivate.
 * Deactivated users can't sign in and their sessions end. Their data and history stay.
 */
exports.setActive = async (req, res) => {
  const id = Number(req.params.id);
  const user = await User.findById(id);
  if (!user) throw new HttpError(404, 'User not found.');
  if (req.body?.is_active === undefined) throw new HttpError(400, 'is_active is required.');
  const active = toBool(req.body.is_active);
  if (active === !!user.is_active) {
    return res.json({ success: true, data: user, message: `${user.full_name} is already ${active ? 'active' : 'deactivated'}.` });
  }
  if (!active) await assertCanDeactivate(req, user);
  await changeActive(req, user, active);
  res.json({
    success: true, data: await User.findById(id),
    message: active ? `${user.full_name} can sign in again.` : `${user.full_name} was deactivated and signed out.`,
  });
};

/**
 * POST /api/users/:id/mfa/reset { code } (Admin) - lost device.
 * The acting admin confirms with their own current code (or a backup code),
 * and cannot reset their own MFA. The target sets MFA up again at next sign-in.
 */
exports.resetMfa = async (req, res) => {
  const id = Number(req.params.id);
  if (id === req.user.user_id) throw new HttpError(409, 'You cannot reset your own two-step verification. Ask another administrator.');
  const target = await User.findById(id);
  if (!target) throw new HttpError(404, 'User not found.');
  // Two-step verification is required only for Admins, so only Admin accounts can be reset.
  if (target.role !== 'Admin') throw new HttpError(409, 'Two-step verification applies only to administrator accounts.');
  if (!target.mfa_enabled) throw new HttpError(409, 'This account has no two-step verification set up.');

  const used = await mfa.verifyStepUp(req.user.user_id, req.body?.code);
  if (!used) {
    await logActivity(req, 'MFA_FAILED (reset confirmation)', `User #${id}`);
    // 400, not 401: a wrong confirmation code must not sign the acting admin out.
    throw new HttpError(400, 'Your code is incorrect or was already used. Enter the current code from your authenticator app.');
  }
  await mfa.reset(id);
  await logActivity(req, 'MFA_RESET', `User #${id}`);
  res.json({ success: true, message: `Two-step verification was reset for ${target.full_name}. They will set it up again at their next sign-in.` });
};

/**
 * PUT /api/users/:id/duties (Admin) { duties: [...] } - the areas this Staff account may use.
 * Logged with the old and new duties; the staff member is notified. Admin always has every area.
 */
exports.setDuties = async (req, res) => {
  const id = Number(req.params.id);
  const user = await User.findById(id);
  if (!user) throw new HttpError(404, 'User not found.');
  if (user.role !== 'Staff') throw new HttpError(400, 'Duties are only for Staff accounts. Admin has every area.');
  const duties = cleanDuties(req.body?.duties);
  const before = user.duties || [];
  await withTransaction(async (conn) => {
    await User.setDuties(conn, id, duties, req.user.user_id);
    // Duties are read fresh on every request; any removed duty also ends open unlock sessions at once.
    if (before.some((d) => !duties.includes(d))) await require('../services/unlockService').endForUser(id).catch(() => {});
    await logChange(conn, req, `UPDATE_DUTIES (${before.join(', ') || 'none'} -> ${duties.join(', ') || 'none'})`, `User #${id}`,
      { changes: [{ field: 'Duties', old: before.join(', ') || 'none', new: duties.join(', ') || 'none', sensitive: false }] });
    await Notify.emit(conn, 'duties_changed', { userId: id, params: { duties: duties.map((d) => DUTIES[d].label).join(', ') || 'none' } });
    // Losing a records duty: open unlock sessions end and the affected records are marked "needs reassignment".
    const lost = before.filter((d) => !duties.includes(d) && ['children', 'health', 'adoption', 'transition'].includes(d));
    if (lost.length) await require('../services/assignment').staffLostAccess(conn, req, id, { reason: 'duty_removed', duties: lost });
  });
  res.json({ success: true, data: await User.findById(id) });
};

/** GET /api/users/duties (Admin) - the duties for the account form. */
exports.dutyOptions = async (req, res) => {
  res.json({ success: true, data: Object.entries(DUTIES).map(([key, d]) => ({ key, ...d })) });
};
