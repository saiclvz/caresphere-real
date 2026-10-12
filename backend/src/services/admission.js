/**
 * Child admission workflow (migration 033). One child record from the first step to admission; nothing is copied.
 *
 *   Staff with the Admission duty (or Admin) -> New Admission (Step 1 creates the record, status "In admission",
 *   admission status Draft) -> Steps 2-4 saved as often as needed -> Submit for Admin Approval (Pending Approval)
 *   -> Admin: Approve (child Active, admission Admitted) | Return for Correction (Needs Correction) | Decline.
 *
 * Access goes through the child record policy (services/childAccess.js): while the admission is open only Admin and
 * the staff member who created it can open it; after approval the creator keeps working on the child only if an
 * Admin assigned them. "Creating a child record does not mean owning the child record."
 */
const { pool, withTransaction } = require('../config/db');
const env = require('../config/env');
const HttpError = require('../utils/HttpError');
const { encrypt, decrypt, sha256, randomCode } = require('../utils/crypto');
const { saveUpload, readUpload, verifyUpload, deleteUpload, MB } = require('../utils/files');
const { logActivity, logActivityWith } = require('../utils/audit');
const { oneOf, requireDate, trimOrNull, toBool, localToday, ageOn, requireText } = require('../utils/validate');
const A = require('../config/admission');
const Child = require('../models/childModel');
const Policy = require('./childAccess');
const Notify = require('./notifications');

const PHOTO_OPTS = { folder: 'child-photos', allowed: ['jpg', 'png'], maxBytes: 5 * MB, label: 'Profile photo', square: true };
const FILE_OPTS = { folder: 'child-admission', allowed: A.FILE_TYPES, maxBytes: A.FILE_MAX_MB * MB, label: 'Document' };
const OVER_AGE = 'Registration denied. The child exceeds the maximum age requirement.';
const GENDERS = ['Male', 'Female'];
const enc = (v) => (v === null || v === undefined || v === '' ? null : encrypt(String(v), env.phiKey));
const dec = (v) => { if (!v) return null; try { return decrypt(v, env.phiKey); } catch { return null; } };
const fail = (errors, message = 'Check the highlighted fields.') => { throw new HttpError(422, message, { errors }); };
const isAdmin = (req) => req.user.role === 'Admin';
const ref = (id) => ({ ref: id, id });

// ---------------------------------------------------------------- loading and access
async function load(conn, childId, lock = false) {
  const [[r]] = await conn.query(
    `SELECT c.child_id, c.first_name, c.last_name, c.full_name, c.gender, c.dob, c.admission_date, c.status, c.admission_status,
            c.profile_photo_path, c.background_care_info, c.guardian_family_info, c.assigned_staff_id,
            adm.*, cu.full_name AS created_by_name, cr.role_name AS created_by_role, su.full_name AS submitted_by_name,
            du.full_name AS decided_by_name, au.full_name AS approved_by_name
       FROM tbl_children c JOIN tbl_child_admissions adm ON adm.child_id = c.child_id
       LEFT JOIN tbl_users cu ON cu.user_id = adm.created_by LEFT JOIN tbl_roles cr ON cr.role_id = cu.role_id
       LEFT JOIN tbl_users su ON su.user_id = adm.submitted_by LEFT JOIN tbl_users du ON du.user_id = adm.decided_by
       LEFT JOIN tbl_users au ON au.user_id = adm.approved_by
      WHERE c.child_id = ? ${lock ? 'FOR UPDATE' : ''}`, [String(childId)]);
  if (!r) throw new HttpError(404, 'Admission not found.');
  return r;
}

/**
 * The admission's access check (on top of the child policy).
 *  view   - Admin; the creator while the admission is open; after admission, whoever may open the core record.
 *  edit   - Admin or the creator (Admission duty), only while Draft or Needs Correction.
 *  decide - Admin only, while Pending Approval (Return/Decline also allowed from Needs Correction for Decline).
 */
async function access(req, childId, need, conn = pool) {
  const d = await Policy.check(req, childId, 'core', `admission: ${need}`, conn); // role, duty, assignment, level, admission status
  const row = await load(conn, d.child_id);
  if (need === 'view') return { d, row };
  if (d.read_only) throw new HttpError(403, 'A monitoring visit is read-only.');
  if (need === 'edit') {
    if (!A.EDITABLE.includes(row.admission_status)) {
      throw new HttpError(409, row.admission_status === 'Pending Approval'
        ? 'This admission is waiting for Admin approval. It can be changed again only if an Admin returns it for correction.'
        : `This admission is ${row.admission_status.toLowerCase()} and can no longer be changed here.`);
    }
    if (!isAdmin(req) && !d.admission_creator) throw new HttpError(403, Policy.DENIED);
    return { d, row };
  }
  if (!isAdmin(req)) throw new HttpError(403, Policy.DENIED);
  return { d, row };
}

async function history(conn, childId, from, to, note, actorId) {
  await conn.query('INSERT INTO tbl_child_admission_history (child_id, from_status, to_status, note, actor_id) VALUES (?, ?, ?, ?, ?)',
    [String(childId), from, to, note ? String(note).slice(0, 2000) : null, actorId || null]);
}

// ---------------------------------------------------------------- step validation (saving is lenient; submitting is strict)
function cleanDob(v, errors) {
  if (!v) { errors.dob = 'Date of birth is required.'; return null; }
  try { const d = requireDate(v, 'Date of birth'); if (d > localToday()) errors.dob = 'Date of birth cannot be in the future.'; return d; } catch { errors.dob = 'Enter a valid date.'; return null; }
}
function optDate(v, field, label, errors, { notFuture = true, notBefore = null } = {}) {
  if (v === undefined || v === null || v === '') return null;
  try {
    const d = requireDate(v, label);
    if (notFuture && d > localToday()) errors[field] = `${label} cannot be in the future.`;
    else if (notBefore && d < notBefore) errors[field] = `${label} cannot be before the date of birth.`;
    return d;
  } catch { errors[field] = 'Enter a valid date.'; return null; }
}
const text = (v, max) => trimOrNull(v, max);

function basicFields(b, { creating }) {
  const errors = {};
  const first = text(b.first_name, 50); const last = text(b.last_name, 50);
  if (!first) errors.first_name = 'First name is required.';
  if (!last) errors.last_name = 'Last name is required.';
  if (!GENDERS.includes(b.gender)) errors.gender = 'Choose the gender.';
  const dob = cleanDob(b.dob, errors);
  if (dob && !errors.dob && creating && ageOn(dob) > env.maxAdmissionAge) errors.dob = OVER_AGE;
  const admission_date = optDate(b.admission_date, 'admission_date', 'Admission date', errors, { notBefore: dob });
  if (Object.keys(errors).length) fail(errors, errors.dob === OVER_AGE ? OVER_AGE : undefined);
  return { child: { first_name: first, last_name: last, gender: b.gender, dob, admission_date }, place_of_birth: text(b.place_of_birth, 150) };
}

function referralFields(b) {
  const errors = {};
  const source = b.referral_source ? String(b.referral_source) : null;
  if (source && !A.REFERRAL_SOURCES.includes(source)) errors.referral_source = 'Choose a referral source from the list.';
  const referral_date = optDate(b.referral_date, 'referral_date', 'Referral date', errors);
  if (Object.keys(errors).length) fail(errors);
  return {
    adm: { referral_source: source, referring_agency: text(b.referring_agency, 150), referring_person: text(b.referring_person, 150),
      referring_contact_enc: enc(text(b.referring_contact, 150)), referral_date, referral_reference: text(b.referral_reference, 80), reason_enc: enc(text(b.reason, 5000)) },
    child: { background_care_info: text(b.background_care_info, 10000) },
  };
}

function familyFields(b) {
  const errors = {};
  const list = Array.isArray(b.guardians) ? b.guardians : [];
  if (list.length > A.MAX_GUARDIANS) errors.guardians = `Add up to ${A.MAX_GUARDIANS} people.`;
  const guardians = list.slice(0, A.MAX_GUARDIANS).map((g, i) => {
    const out = { name: text(g?.name, 150), relationship: g?.relationship || null, status: g?.status || null, contact: text(g?.contact, 100), address: text(g?.address, 300) };
    if (!out.name && out.status !== 'Whereabouts unknown') errors[`guardian_${i}_name`] = 'Enter the name (or mark the whereabouts unknown).';
    if (!A.RELATIONSHIPS.includes(out.relationship)) errors[`guardian_${i}_relationship`] = 'Choose the relationship.';
    if (!A.GUARDIAN_STATUS.includes(out.status)) errors[`guardian_${i}_status`] = 'Choose living, deceased or whereabouts unknown.';
    return out;
  });
  if (Object.keys(errors).length) fail(errors);
  return {
    adm: { parents_unknown: toBool(b.parents_unknown) ? 1 : 0, guardians_enc: guardians.length ? enc(JSON.stringify(guardians)) : null, siblings_enc: enc(text(b.siblings, 3000)) },
    child: { guardian_family_info: text(b.family_notes, 10000) },
  };
}

function checklistFields(b) {
  const items = b.checklist && typeof b.checklist === 'object' ? b.checklist : {};
  const errors = {};
  const rows = [];
  for (const [key, v] of Object.entries(items)) {
    if (!A.CHECKLIST.some((c) => c.key === key)) continue;
    if (!v || !v.status) continue; // not marked yet
    if (!A.CHECK_STATUSES.includes(v.status)) { errors[`check_${key}`] = 'Choose Received, To follow or Not applicable.'; continue; }
    rows.push({ key, status: v.status, note: text(v.note, 500) });
  }
  if (Object.keys(errors).length) fail(errors);
  return rows;
}

/** What is still missing before the admission can be submitted, per step. Empty = ready. */
function problems(row, checklist) {
  const p = [];
  if (!row.first_name || !row.last_name || !row.gender || !row.dob) p.push({ step: 1, field: 'basic', message: 'Name, gender and date of birth are required.' });
  if (!row.admission_date) p.push({ step: 1, field: 'admission_date', message: 'Enter the admission date (the day the child came to the home).' });
  if (!row.referral_source) p.push({ step: 2, field: 'referral_source', message: 'Choose the referral source.' });
  if (!row.referral_date) p.push({ step: 2, field: 'referral_date', message: 'Enter the referral date.' });
  if (!row.reason_enc) p.push({ step: 2, field: 'reason', message: 'Describe the reason for admission.' });
  if (!row.parents_unknown && !row.guardians_enc) p.push({ step: 3, field: 'guardians', message: 'Add at least one parent or guardian, or tick "Parents/guardians unknown".' });
  const marked = new Set(checklist.map((c) => c.doc_key));
  const missing = A.CHECKLIST.filter((c) => !marked.has(c.key));
  if (missing.length) p.push({ step: 4, field: 'checklist', message: `Mark every checklist item (Received, To follow or Not applicable): ${missing.length} left.`, keys: missing.map((m) => m.key) });
  return p;
}

// ---------------------------------------------------------------- create and save steps
/** POST /api/admissions - Step 1 creates the one child record (status "In admission", admission Draft). */
async function create(req, body) {
  const b = body || {};
  const { child, place_of_birth } = basicFields(b, { creating: true });
  if (b.confirm_duplicate !== true) {
    const dup = await Policy.duplicateCheck(req, child, { countAgainstLimit: false });
    if (dup.possible_match) throw new HttpError(409, dup.message, { possible_match: true, ...(dup.matches ? { matches: dup.matches } : {}) });
  } else {
    await logActivity(req, 'CRA_DUPLICATE_CHECK (admission started anyway after a possible match)', 'Children');
  }
  const photo = b.photo ? saveUpload(b.photo, PHOTO_OPTS) : null;
  try {
    return await withTransaction(async (conn) => {
      const id = await Child.nextChildId(conn);
      await Child.insert(conn, { ...child, child_id: id, status: A.CHILD_STATUS, is_public: false, available_for_adoption: false,
        background_care_info: null, guardian_family_info: null, profile_photo_path: photo?.storage_key || null, qr_token: sha256(randomCode(16)) });
      await conn.query("UPDATE tbl_children SET admission_status = 'Draft' WHERE child_id = ?", [id]);
      await conn.query('INSERT INTO tbl_child_admissions (child_id, created_by, current_step, place_of_birth, updated_at) VALUES (?, ?, 2, ?, NOW())',
        [id, req.user.user_id, place_of_birth]);
      await history(conn, id, null, 'Draft', 'Admission started', req.user.user_id);
      await logActivityWith(conn, req, 'ADMISSION_CREATED', `Child ${id}`);
      return { child_id: id };
    });
  } catch (err) {
    if (photo) deleteUpload(photo.storage_key);
    throw err;
  }
}

/** PUT /api/admissions/:id/steps/:n - save progress (no approval between steps). */
async function saveStep(req, childId, n, body) {
  const step = Number(n);
  if (![1, 2, 3, 4].includes(step)) throw new HttpError(400, 'Unknown step.');
  const { row } = await access(req, childId, 'edit');
  const b = body || {};
  await withTransaction(async (conn) => {
    let adm = {}; let child = {};
    if (step === 1) { const r = basicFields(b, { creating: false }); child = r.child; adm = { place_of_birth: r.place_of_birth }; }
    if (step === 2) ({ adm, child } = referralFields(b));
    if (step === 3) ({ adm, child } = familyFields(b));
    if (step === 4) {
      for (const c of checklistFields(b)) {
        await conn.query(
          `INSERT INTO tbl_child_admission_checklist (child_id, doc_key, status, note, updated_by, updated_at) VALUES (?, ?, ?, ?, ?, NOW())
           ON DUPLICATE KEY UPDATE status = VALUES(status), note = VALUES(note), updated_by = VALUES(updated_by), updated_at = NOW()`,
          [row.child_id, c.key, c.status, c.note, req.user.user_id]);
      }
    }
    if (Object.keys(child).length) await Child.update(row.child_id, child, conn);
    const next = Math.min(4, Math.max(Number(row.current_step) || 1, step + 1));
    const keys = Object.keys(adm);
    await conn.query(`UPDATE tbl_child_admissions SET ${keys.map((k) => `${k} = ?, `).join('')}current_step = ?, updated_at = NOW() WHERE child_id = ?`,
      [...keys.map((k) => adm[k]), next, row.child_id]);
    await logActivityWith(conn, req, `ADMISSION_SAVED (step ${step})`, `Child ${row.child_id}`);
  });
}

/** POST /api/admissions/:id/documents/:key - a copy for a checklist item (encrypted); an older copy is kept, superseded. */
async function uploadFile(req, childId, key, file) {
  const item = A.CHECKLIST.find((c) => c.key === key);
  if (!item) throw new HttpError(400, 'Unknown checklist item.');
  const { row } = await access(req, childId, 'edit');
  const saved = saveUpload(file, { ...FILE_OPTS, label: item.label });
  try {
    await withTransaction(async (conn) => {
      await conn.query('UPDATE tbl_child_admission_files SET superseded_at = NOW() WHERE child_id = ? AND doc_key = ? AND superseded_at IS NULL', [row.child_id, key]);
      await conn.query(`INSERT INTO tbl_child_admission_files (child_id, doc_key, storage_key, mime_type, original_name, sha256, uploaded_by) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [row.child_id, key, saved.storage_key, saved.mime_type, saved.original_name, saved.sha256, req.user.user_id]);
      await conn.query(
        `INSERT INTO tbl_child_admission_checklist (child_id, doc_key, status, updated_by, updated_at) VALUES (?, ?, 'Received', ?, NOW())
         ON DUPLICATE KEY UPDATE status = 'Received', updated_by = VALUES(updated_by), updated_at = NOW()`, [row.child_id, key, req.user.user_id]);
      await conn.query('UPDATE tbl_child_admissions SET updated_at = NOW() WHERE child_id = ?', [row.child_id]);
      await logActivityWith(conn, req, `ADMISSION_DOCUMENT_UPLOADED (${key})`, `Child ${row.child_id}`);
    });
  } catch (err) {
    deleteUpload(saved.storage_key);
    throw err;
  }
}

/** Can this viewer open a copy? Medical copies are level 3: Admin, or the assigned case worker with an unlock session. */
async function canOpen(req, row, docKey) {
  const item = A.CHECKLIST.find((c) => c.key === docKey);
  if (item?.level !== 'sensitive') return true;
  if (isAdmin(req)) return true;
  if (row.status === A.CHILD_STATUS) return false; // never for the creator during the admission
  const s = await Policy.sensitiveAccess(req, row.child_id).catch(() => null);
  return Boolean(s?.unlocked);
}

/** GET /api/admissions/:id/files/:fileId */
async function file(req, childId, fileId) {
  const { row } = await access(req, childId, 'view');
  const [[f]] = await pool.query('SELECT * FROM tbl_child_admission_files WHERE file_id = ? AND child_id = ?', [Number(fileId) || 0, row.child_id]);
  if (!f) throw new HttpError(404, 'File not found.');
  if (!(await canOpen(req, row, f.doc_key))) {
    await logActivity(req, `CRA_ACCESS_DENIED (sensitive, admission document ${f.doc_key})`, `Child ${row.child_id}`);
    throw new HttpError(403, Policy.DENIED);
  }
  const intact = verifyUpload(f.storage_key, f.sha256);
  await logActivity(req, `ADMISSION_DOCUMENT_VIEWED (${f.doc_key}${intact === false ? ', integrity check failed' : ''})`, `Child ${row.child_id}`);
  return { file: f, body: readUpload(f.storage_key) };
}

// ---------------------------------------------------------------- reading
async function detail(req, childId) {
  const { d, row } = await access(req, childId, 'view');
  const admin = isAdmin(req);
  const [checklist] = await pool.query('SELECT doc_key, status, note, updated_at FROM tbl_child_admission_checklist WHERE child_id = ?', [row.child_id]);
  const [files] = await pool.query(
    `SELECT f.file_id, f.doc_key, f.original_name, f.mime_type, f.uploaded_at, f.superseded_at, u.full_name AS uploaded_by_name
       FROM tbl_child_admission_files f LEFT JOIN tbl_users u ON u.user_id = f.uploaded_by WHERE f.child_id = ? ORDER BY f.uploaded_at DESC, f.file_id DESC`, [row.child_id]);
  const [hist] = await pool.query(
    `SELECT h.from_status, h.to_status, h.note, h.created_at, u.full_name AS actor_name FROM tbl_child_admission_history h
       LEFT JOIN tbl_users u ON u.user_id = h.actor_id WHERE h.child_id = ? ORDER BY h.created_at, h.history_id`, [row.child_id]);
  if (admin && row.admission_status === 'Pending Approval' && !d.read_only) {
    await pool.query('UPDATE tbl_child_admissions SET reviewed_at = NOW(), reviewed_by = ? WHERE child_id = ?', [req.user.user_id, row.child_id]);
    await logActivity(req, 'ADMISSION_REVIEWED', `Child ${row.child_id}`);
  } else {
    await logActivity(req, 'ADMISSION_VIEWED', `Child ${row.child_id}`);
  }
  const editable = A.EDITABLE.includes(row.admission_status) && !d.read_only && (admin || d.admission_creator);
  const guardians = (() => { try { return JSON.parse(dec(row.guardians_enc) || '[]'); } catch { return []; } })();
  const sensitiveOk = {};
  for (const c of A.CHECKLIST) if (c.level === 'sensitive') sensitiveOk[c.key] = await canOpen(req, row, c.key);
  let assignment = row.status !== A.CHILD_STATUS ? await assignmentStatus(pool, row.child_id) : null;
  // Staff never see who is assigned to a child (only whether it is them).
  if (assignment && !admin) {
    assignment = assignment.assigned && assignment.user_id === req.user.user_id ? { assigned: true, you: true, label: 'Assigned to you' }
      : { assigned: assignment.assigned, label: assignment.assigned ? 'Assigned to a case worker' : 'Unassigned — awaiting case assignment' };
  }
  return {
    child_id: row.child_id, status: row.status, admission_status: row.admission_status, current_step: Number(row.current_step) || 1,
    created_by: { user_id: row.created_by, name: row.created_by_name, role: row.created_by_role }, created_at: row.created_at, updated_at: row.updated_at,
    submitted_at: row.submitted_at, submitted_by_name: row.submitted_by_name, submit_count: Number(row.submit_count) || 0,
    decision: row.decision ? { decision: row.decision, note: row.decision_note, at: row.decided_at, by: row.decided_by_name } : null,
    approved_at: row.approved_at, approved_by_name: row.approved_by_name, assignment,
    basic: { first_name: row.first_name, last_name: row.last_name, full_name: row.full_name, gender: row.gender, dob: row.dob,
      admission_date: row.admission_date, place_of_birth: row.place_of_birth, has_photo: Boolean(row.profile_photo_path) },
    referral: { referral_source: row.referral_source, referring_agency: row.referring_agency, referring_person: row.referring_person,
      referring_contact: dec(row.referring_contact_enc), referral_date: row.referral_date, referral_reference: row.referral_reference,
      reason: dec(row.reason_enc), background_care_info: dec(row.background_care_info) },
    family: { parents_unknown: Boolean(row.parents_unknown), guardians, siblings: dec(row.siblings_enc), family_notes: dec(row.guardian_family_info) },
    checklist: A.CHECKLIST.map((c) => {
      const mark = checklist.find((x) => x.doc_key === c.key);
      const copies = files.filter((f) => f.doc_key === c.key);
      return { key: c.key, label: c.label, sensitive: c.level === 'sensitive', status: mark?.status || null, note: mark?.note || null,
        can_open: c.level === 'sensitive' ? sensitiveOk[c.key] : true,
        files: copies.map((f) => ({ file_id: f.file_id, original_name: f.original_name, mime_type: f.mime_type, uploaded_at: f.uploaded_at, uploaded_by_name: f.uploaded_by_name, superseded: Boolean(f.superseded_at) })) };
    }),
    history: hist,
    problems: problems(row, checklist),
    can: { edit: editable, submit: editable, review: admin && !d.read_only && row.admission_status === 'Pending Approval',
      decline: admin && !d.read_only && ['Pending Approval', 'Needs Correction'].includes(row.admission_status) },
    options: { steps: A.STEPS, referral_sources: A.REFERRAL_SOURCES, relationships: A.RELATIONSHIPS, guardian_status: A.GUARDIAN_STATUS,
      check_statuses: A.CHECK_STATUSES, file_types: A.FILE_TYPES, file_max_mb: A.FILE_MAX_MB, max_guardians: A.MAX_GUARDIANS },
  };
}

async function assignmentStatus(conn, childId) {
  const rows = await require('./assignment').active(conn, 'child', String(childId));
  const p = rows.find((r) => r.assignment_type === 'primary') || rows[0];
  if (!p) return { assigned: false, label: 'Unassigned — awaiting case assignment' };
  const [[u]] = await conn.query('SELECT full_name FROM tbl_users WHERE user_id = ?', [p.user_id]);
  return { assigned: true, user_id: p.user_id, name: u?.full_name || null, label: `Assigned to ${u?.full_name || 'staff member'}` };
}

/** GET /api/admissions - Admin: every admission (default: waiting for review); Staff: the admissions they created. */
async function list(req, query = {}) {
  const admin = isAdmin(req);
  const where = []; const params = [];
  const status = query.status && query.status !== 'all' ? oneOf(query.status, A.STATUSES, 'status') : null;
  if (status) { where.push('c.admission_status = ?'); params.push(status); } else if (admin && !query.status) where.push("c.admission_status = 'Pending Approval'");
  if (!admin) { where.push('adm.created_by = ?'); params.push(req.user.user_id); }
  const [rows] = await pool.query(
    `SELECT c.child_id, c.first_name, c.last_name, c.full_name, c.status, c.admission_status, adm.created_at, adm.submitted_at, adm.updated_at,
            adm.decided_at, adm.decision, adm.decision_note, adm.current_step, adm.submit_count, cu.full_name AS created_by_name
       FROM tbl_child_admissions adm JOIN tbl_children c ON c.child_id = adm.child_id LEFT JOIN tbl_users cu ON cu.user_id = adm.created_by
       ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY FIELD(c.admission_status, 'Pending Approval', 'Needs Correction', 'Draft', 'Admitted', 'Declined'), COALESCE(adm.submitted_at, adm.updated_at, adm.created_at) DESC
      LIMIT 200`, params);
  const [counts] = await pool.query(
    `SELECT c.admission_status AS s, COUNT(*) AS n FROM tbl_child_admissions adm JOIN tbl_children c ON c.child_id = adm.child_id
      ${admin ? '' : 'WHERE adm.created_by = ?'} GROUP BY c.admission_status`, admin ? [] : [req.user.user_id]);
  await logActivity(req, `ADMISSION_LIST_VIEWED (${rows.length} rows)`, 'Admissions');
  return {
    rows: rows.map((r) => ({
      child_id: r.child_id, admission_status: r.admission_status, created_by_name: r.created_by_name, created_at: r.created_at, submitted_at: r.submitted_at,
      updated_at: r.updated_at, decided_at: r.decided_at, current_step: r.current_step, submit_count: Number(r.submit_count) || 0,
      // Staff: the full name only while the admission is theirs to work on; afterwards first name and last initial.
      name: admin || A.OPEN.includes(r.admission_status) ? r.full_name : Policy.displayName(r),
      decision_note: ['Needs Correction', 'Declined'].includes(r.admission_status) ? r.decision_note : null,
    })),
    counts: Object.fromEntries(A.STATUSES.map((s) => [s, Number(counts.find((c) => c.s === s)?.n || 0)])),
  };
}

// ---------------------------------------------------------------- submit and decisions
async function submit(req, childId) {
  const { row } = await access(req, childId, 'edit');
  const [checklist] = await pool.query('SELECT doc_key FROM tbl_child_admission_checklist WHERE child_id = ?', [row.child_id]);
  const p = problems(row, checklist);
  if (p.length) throw new HttpError(422, 'Complete the admission before submitting it.', { problems: p });
  await withTransaction(async (conn) => {
    const cur = await load(conn, row.child_id, true);
    if (!A.EDITABLE.includes(cur.admission_status)) throw new HttpError(409, 'This admission was already submitted.');
    await conn.query("UPDATE tbl_children SET admission_status = 'Pending Approval' WHERE child_id = ?", [row.child_id]);
    await conn.query('UPDATE tbl_child_admissions SET submitted_at = NOW(), submitted_by = ?, submit_count = submit_count + 1, updated_at = NOW() WHERE child_id = ?',
      [req.user.user_id, row.child_id]);
    await history(conn, row.child_id, cur.admission_status, 'Pending Approval', cur.admission_status === 'Needs Correction' ? 'Resubmitted after correction' : 'Submitted for Admin approval', req.user.user_id);
    await logActivityWith(conn, req, `ADMISSION_SUBMITTED${cur.admission_status === 'Needs Correction' ? ' (resubmitted)' : ''}`, `Child ${row.child_id}`);
    await Notify.toAdmins(conn, 'admin_admission_submitted', { entityType: 'child', entityId: row.child_id, params: ref(row.child_id),
      exceptUserId: req.user.user_id, groupKey: `admission_submitted:${row.child_id}:${(Number(cur.submit_count) || 0) + 1}` });
  });
  return { message: A.MESSAGES.submitted };
}

async function notifyCreator(conn, row, type, params) {
  if (row.created_by_role !== 'Staff') return;
  await Notify.emit(conn, type, { userId: row.created_by, entityType: 'child', entityId: row.child_id, params: { ...ref(row.child_id), ...params } });
}

/**
 * POST /api/admissions/:id/approve { case_worker_id? } (Admin). The child becomes Active (Admitted). Then the
 * assignment decides who keeps working on it: an Admin may assign the case worker here (the default case worker
 * from Settings is suggested). The creator keeps access only if assigned; otherwise their admission access ends.
 */
async function approve(req, childId, body = {}) {
  const { row } = await access(req, childId, 'decide');
  const cw = body.case_worker_id ? Number(body.case_worker_id) : null;
  const out = await withTransaction(async (conn) => {
    const cur = await load(conn, row.child_id, true);
    if (cur.admission_status !== 'Pending Approval') throw new HttpError(409, 'Only an admission waiting for approval can be approved.');
    await conn.query("UPDATE tbl_children SET status = 'Active', admission_status = 'Admitted' WHERE child_id = ?", [row.child_id]);
    await conn.query(`UPDATE tbl_child_admissions SET decided_at = NOW(), decided_by = ?, decision = 'Approved', decision_note = ?, approved_at = NOW(), approved_by = ?,
      updated_at = NOW() WHERE child_id = ?`, [req.user.user_id, text(body.note, 2000), req.user.user_id, row.child_id]);
    await history(conn, row.child_id, 'Pending Approval', 'Admitted', text(body.note, 2000) || 'Approved', req.user.user_id);
    if (cw) await require('./assignment').add(conn, req, 'child', row.child_id, { userId: cw, type: 'primary', source: 'admin', reference: row.child_id, note: 'Assigned at admission approval' });
    const assignment = await assignmentStatus(conn, row.child_id);
    await logActivityWith(conn, req, `ADMISSION_APPROVED (${assignment.assigned ? 'case worker assigned' : 'unassigned'})`, `Child ${row.child_id}`);
    // "Creating a child record does not mean owning the child record."
    let creatorAssigned = null;
    if (cur.created_by_role === 'Staff') {
      creatorAssigned = Boolean(await require('./assignment').assignmentOf(conn, 'child', row.child_id, cur.created_by));
      if (!creatorAssigned) await Policy.endInitialAccess(conn, req, row.child_id, 'admission_approved');
      await logActivityWith(conn, req, creatorAssigned ? 'ADMISSION_CREATOR_ASSIGNED (continues as case worker)' : 'ADMISSION_CREATOR_ACCESS_ENDED (not assigned)', `Child ${row.child_id}`);
      await notifyCreator(conn, cur, 'admission_approved', { assigned: creatorAssigned });
    }
    if (!assignment.assigned) await Notify.toAdmins(conn, 'admin_children_unassigned', { params: { count: 1 }, groupKey: `admission_unassigned:${row.child_id}` });
    return { assignment, creator_assigned: creatorAssigned };
  });
  return { ...out, message: A.MESSAGES.approved };
}

async function returnForCorrection(req, childId, body = {}) {
  const note = text(body.note, 2000);
  if (!note) fail({ note: 'Tell the staff member what to correct.' });
  const { row } = await access(req, childId, 'decide');
  await withTransaction(async (conn) => {
    const cur = await load(conn, row.child_id, true);
    if (cur.admission_status !== 'Pending Approval') throw new HttpError(409, 'Only an admission waiting for approval can be returned.');
    await conn.query("UPDATE tbl_children SET admission_status = 'Needs Correction' WHERE child_id = ?", [row.child_id]);
    await conn.query("UPDATE tbl_child_admissions SET decided_at = NOW(), decided_by = ?, decision = 'Returned', decision_note = ?, updated_at = NOW() WHERE child_id = ?",
      [req.user.user_id, note, row.child_id]);
    await history(conn, row.child_id, 'Pending Approval', 'Needs Correction', note, req.user.user_id);
    await logActivityWith(conn, req, 'ADMISSION_RETURNED', `Child ${row.child_id}`);
    await notifyCreator(conn, cur, 'admission_returned', {});
  });
  return { message: A.MESSAGES.returned };
}

async function decline(req, childId, body = {}) {
  const reason = text(body.reason, 2000);
  if (!reason) fail({ reason: 'Give the reason for declining.' });
  const { row } = await access(req, childId, 'decide');
  await withTransaction(async (conn) => {
    const cur = await load(conn, row.child_id, true);
    if (!['Pending Approval', 'Needs Correction'].includes(cur.admission_status)) throw new HttpError(409, 'Only a submitted admission can be declined.');
    await conn.query("UPDATE tbl_children SET admission_status = 'Declined' WHERE child_id = ?", [row.child_id]);
    await conn.query("UPDATE tbl_child_admissions SET decided_at = NOW(), decided_by = ?, decision = 'Declined', decision_note = ?, updated_at = NOW() WHERE child_id = ?",
      [req.user.user_id, reason, row.child_id]);
    await history(conn, row.child_id, cur.admission_status, 'Declined', reason, req.user.user_id);
    await logActivityWith(conn, req, 'ADMISSION_DECLINED', `Child ${row.child_id}`);
    await notifyCreator(conn, cur, 'admission_declined', {});
  });
  return { message: A.MESSAGES.declined };
}

/** Staff the approval dialog can assign (active, Child records duty), and the default case worker from Settings. */
async function assignOptions() {
  const [rows] = await pool.query(
    `SELECT u.user_id, u.full_name FROM tbl_users u JOIN tbl_roles r ON r.role_id = u.role_id
      WHERE u.is_active = TRUE AND r.role_name = 'Staff' AND EXISTS (SELECT 1 FROM tbl_staff_duties d WHERE d.user_id = u.user_id AND d.duty = 'children')
      ORDER BY u.full_name`);
  const s = await Policy.settings();
  return { staff: rows, default_case_worker_id: s.child_default_case_worker_id ? Number(s.child_default_case_worker_id) : null };
}

module.exports = { access, detail, list, create, saveStep, uploadFile, file, submit, approve, returnForCorrection, decline, assignOptions, problems, assignmentStatus };
