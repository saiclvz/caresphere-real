const bcrypt = require('bcryptjs');
const env = require('../config/env');
const User = require('../models/userModel');
const HttpError = require('../utils/HttpError');
const { requireFields, isEmail, oneOf, toBool } = require('../utils/validate');
const { logActivity } = require('../utils/audit');
const mfa = require('../services/mfaService');

const ROLES = ['Admin', 'Staff', 'Donor'];

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
  if (String(req.body.password).length < 8) throw new HttpError(400, 'Password must be at least 8 characters.');
  const role = cleanRole(req.body.role);
  if (await User.findByEmailWithHash(email)) throw new HttpError(409, 'An account with this email already exists.');

  const id = await User.create({
    full_name: fullName,
    email,
    password_hash: await bcrypt.hash(String(req.body.password), env.bcryptRounds),
    role_id: await User.roleId(role),
  });
  await logActivity(req, `CREATE_USER (${role})`, `User #${id}`);
  res.status(201).json({ success: true, data: await User.findById(id) });
};

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
  const deactivating = req.body.is_active !== undefined && !toBool(req.body.is_active) && user.role === 'Admin';
  if ((demoting || deactivating) && (await User.countActiveAdmins()) <= 1) {
    throw new HttpError(409, 'At least one active administrator must remain.');
  }
  if (id === req.user.user_id && (demoting || deactivating)) {
    throw new HttpError(409, 'You cannot remove your own administrator access.');
  }
  if (req.body.role !== undefined) fields.role_id = await User.roleId(cleanRole(req.body.role));
  if (req.body.is_active !== undefined) fields.is_active = toBool(req.body.is_active);
  if (req.body.password) {
    if (String(req.body.password).length < 8) throw new HttpError(400, 'Password must be at least 8 characters.');
    fields.password_hash = await bcrypt.hash(String(req.body.password), env.bcryptRounds);
  }

  await User.update(id, fields);
  await logActivity(req, `UPDATE_USER (${Object.keys(fields).filter((k) => k !== 'password_hash').join(', ') || 'password'})`, `User #${id}`);
  res.json({ success: true, data: await User.findById(id) });
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

exports.remove = async (req, res) => {
  const id = Number(req.params.id);
  if (id === req.user.user_id) throw new HttpError(409, 'You cannot delete your own account.');
  const user = await User.findById(id);
  if (!user) throw new HttpError(404, 'User not found.');
  if (user.role === 'Admin' && (await User.countActiveAdmins()) <= 1) {
    throw new HttpError(409, 'At least one active administrator must remain.');
  }
  await User.remove(id); // FK errors -> 409 "deactivate instead" via error middleware
  await logActivity(req, 'DELETE_USER', `User #${id}`);
  res.json({ success: true, message: 'User deleted.' });
};
