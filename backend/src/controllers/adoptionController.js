const { pool, withTransaction } = require('../config/db');
const Adoption = require('../models/adoptionModel');
const Child = require('../models/childModel');
const HttpError = require('../utils/HttpError');
const { saveUpload, readUpload, MB } = require('../utils/files');
const { requireText, requireDate, ageOn, isEmail, oneOf, toInt, trimOrNull } = require('../utils/validate');
const { logActivity } = require('../utils/audit');

const CIVIL_STATUSES = ['Single', 'Married', 'Widowed', 'Separated', 'Annulled'];
const DOC_OPTS = { folder: 'adoption-docs', allowed: ['pdf', 'png', 'jpg'], maxBytes: 10 * MB };
const UPLOADABLE = ['Submitted', 'Under Review', 'Additional Documents Required'];

// Who may move an application to which status.
const STAFF_TARGETS = ['Under Review', 'Additional Documents Required'];
const ADMIN_TARGETS = ['Under Review', 'Additional Documents Required', 'Approved', 'Rejected', 'Completed'];

async function loadForUser(req, id) {
  const app = await Adoption.findById(toInt(id, 'id', { min: 1 }));
  if (!app) throw new HttpError(404, 'Application not found.');
  if (req.user.role === 'Donor' && app.applicant_id !== req.user.user_id) {
    throw new HttpError(403, 'You can only view your own applications.');
  }
  return app;
}

function docStatus(documents) {
  return Object.entries(Adoption.DOC_TYPES).map(([type, meta]) => ({
    doc_type: type, label: meta.label, required: meta.required,
    status: documents.some((d) => d.doc_type === type) ? 'Submitted' : 'Missing',
  }));
}

async function fullApplication(req, app) {
  const [documents, reviews] = await Promise.all([Adoption.documents(app.application_id), Adoption.reviews(app.application_id)]);
  const data = { ...app, documents, document_checklist: docStatus(documents), reviews };
  if (req.user.role === 'Donor') {
    // Applicants (Donor accounts) see a privacy name for the child and no internal fields.
    delete data.child_full_name;
    data.reviews = reviews.map(({ status_from, status_to, note, created_at }) => ({ status_from, status_to, note, created_at }));
  }
  return data;
}

/** GET /api/adoptions/document-types */
exports.documentTypes = async (req, res) => {
  res.json({ success: true, data: Object.entries(Adoption.DOC_TYPES).map(([doc_type, m]) => ({ doc_type, ...m })) });
};

/** POST /api/adoptions (Donor) - the 6-section application form (documents are uploaded next). */
exports.submit = async (req, res) => {
  const b = req.body;
  // 1. Applicant information
  const legal_name = requireText(b.legal_name, 'Legal name is required.', 150);
  const date_of_birth = requireDate(String(b.date_of_birth || '').trim(), 'Date of birth');
  if (ageOn(date_of_birth) < 18) throw new HttpError(400, 'Applicants must be at least 18 years old.');
  const contact_number = requireText(b.contact_number, 'Contact number is required.', 30);
  if (!/^[+\d][\d\s-]{6,19}$/.test(contact_number)) throw new HttpError(400, 'Enter a valid contact number.');
  const email = requireText(b.email, 'Email is required.', 100).toLowerCase();
  if (!isEmail(email)) throw new HttpError(400, 'Enter a valid email address.');
  const address = requireText(b.address, 'Address is required.', 1000);
  const civil_status = oneOf(b.civil_status, CIVIL_STATUSES, 'Civil status');
  const occupation = requireText(b.occupation, 'Occupation is required.', 150);
  const employment_details = requireText(b.employment_details, 'Employment details are required.', 2000);
  // 2. Family and household
  const spouse_details = civil_status === 'Married'
    ? requireText(b.spouse_details, 'Spouse / co-applicant details are required for married applicants.', 2000)
    : trimOrNull(b.spouse_details, 2000);
  const household_members = requireText(b.household_members, 'Household members are required.', 3000);
  const living_conditions = requireText(b.living_conditions, 'Living conditions are required.', 3000);
  const caregiving_experience = requireText(b.caregiving_experience, 'Caregiving experience is required.', 3000);
  // 3. Child selection
  const childId = requireText(b.child_id, 'Select a child.', 50);
  const eligible = await Child.publicEligible([childId], { forAdoption: true });
  if (!eligible.length) throw new HttpError(400, 'The selected child is not available for adoption applications.');
  if (await Adoption.hasOpenApplication(req.user.user_id, childId)) {
    throw new HttpError(409, 'You already have an open application for this child.');
  }
  // 5. Reason, 6. Declaration
  const reason_for_adoption = requireText(b.reason_for_adoption, 'Reason for adoption is required.', 5000);
  if (b.declaration_accepted !== true) {
    throw new HttpError(400, 'You must confirm the declaration and privacy consent to submit.');
  }

  const id = await withTransaction(async (conn) => {
    const reference_no = await Adoption.nextReference(conn);
    return Adoption.insert(conn, {
      reference_no, applicant_id: req.user.user_id, child_id: childId, legal_name, date_of_birth, contact_number, email,
      address, civil_status, occupation, employment_details, spouse_details, household_members, living_conditions,
      caregiving_experience, reason_for_adoption,
    });
  });
  await logActivity(req, 'SUBMIT_ADOPTION_APPLICATION', `Application #${id}`);
  res.status(201).json({ success: true, data: await fullApplication(req, await Adoption.findById(id)) });
};

/** POST /api/adoptions/:id/documents  { doc_type, file: { name, data } } - max 10 MB, PDF/PNG/JPG */
exports.uploadDocument = async (req, res) => {
  const app = await loadForUser(req, req.params.id);
  if (req.user.role === 'Staff') throw new HttpError(403, 'Staff can review documents but not upload them.');
  if (!UPLOADABLE.includes(app.status)) throw new HttpError(409, `Documents can no longer be added to an application that is ${app.status}.`);
  const docType = oneOf(req.body.doc_type, Object.keys(Adoption.DOC_TYPES), 'Document type');
  const saved = saveUpload(req.body.file, { ...DOC_OPTS, label: Adoption.DOC_TYPES[docType].label });
  await Adoption.insertDocument({ ...saved, application_id: app.application_id, doc_type: docType, uploaded_by: req.user.user_id });
  await logActivity(req, 'UPLOAD_ADOPTION_DOCUMENT', `Application #${app.application_id}`);
  res.status(201).json({ success: true, data: await fullApplication(req, app) });
};

/** GET /api/adoptions/:id/documents/:docId - applicant (own) or Admin/Staff */
exports.downloadDocument = async (req, res) => {
  const app = await loadForUser(req, req.params.id);
  const doc = await Adoption.document(app.application_id, toInt(req.params.docId, 'docId', { min: 1 }));
  if (!doc) throw new HttpError(404, 'Document not found.');
  if (req.user.role !== 'Donor') await logActivity(req, 'VIEW_ADOPTION_DOCUMENT', `Application #${app.application_id}`);
  res.setHeader('Content-Type', doc.mime_type);
  res.setHeader('Content-Disposition', `inline; filename="${doc.original_name.replace(/"/g, '')}"`);
  res.setHeader('Cache-Control', 'no-store');
  res.send(readUpload(doc.storage_key));
};

/** GET /api/adoptions/mine (Donor) */
exports.mine = async (req, res) => {
  res.json({ success: true, data: await Adoption.list({ applicantId: req.user.user_id, search: req.query.q }) });
};

/** GET /api/adoptions (Admin, Staff) */
exports.list = async (req, res) => {
  const status = req.query.status ? oneOf(req.query.status, Adoption.STATUSES, 'status') : undefined;
  res.json({ success: true, data: await Adoption.list({ status, search: req.query.q }) });
};

/** GET /api/adoptions/:id */
exports.getOne = async (req, res) => {
  const app = await loadForUser(req, req.params.id);
  res.json({ success: true, data: await fullApplication(req, app) });
};

/** POST /api/adoptions/:id/notes (Admin, Staff) { note } */
exports.addNote = async (req, res) => {
  const app = await loadForUser(req, req.params.id);
  const note = requireText(req.body.note, 'Write a review note.', 5000);
  await withTransaction((conn) => Adoption.addReview(conn, { application_id: app.application_id, reviewer_id: req.user.user_id, note }));
  await logActivity(req, 'ADD_ADOPTION_NOTE', `Application #${app.application_id}`);
  res.status(201).json({ success: true, data: await fullApplication(req, app) });
};

/**
 * PUT /api/adoptions/:id/status (Admin, Staff) { status, note }
 *  - Staff: Under Review or Additional Documents Required only.
 *  - Approved does NOT change the child's status.
 *  - Completed (from Approved only) sets the child to Adopted and closes other open applications for that child.
 */
exports.updateStatus = async (req, res) => {
  const app = await loadForUser(req, req.params.id);
  const target = oneOf(req.body.status, Adoption.STATUSES, 'status');
  const allowed = req.user.role === 'Admin' ? ADMIN_TARGETS : STAFF_TARGETS;
  if (!allowed.includes(target)) throw new HttpError(403, `Your role cannot set an application to ${target}.`);
  if (target === app.status) throw new HttpError(400, `The application is already ${target}.`);
  if (['Rejected', 'Completed'].includes(app.status)) throw new HttpError(409, `A ${app.status.toLowerCase()} application cannot be changed.`);

  const note = trimOrNull(req.body.note, 5000);
  if (target === 'Additional Documents Required' && !note) throw new HttpError(400, 'Say which documents are needed.');
  if (target === 'Rejected' && !note) throw new HttpError(400, 'Give a reason for rejecting the application.');
  if (target === 'Approved') {
    const missing = docStatus(await Adoption.documents(app.application_id)).filter((d) => d.required && d.status === 'Missing');
    if (missing.length) throw new HttpError(409, `Required documents are missing: ${missing.map((d) => d.label).join(', ')}.`);
    if (app.child_status !== 'Active') throw new HttpError(409, `The child is ${app.child_status.toLowerCase()} and cannot be approved for adoption.`);
  }
  if (target === 'Completed') {
    if (app.status !== 'Approved') throw new HttpError(409, 'Only an Approved application can be marked Completed.');
    if (app.child_status !== 'Active') throw new HttpError(409, `The child is already ${app.child_status.toLowerCase()}.`);
  }

  await withTransaction(async (conn) => {
    await conn.query(
      `UPDATE tbl_adoption_applications SET status = ?, completed_at = ${target === 'Completed' ? 'NOW()' : 'completed_at'}
        WHERE application_id = ?`, [target, app.application_id]);
    await Adoption.addReview(conn, { application_id: app.application_id, reviewer_id: req.user.user_id, status_from: app.status, status_to: target, note });

    if (target === 'Completed') {
      // The formal legal process is complete: only now does the child become Adopted.
      await conn.query("UPDATE tbl_children SET status = 'Adopted' WHERE child_id = ?", [app.child_id]);
      const [others] = await conn.query(
        'SELECT application_id, status FROM tbl_adoption_applications WHERE child_id = ? AND application_id <> ? AND status IN (?)',
        [app.child_id, app.application_id, Adoption.OPEN]);
      for (const o of others) {
        await conn.query("UPDATE tbl_adoption_applications SET status = 'Rejected' WHERE application_id = ?", [o.application_id]);
        await Adoption.addReview(conn, { application_id: o.application_id, reviewer_id: req.user.user_id, status_from: o.status,
          status_to: 'Rejected', note: 'Closed automatically: the child has been adopted.' });
      }
    }
  });
  await logActivity(req, `ADOPTION_${target.toUpperCase().replace(/\s+/g, '_')}`, `Application #${app.application_id}`);
  if (target === 'Completed') await logActivity(req, 'CHILD_ADOPTED', `Child ${app.child_id}`);
  res.json({ success: true, data: await fullApplication(req, await Adoption.findById(app.application_id)) });
};

/** GET /api/adoptions/summary - counts per status for the sidebar/overview */
exports.summary = async (req, res) => {
  const [rows] = await pool.query('SELECT status, COUNT(*) AS n FROM tbl_adoption_applications GROUP BY status');
  res.json({ success: true, data: Object.fromEntries(rows.map((r) => [r.status, Number(r.n)])) });
};

