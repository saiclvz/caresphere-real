const bcrypt = require('bcryptjs');
const env = require('../config/env');
const { withTransaction } = require('../config/db');
const Child = require('../models/childModel');
const User = require('../models/userModel');
const qr = require('../services/qrService');
const access = require('../services/healthAccessService');
const HttpError = require('../utils/HttpError');
const { sha256, randomCode } = require('../utils/crypto');
const { saveUpload, readUpload, deleteUpload, mimeFromKey, MB } = require('../utils/files');
const {
  requireFields, oneOf, requireDate, trimOrNull, toBool, localToday, ageOn, requireText,
} = require('../utils/validate');
const { logActivity } = require('../utils/audit');

const GENDERS = ['Male', 'Female'];
const STATUSES = ['Active', 'Discharged', 'Adopted'];
const PHOTO_OPTS = { folder: 'child-photos', allowed: ['jpg', 'png'], maxBytes: 5 * MB, label: 'Profile photo' };
const OVER_AGE = 'Registration denied. The child exceeds the maximum age requirement.';

// Re-check 18+ flags at most every 10 minutes (and at start-up / daily from server.js).
let lastSync = 0;
async function syncFlags(force = false) {
  if (!force && Date.now() - lastSync < 10 * 60 * 1000) return;
  lastSync = Date.now();
  await Child.syncTransitionFlags();
}
exports.syncFlags = syncFlags;

function cleanDob(value) {
  const dob = requireDate(value, 'Date of birth');
  if (dob > localToday()) throw new HttpError(400, 'Date of birth cannot be in the future.');
  return dob;
}

function cleanAdmission(value, dob) {
  if (!value) return null;
  const d = requireDate(value, 'Admission date');
  if (d > localToday()) throw new HttpError(400, 'Admission date cannot be in the future.');
  if (dob && d < dob) throw new HttpError(400, 'Admission date cannot be before the date of birth.');
  return d;
}

function cleanName(value, label) {
  const s = requireText(value, `${label} is required.`, 50);
  return s;
}

function cleanDischarge(body) {
  const discharge_reason = requireText(body.discharge_reason, 'Discharge reason is required.', 3000);
  const report_of_what_happened = requireText(body.report_of_what_happened, 'Report of what happened is required.', 10000);
  if (!body.discharge_date || !String(body.discharge_date).trim()) throw new HttpError(400, 'Discharge date is required.');
  const discharge_date = requireDate(String(body.discharge_date).trim(), 'Discharge date');
  if (discharge_date > localToday()) throw new HttpError(400, 'Discharge date cannot be in the future.');
  return { discharge_reason, report_of_what_happened, discharge_date };
}

/** GET /api/children/rules */
exports.rules = async (req, res) => {
  res.json({ success: true, data: { max_admission_age: env.maxAdmissionAge, transition_age: env.transitionAge,
    health_access_seconds: env.healthAccessTtlSeconds, typed_token_seconds: env.qrTtlSeconds } });
};

/** GET /api/children?status=&q=&flagged=1  (youngest first) */
exports.list = async (req, res) => {
  await syncFlags();
  const status = req.query.status ? oneOf(req.query.status, STATUSES, 'status') : undefined;
  const rows = await Child.list({ status, search: req.query.q, flagged: toBool(req.query.flagged) });
  res.json({ success: true, data: rows });
};

/** GET /api/children/:id - profile only. Health and case files need health access. */
exports.getOne = async (req, res) => {
  const child = await Child.findById(req.params.id);
  if (!child) throw new HttpError(404, 'Child record not found.');
  delete child.profile_photo_path;
  const [discharges, adoptions] = await Promise.all([Child.dischargeHistory(child.child_id), Child.adoptionHistory(child.child_id)]);
  res.json({ success: true, data: { ...child, discharge_history: discharges, adoption_status_history: adoptions } });
};

/** POST /api/children (Admin) - new registrations enforce the maximum admission age. */
exports.create = async (req, res) => {
  requireFields(req.body, ['first_name', 'last_name', 'gender', 'dob', 'admission_date']);
  const dob = cleanDob(req.body.dob);
  if (ageOn(dob) > env.maxAdmissionAge) throw new HttpError(422, OVER_AGE);

  const data = {
    first_name: cleanName(req.body.first_name, 'First name'),
    last_name: cleanName(req.body.last_name, 'Last name'),
    gender: oneOf(req.body.gender, GENDERS, 'gender'),
    dob,
    admission_date: cleanAdmission(req.body.admission_date, dob),
    urgent_needs: trimOrNull(req.body.urgent_needs, 2000),
    public_bio: trimOrNull(req.body.public_bio, 2000),
    // Only an Admin may publish a profile to the Donor portal. Staff-registered
    // children always start hidden (RA 10173); an Admin can publish them later.
    is_public: req.user.role === 'Admin' ? toBool(req.body.is_public) : false,
    background_care_info: trimOrNull(req.body.background_care_info, 10000),
    guardian_family_info: trimOrNull(req.body.guardian_family_info, 10000),
    qr_token: sha256(randomCode(16)),
  };

  const photo = req.body.photo ? saveUpload(req.body.photo, PHOTO_OPTS) : null;
  data.profile_photo_path = photo?.storage_key || null;

  let childId;
  try {
    childId = await withTransaction(async (conn) => {
      const id = await Child.nextChildId(conn);
      await Child.insert(conn, { ...data, child_id: id });
      const health = req.body.health || {};
      if (Child.PHI_FIELDS.some((f) => trimOrNull(health[f]))) {
        const clean = Object.fromEntries(Child.PHI_FIELDS.map((f) => [f, trimOrNull(health[f], 5000)]));
        await Child.upsertHealth(id, clean, req.user.user_id, conn);
      }
      return id;
    });
  } catch (err) {
    if (photo) deleteUpload(photo.storage_key);
    throw err;
  }
  await logActivity(req, 'REGISTER_CHILD', `Child ${childId}`);
  res.status(201).json({ success: true, data: await Child.findById(childId) });
};

/**
 * PUT /api/children/:id  (Admin, Staff)
 * Status rules:
 *  - Active -> Discharged requires full discharge documentation (both roles).
 *  - Adopted is set only when an adoption is marked Completed.
 *  - Leaving Discharged or Adopted is an Admin-only override.
 *  - Staff edits never change status unless status is sent explicitly.
 */
exports.update = async (req, res) => {
  const child = await Child.findById(req.params.id);
  if (!child) throw new HttpError(404, 'Child record not found.');
  const isAdmin = req.user.role === 'Admin';
  const b = req.body;
  const fields = {};

  if (b.first_name !== undefined) fields.first_name = cleanName(b.first_name, 'First name');
  if (b.last_name !== undefined) fields.last_name = cleanName(b.last_name, 'Last name');
  if (b.gender !== undefined) fields.gender = oneOf(b.gender, GENDERS, 'gender');
  // Editing an existing child's DOB never re-applies the admission age limit.
  if (b.dob !== undefined) fields.dob = cleanDob(b.dob);
  if (b.admission_date !== undefined) fields.admission_date = cleanAdmission(b.admission_date, fields.dob || child.dob);
  if (b.urgent_needs !== undefined) fields.urgent_needs = trimOrNull(b.urgent_needs, 2000);
  if (b.public_bio !== undefined) fields.public_bio = trimOrNull(b.public_bio, 2000);
  if (b.is_public !== undefined) {
    if (!isAdmin) throw new HttpError(403, 'Only an administrator can change whether a child appears on the public portal.');
    fields.is_public = toBool(b.is_public) ? 1 : 0;
  }

  const nextStatus = b.status !== undefined ? oneOf(b.status, STATUSES, 'status') : child.status;
  let discharge = null;
  if (nextStatus !== child.status) {
    if (nextStatus === 'Adopted') {
      throw new HttpError(409, "A child's status becomes Adopted only when an adoption application is marked Completed.");
    }
    if (child.status !== 'Active' && !isAdmin) {
      throw new HttpError(403, `Only an administrator can change the status of a ${child.status.toLowerCase()} child.`);
    }
    if (nextStatus === 'Discharged') discharge = cleanDischarge(b);
    fields.status = nextStatus;
  }

  await withTransaction(async (conn) => {
    await Child.update(child.child_id, fields, conn);
    if (discharge) {
      await Child.insertDischarge(conn, { ...discharge, child_id: child.child_id, reported_by: req.user.user_id, previous_status: child.status });
    }
  });

  if (discharge) await logActivity(req, 'DISCHARGE_CHILD', `Child ${child.child_id}`);
  else if (fields.status) await logActivity(req, `STATUS_${child.status.toUpperCase()}_TO_${fields.status.toUpperCase()}`, `Child ${child.child_id}`);
  if (Object.keys(fields).some((k) => k !== 'status')) await logActivity(req, 'UPDATE_CHILD', `Child ${child.child_id}`);
  if (fields.dob) await syncFlags(true);
  res.json({ success: true, data: await Child.findById(child.child_id) });
};

/** DELETE /api/children/:id (Admin) */
exports.remove = async (req, res) => {
  const child = await Child.photoPath(req.params.id);
  if (!child) throw new HttpError(404, 'Child record not found.');
  if (await Child.hasProtectedHistory(req.params.id)) {
    throw new HttpError(409, 'This child has discharge or adoption records that must be kept. Change the status instead of deleting.');
  }
  await Child.remove(req.params.id);
  deleteUpload(child.profile_photo_path);
  await logActivity(req, 'DELETE_CHILD', `Child ${req.params.id}`);
  res.json({ success: true, message: 'Child record deleted.' });
};

// ---------------------------------------------------------------- photos
exports.uploadPhoto = async (req, res) => {
  const child = await Child.photoPath(req.params.id);
  if (!child) throw new HttpError(404, 'Child record not found.');
  const saved = saveUpload(req.body.photo, PHOTO_OPTS);
  await Child.update(req.params.id, { profile_photo_path: saved.storage_key });
  deleteUpload(child.profile_photo_path);
  await logActivity(req, 'UPDATE_CHILD_PHOTO', `Child ${req.params.id}`);
  res.json({ success: true, data: await Child.findById(req.params.id) });
};

exports.removePhoto = async (req, res) => {
  const child = await Child.photoPath(req.params.id);
  if (!child) throw new HttpError(404, 'Child record not found.');
  await Child.update(req.params.id, { profile_photo_path: null });
  deleteUpload(child.profile_photo_path);
  await logActivity(req, 'REMOVE_CHILD_PHOTO', `Child ${req.params.id}`);
  res.json({ success: true, data: await Child.findById(req.params.id) });
};

function sendPhoto(res, key) {
  res.setHeader('Content-Type', mimeFromKey(key));
  res.setHeader('Cache-Control', 'private, max-age=300');
  res.send(readUpload(key));
}

/** GET /api/children/:id/photo (Admin, Staff) */
exports.photo = async (req, res) => {
  const child = await Child.photoPath(req.params.id);
  if (!child?.profile_photo_path) throw new HttpError(404, 'No photo.');
  sendPhoto(res, child.profile_photo_path);
};

/** GET /api/public-children/:id/photo - only for children marked public and Active */
exports.publicPhoto = async (req, res) => {
  const child = await Child.photoPath(req.params.id);
  if (!child?.profile_photo_path || !child.is_public || child.status !== 'Active') throw new HttpError(404, 'No photo.');
  sendPhoto(res, child.profile_photo_path);
};

/** GET /api/public-children?q=&purpose=adoption - sanitised profiles */
exports.publicList = async (req, res) => {
  res.json({ success: true, data: await Child.publicList({ search: req.query.q, forAdoption: req.query.purpose === 'adoption' }) });
};

// ---------------------------------------------------------------- health access (180 s)
/**
 * POST /api/children/:id/health-access
 *  Staff: { token_id } - the 60-second Token ID typed from their phone (single use).
 *  Admin: { password } - re-authentication with their own password.
 * Returns a 180-second access token bound to this user and this child.
 */
exports.requestHealthAccess = async (req, res) => {
  const child = await Child.photoPath(req.params.id);
  if (!child) throw new HttpError(404, 'Child record not found.');
  const childId = String(req.params.id);

  if (req.user.role === 'Staff') {
    try {
      await qr.verifyToken(req.body.token_id, { scope: 'child', targetId: childId, userId: req.user.user_id });
    } catch (err) {
      await access.logEvent(req, childId, 'TOKEN_DENIED', err.message);
      throw err;
    }
    await qr.consume(req.body.token_id);
    return res.json({ success: true, data: await access.issue(req, childId, 'TYPED_TOKEN') });
  }

  if (req.user.role === 'Admin') {
    const account = await User.findByEmailWithHash(req.user.email);
    const ok = req.body.password && await bcrypt.compare(String(req.body.password), account.password_hash);
    if (!ok) {
      await access.logEvent(req, childId, 'TOKEN_DENIED', 'Wrong password');
      throw new HttpError(401, 'Password is incorrect.');
    }
    return res.json({ success: true, data: await access.issue(req, childId, 'PASSWORD') });
  }
  throw new HttpError(403, 'Your role cannot view health records.');
};

/** GET /api/children/:id/protected  (X-Health-Access) - health record + case files */
exports.getProtected = async (req, res) => {
  const [health, caseFiles] = await Promise.all([Child.getHealth(req.params.id), Child.getCaseFiles(req.params.id)]);
  await access.logEvent(req, req.params.id, 'VIEW', 'Health record and case files');
  await logActivity(req, 'VIEW_HEALTH_RECORD', `Child ${req.params.id}`);
  res.json({ success: true, data: { health, case_files: caseFiles, remaining_seconds: req.healthAccess.remaining_seconds } });
};

/** PUT /api/children/:id/health  (X-Health-Access) */
exports.updateHealth = async (req, res) => {
  const clean = Object.fromEntries(Child.PHI_FIELDS.map((f) => [f, trimOrNull(req.body[f], 5000)]));
  await Child.upsertHealth(req.params.id, clean, req.user.user_id);
  await access.logEvent(req, req.params.id, 'UPDATE', 'Health record');
  await logActivity(req, 'UPDATE_HEALTH_RECORD', `Child ${req.params.id}`);
  res.json({ success: true, data: await Child.getHealth(req.params.id) });
};

/** PUT /api/children/:id/case-files  (X-Health-Access) */
exports.updateCaseFiles = async (req, res) => {
  await Child.update(req.params.id, {
    background_care_info: trimOrNull(req.body.background_care_info, 10000),
    guardian_family_info: trimOrNull(req.body.guardian_family_info, 10000),
  });
  await access.logEvent(req, req.params.id, 'UPDATE', 'Case files');
  await logActivity(req, 'UPDATE_CASE_FILES', `Child ${req.params.id}`);
  res.json({ success: true, data: await Child.getCaseFiles(req.params.id) });
};

/** POST /api/children/:id/health-access/revoke - closes access early (manual lock or timer end) */
exports.revokeHealthAccess = async (req, res) => {
  await access.revoke(req, req.params.id);
  res.json({ success: true, message: 'Health access closed.' });
};
