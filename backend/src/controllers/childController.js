const env = require('../config/env');
const { withTransaction } = require('../config/db');
const Child = require('../models/childModel');
const access = require('../services/healthAccessService');
const HttpError = require('../utils/HttpError');
const { sha256, randomCode } = require('../utils/crypto');
const { saveUpload, readUpload, discardUnsavedUpload, mimeFromKey, MB } = require('../utils/files');
const Retained = require('../services/retainedFiles');
const {
  requireFields, oneOf, requireDate, trimOrNull, toBool, localToday, ageOn, requireText,
} = require('../utils/validate');
const { logActivity, logActivityWith, logChange, diff } = require('../utils/audit');
const { readPagination } = require('../utils/pagination');
const Policy = require('../services/childAccess');

const GENDERS = ['Male', 'Female'];
const STATUSES = ['Active', 'Discharged', 'Adopted'];
// square: profile photos are cropped to a square in the browser; the server checks it too.
const PHOTO_OPTS = { folder: 'child-photos', allowed: ['jpg', 'png'], maxBytes: 5 * MB, label: 'Profile photo', square: true };
const OVER_AGE = 'Registration denied. The child exceeds the maximum age requirement.';
const HEALTH_LABELS = { blood_type: 'Blood type', allergies: 'Allergies', vaccinations: 'Vaccinations', prescriptions: 'Prescriptions', doctor_notes: 'Doctor notes' };
const CHILD_FIELD_LABELS = { first_name: 'First name', last_name: 'Last name', gender: 'Gender', dob: 'Date of birth', admission_date: 'Admission date',
  urgent_needs: 'Urgent needs', public_bio: 'Public bio', is_public: 'Shown on the donor portal', available_for_adoption: 'Available for adoption', status: 'Status' };

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

/**
 * GET /api/children?status=&q=&flagged=1&assigned=&sort=&page=&limit=
 * Directory list through the child record policy: Staff get directory fields (case number, first name and last
 * initial, status, case worker, dates) and an access chip per row; Admin gets the full rows. Search by case
 * number or name (Staff: case number and first name). Never sorted by age unless Admin picks it.
 */
exports.list = async (req, res) => {
  await syncFlags();
  const isAdmin = req.user.role === 'Admin';
  const status = req.query.status ? oneOf(req.query.status, STATUSES, 'status') : undefined;
  const paging = readPagination(req.query);
  const sorts = isAdmin ? ['recent', 'registered', 'case', 'name', 'age'] : ['recent', 'registered', 'case', 'name'];
  let sort = req.query.sort ? oneOf(req.query.sort, sorts, 'sort') : 'recent';
  if (!isAdmin && sort === 'name') sort = 'first_name';
  let assigned = req.query.assigned ? String(req.query.assigned) : undefined;
  if (assigned && !['me', 'unassigned', 'attention'].includes(assigned) && !(isAdmin && /^\d+$/.test(assigned))) throw new HttpError(400, 'Choose who the records are assigned to.');
  if (!isAdmin && ['unassigned', 'attention'].includes(assigned)) assigned = undefined;
  const monitoring = await Policy.monitoringOf(req);
  const result = await Child.list({ status, search: req.query.q, flagged: toBool(req.query.flagged), paging, sort, assigned, viewerId: req.user.user_id,
    searchFull: isAdmin, ids: monitoring ? monitoring.child_ids : undefined, archived: isAdmin && toBool(req.query.archived) });
  const rows = paging ? result.rows : result;
  const data = await Policy.shapeList(req, rows.map((c) => ({ ...c, cdclaa_verified: Boolean(c.cdclaa_verified_at) })));
  await logActivity(req, `CRA_DIRECTORY_VIEWED (list, ${data.length} rows${req.query.q ? ', search' : ''})`, 'Children');
  const meta = { mode: (await Policy.settings()).child_access_mode, monitoring: Boolean(monitoring) };
  if (paging) return res.json({ success: true, data, pagination: result.pagination, meta });
  res.json({ success: true, data, meta });
};

/** GET /api/children/:id - header and overview at the viewer's level (policy), never more. */
exports.getOne = async (req, res) => {
  const d = await Policy.check(req, req.params.id, 'directory', 'open child page');
  const child = await Child.findById(d.child_id);
  delete child.profile_photo_path;
  const coreVisible = d.core || d.shadow || (!d.enforced && d.role === 'Staff');
  const row = { ...child, cdclaa_verified: Boolean(child.cdclaa_verified_at) };
  if (coreVisible) row.discharge_history = await Child.dischargeHistory(child.child_id);
  const data = await Policy.shapeOne(req, row, d);
  if (d.monitoring) await Policy.monitoringRecordOpened(req, d.child_id);
  else await logActivity(req, d.core ? 'CRA_CORE_RECORD_OPENED' : 'CRA_DIRECTORY_VIEWED (child page)', `Child ${d.child_id}`);
  const [[pending]] = await require('../config/db').pool.query("SELECT request_id, created_at FROM tbl_child_access_requests WHERE child_id = ? AND requested_by = ? AND status = 'Pending'", [d.child_id, req.user.user_id]);
  data.access = { ...data.access, can: { care_card: d.care_card, core: d.core, sensitive: d.sensitive_assigned || req.user.role === 'Admin', edit_care_card: d.edit_care_card,
    edit_photo: d.edit_photo, access_tab: d.access_tab, edit: d.core && !d.read_only, request: req.user.role === 'Staff' && d.directory && !d.core },
  initial: d.initial ? { ends_at: d.initial.ends_at } : null,
  assignment: d.assignment ? { type: d.assignment.type, ends_at: d.assignment.ends_at } : null, read_only: d.read_only, monitoring: Boolean(d.monitoring),
  pending_request: pending || null, registered_by_me: Boolean(d.initial),
  // Not admitted yet: the page sends the viewer to the admission (Admin or the staff member who created it).
  admission: child.status === 'In admission' ? { status: child.admission_status, creator: Boolean(d.admission_creator), editable: Boolean(d.admission_editable) } : null };
  const [[adm]] = await require('../config/db').pool.query('SELECT 1 AS ok FROM tbl_child_admissions WHERE child_id = ?', [d.child_id]);
  data.has_admission_record = Boolean(adm);
  res.json({ success: true, data });
};

/**
 * GET /api/children/:id/adoption-history (Admin, Staff) - adoption status history for the child.
 * Staff need the child's unlock session (purpose, QR token, 3-minute access), like the adoption
 * legal records; Admin has full access. Every view is logged.
 */
exports.adoptionHistory = async (req, res) => {
  const access = await Policy.sensitiveAccess(req, req.params.id); // level 3: assigned + unlock session (Admin: always)
  if (!access.unlocked) throw new HttpError(403, 'Unlock the child record to see its adoption history.', { locked: true });
  const child = await Child.findById(access.decision.child_id);
  await logActivity(req, 'VIEW_CHILD_ADOPTION_HISTORY', `Child ${child.child_id}`);
  const rows = await Child.adoptionHistory(child.child_id);
  // Each case's summary (stage, matching, placement, petition, NACC, Order, finality, registration, monitoring).
  const Stages = require('../services/adoptionStages');
  const Adoption = require('../models/adoptionModel');
  for (const r of rows) {
    const app = await Adoption.findById(r.application_id);
    if (app) r.summary = await Stages.childCaseSummary(app);
  }
  // Staff unlocked the child, not each application: applicant names stay masked (need-to-know per application).
  const { maskName } = require('../config/adoptionSensitive');
  res.json({ success: true, data: req.user.role === 'Admin' ? rows : rows.map((r) => ({ ...r, applicant: maskName(r.applicant) })) });
};

// New children are registered only through the admission workflow (services/admission.js, POST /api/admissions):
// the record starts "In admission" and becomes Active when an Admin approves it.

/** POST /api/children/duplicate-check { first_name, last_name, dob } - rate-limited and logged; Staff see no details. */
exports.duplicateCheck = async (req, res) => {
  res.json({ success: true, data: await Policy.duplicateCheck(req, req.body || {}) });
};


/**
 * PUT /api/children/:id  (Admin, Staff)
 * Status rules:
 *  - Active -> Discharged requires full discharge documentation (both roles).
 *  - Adopted is set only when an Admin finalizes an approved adoption.
 *  - Leaving Discharged or Adopted is an Admin-only override.
 *  - Staff edits never change status unless status is sent explicitly.
 */
exports.update = async (req, res) => {
  const d = await Policy.check(req, req.params.id, 'core', 'edit child record');
  const child = await Child.findById(d.child_id);
  if (child.status === 'In admission') throw new HttpError(409, 'This child is still in admission. Make changes in the admission form.');
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
  // Admin and Staff may both change adoption availability.
  if (b.available_for_adoption !== undefined) {
    const want = toBool(b.available_for_adoption);
    // CDCLAA gate (RA 11642): Available for adoption only with a CDCLAA verified by an Admin.
    if (want && !child.cdclaa_verified_at) {
      throw new HttpError(409, 'Record the CDCLAA (number, issue date and copy) and have an administrator verify it before marking this child Available for adoption.');
    }
    if (!want && child.placement_status && child.placement_status !== 'None') {
      throw new HttpError(409, 'This child is matched or in trial custody. End the placement in the adoption application first.');
    }
    fields.available_for_adoption = want ? 1 : 0;
  }

  const nextStatus = b.status !== undefined ? oneOf(b.status, STATUSES, 'status') : child.status;
  let discharge = null;
  if (nextStatus !== child.status) {
    if (nextStatus === 'Adopted') {
      throw new HttpError(409, "A child's status becomes Adopted only when an administrator finalizes an approved adoption.");
    }
    if (child.status !== 'Active' && !isAdmin) {
      throw new HttpError(403, `Only an administrator can change the status of a ${child.status.toLowerCase()} child.`);
    }
    if (nextStatus === 'Discharged') discharge = cleanDischarge(b);
    fields.status = nextStatus;
    if (nextStatus !== 'Active') fields.available_for_adoption = 0; // only Active children can be listed
  }

  // What changed, for the audit log (previous and new value; free-text needs and bio only "changed").
  const changes = diff(child, fields, { labels: CHILD_FIELD_LABELS, sensitive: ['urgent_needs', 'public_bio'] });
  await withTransaction(async (conn) => {
    await Child.update(child.child_id, fields, conn);
    if (discharge) {
      await Child.insertDischarge(conn, { ...discharge, child_id: child.child_id, reported_by: req.user.user_id, previous_status: child.status });
    }
    const target = `Child ${child.child_id}`;
    if (discharge) await logChange(conn, req, 'DISCHARGE_CHILD', target, { changes: changes.filter((c) => c.field === 'Status'), reason: 'Discharge details recorded in the discharge history' });
    else if (fields.status) await logChange(conn, req, `STATUS_${child.status.toUpperCase()}_TO_${fields.status.toUpperCase()}`, target, { changes: changes.filter((c) => c.field === 'Status') });
    const other = changes.filter((c) => c.field !== 'Status');
    if (other.length) await logChange(conn, req, 'UPDATE_CHILD', target, { changes: other });
  });
  if (fields.dob) await syncFlags(true);
  res.json({ success: true, data: await Child.findById(child.child_id) });
};

/**
 * DELETE /api/children/:id { reason } (Admin) - children are never deleted (migration 034). For a record created by
 * mistake or a duplicate, the child is ARCHIVED: the row and everything linked to it (health, case files, admission,
 * adoption, transition, uploaded files, audit log) stay; normal lists hide it; Admin can list and restore it.
 * A child with discharge, adoption, legal or access history, or one still in admission, can't be archived:
 * change the status (or decline the admission) instead.
 */
exports.remove = async (req, res) => {
  const child = await Child.photoPath(req.params.id);
  if (!child) throw new HttpError(404, 'Child record not found.');
  if (child.archived_at) throw new HttpError(409, 'This child record is already archived.');
  const reason = String(req.body?.reason || req.query.reason || '').trim();
  if (reason.length < 5) throw new HttpError(400, 'Give the reason for archiving this record (for example "Duplicate of CS-2026-0003").', { errors: { reason: 'Give the reason (at least 5 characters).' } });
  if (child.status === 'In admission') throw new HttpError(409, 'This child is still in admission. Decline the admission instead.');
  if (await Child.hasProtectedHistory(req.params.id)) {
    throw new HttpError(409, 'This child has discharge, adoption, legal or access history that must stay in the records. Change the status instead of archiving.');
  }
  await withTransaction(async (conn) => {
    await Child.archive(conn, req.params.id, req.user.user_id, reason.slice(0, 500));
    await logChange(conn, req, 'ARCHIVE_CHILD', `Child ${req.params.id}`, { reason: reason.slice(0, 500) });
  });
  res.json({ success: true, message: 'Child record archived. Nothing was deleted.' });
};

/** POST /api/children/:id/restore (Admin) - brings an archived child record back to the lists. */
exports.restore = async (req, res) => {
  const child = await Child.photoPath(req.params.id);
  if (!child) throw new HttpError(404, 'Child record not found.');
  if (!child.archived_at) throw new HttpError(409, 'This child record is not archived.');
  await withTransaction(async (conn) => {
    await Child.restore(conn, req.params.id);
    await logChange(conn, req, 'RESTORE_CHILD', `Child ${req.params.id}`, { reason: String(req.body?.reason || '').trim().slice(0, 500) || null });
  });
  res.json({ success: true, data: await Child.findById(req.params.id) });
};

// ---------------------------------------------------------------- photos
exports.uploadPhoto = async (req, res) => {
  await Policy.check(req, req.params.id, 'edit_photo', 'change photo'); // the photo is part of the Care card
  const child = await Child.photoPath(req.params.id);
  if (!child) throw new HttpError(404, 'Child record not found.');
  const saved = saveUpload(req.body.photo, PHOTO_OPTS);
  try {
    await withTransaction(async (conn) => {
      await Child.update(req.params.id, { profile_photo_path: saved.storage_key }, conn);
      // The previous photo stays on disk, recorded as Replaced (uploaded files are never deleted).
      await Retained.retain(conn, req, { area: 'child_photo', childId: req.params.id, key: child.profile_photo_path, status: 'Replaced', replacedByKey: saved.storage_key });
      await logChange(conn, req, 'UPDATE_CHILD_PHOTO', `Child ${req.params.id}`, { changes: [{ field: 'Profile photo', old: child.profile_photo_path ? 'Previous photo (kept)' : null, new: 'New photo', sensitive: false }] });
    });
  } catch (err) { discardUnsavedUpload(saved.storage_key); throw err; }
  res.json({ success: true, data: await Child.findById(req.params.id) });
};

exports.removePhoto = async (req, res) => {
  await Policy.check(req, req.params.id, 'edit_photo', 'remove photo');
  const child = await Child.photoPath(req.params.id);
  if (!child) throw new HttpError(404, 'Child record not found.');
  if (!child.profile_photo_path) throw new HttpError(404, 'This child has no profile photo.');
  await withTransaction(async (conn) => {
    await Child.update(req.params.id, { profile_photo_path: null }, conn);
    // The file stays on disk, recorded as Removed (uploaded files are never deleted).
    await Retained.retain(conn, req, { area: 'child_photo', childId: req.params.id, key: child.profile_photo_path, status: 'Removed', reason: String(req.body?.reason || '').trim() || null });
    await logChange(conn, req, 'REMOVE_CHILD_PHOTO', `Child ${req.params.id}`, { changes: [{ field: 'Profile photo', old: 'Photo (kept in the archive)', new: null, sensitive: false }] });
  });
  res.json({ success: true, data: await Child.findById(req.params.id) });
};

function sendPhoto(res, key) {
  res.setHeader('Content-Type', mimeFromKey(key));
  res.setHeader('Cache-Control', 'no-store'); // child photos are never kept in the browser cache
  res.send(readUpload(key));
}

/** GET /api/children/:id/photo (Admin, Staff) */
exports.photo = async (req, res) => {
  await Policy.check(req, req.params.id, 'care_card', 'view photo'); // identification photo: Care card level
  const child = await Child.photoPath(req.params.id);
  if (!child?.profile_photo_path) throw new HttpError(404, 'No photo.');
  sendPhoto(res, child.profile_photo_path);
};

/** GET /api/public-children/:id/photo - only for Active children marked public or available for adoption */
exports.publicPhoto = async (req, res) => {
  const child = await Child.photoPath(req.params.id);
  // Only children the home has published on the donor portal (adoption listings never show photos).
  const listed = child && child.is_public;
  if (!child?.profile_photo_path || !listed || child.status !== 'Active') throw new HttpError(404, 'No photo.');
  sendPhoto(res, child.profile_photo_path);
};

/** GET /api/public-children?q=&purpose=adoption - sanitised profiles */
exports.publicList = async (req, res) => {
  const paging = readPagination(req.query);
  const result = await Child.publicList({ search: req.query.q, forAdoption: req.query.purpose === 'adoption', paging });
  if (paging) return res.json({ success: true, data: result.rows, pagination: result.pagination });
  res.json({ success: true, data: result });
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

  // Staff open health records through the shared unlock flow (purpose, QR, Token ID), which issues
  // the health access token itself; this endpoint no longer accepts a typed token from Staff.
  if (req.user.role === 'Staff') {
    await access.logEvent(req, childId, 'TOKEN_DENIED', 'use the unlock flow');
    throw new HttpError(403, 'Use "Unlock child record" to open health records.');
  }

  // Admin: full access with no token or password. Every view is still logged.
  if (req.user.role === 'Admin') {
    await Policy.check(req, childId, 'sensitive', 'open health record');
    const unlock = require('../services/unlockService');
    await unlock.logEvent(req, { recordType: 'health', recordId: childId, event: 'view_sections', purpose: 'Admin full access', detail: 'health record and case files' });
    return res.json({ success: true, data: await access.issue(req, childId, 'ADMIN_FULL_ACCESS', require('../config/sensitiveAccess').ACCESS_SESSION) });
  }
  throw new HttpError(403, 'Your role cannot view health records.');
};

/** GET /api/children/:id/protected  (X-Health-Access) - health record + case files */
exports.getProtected = async (req, res) => {
  // Level 3. The health token came from the unlock flow (Staff) or Admin; the policy re-checks the assignment.
  await Policy.check(req, req.params.id, 'sensitive', 'view health record');
  const health = await Child.getHealth(req.params.id);
  await access.logEvent(req, req.params.id, 'VIEW', 'Health record');
  await logActivity(req, 'VIEW_HEALTH_RECORD', `Child ${req.params.id}`);
  // Case files are part of the core record now (GET /children/:id/case-files).
  res.json({ success: true, data: { health, remaining_seconds: req.healthAccess.remaining_seconds } });
};

/** PUT /api/children/:id/health  (X-Health-Access) */
exports.updateHealth = async (req, res) => {
  await Policy.check(req, req.params.id, 'sensitive', 'update health record');
  const clean = Object.fromEntries(Child.PHI_FIELDS.map((f) => [f, trimOrNull(req.body[f], 5000)]));
  const before = await Child.getHealth(req.params.id) || {};
  await Child.upsertHealth(req.params.id, clean, req.user.user_id);
  await access.logEvent(req, req.params.id, 'UPDATE', 'Health record');
  // Health values are never written to the audit log: only which fields changed.
  await logChange(null, req, 'UPDATE_HEALTH_RECORD', `Child ${req.params.id}`, { changes: diff(before, clean, { sensitive: Child.PHI_FIELDS, labels: HEALTH_LABELS }) });
  res.json({ success: true, data: await Child.getHealth(req.params.id) });
};

/** GET /api/children/:id/case-files - core record (Admin, assigned case worker, registering Staff in the initial window). */
exports.getCaseFiles = async (req, res) => {
  const d = await Policy.check(req, req.params.id, 'core', 'open case files');
  const files = await Child.getCaseFiles(d.child_id);
  await logActivity(req, 'CRA_CASE_FILES_VIEWED', `Child ${d.child_id}`);
  res.json({ success: true, data: { ...files, discharge_history: await Child.dischargeHistory(d.child_id) } });
};

/** PUT /api/children/:id/case-files - core record. */
exports.updateCaseFiles = async (req, res) => {
  const d = await Policy.check(req, req.params.id, 'core', 'edit case files');
  if (d.read_only) throw new HttpError(403, 'Monitoring mode is read-only.');
  const next = {
    background_care_info: trimOrNull(req.body.background_care_info, 10000),
    guardian_family_info: trimOrNull(req.body.guardian_family_info, 10000),
  };
  const before = await Child.getCaseFiles(d.child_id) || {};
  await Child.update(d.child_id, next);
  // Case notes are sensitive: the audit log says which fields changed, not their text.
  await logChange(null, req, 'UPDATE_CASE_FILES', `Child ${d.child_id}`, { changes: diff(before, next, { sensitive: Object.keys(next), labels: { background_care_info: 'Background and care information', guardian_family_info: 'Guardian and family information' } }) });
  res.json({ success: true, data: await Child.getCaseFiles(d.child_id) });
};

/** POST /api/children/:id/health-access/revoke - closes access early (manual lock or timer end) */
exports.revokeHealthAccess = async (req, res) => {
  await access.revoke(req, req.params.id);
  res.json({ success: true, message: 'Health access closed.' });
};
