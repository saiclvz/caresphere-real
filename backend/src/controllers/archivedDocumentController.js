/**
 * Data protection > Archived documents (Admin). Files uploaded under retired document types are archived
 * (migration 028): hidden from every screen and API, no view or download. This list shows only the
 * application reference, the document type and the upload date, and lets Admin securely dispose of a file
 * (data minimization, RA 10173): confirmation and a reason are required, and the action is logged. The row
 * stays as a record that the file existed and was disposed of; the file itself is overwritten and removed.
 */
const { pool, withTransaction } = require('../config/db');
const HttpError = require('../utils/HttpError');
const { secureDeleteUpload } = require('../utils/files');
const { logActivityWith } = require('../utils/audit');
const { toInt } = require('../utils/validate');

/** Names for this Admin list only (the types are retired and shown nowhere else). */
const TYPE_NAMES = {
  divorce_or_death_certificate: 'Divorce decree or death certificate',
  child_abuse_clearance: 'Child abuse clearance',
  fingerprint_clearance: 'Fingerprint clearance record',
};

/** GET /api/archived-documents (Admin) */
exports.list = async (req, res) => {
  const [rows] = await pool.query(
    `SELECT d.document_id, a.reference_no, d.doc_type, d.uploaded_at, d.disposed_at
       FROM tbl_adoption_documents d JOIN tbl_adoption_applications a ON a.application_id = d.application_id
      WHERE d.archived_at IS NOT NULL AND d.doc_type IN (?) ORDER BY d.disposed_at IS NOT NULL, d.uploaded_at`, [Object.keys(TYPE_NAMES)]);
  res.json({
    success: true,
    data: {
      pending: rows.filter((r) => !r.disposed_at).map((r) => ({ document_id: r.document_id, reference_no: r.reference_no || 'Draft', document_type: TYPE_NAMES[r.doc_type] || 'Archived document', uploaded_at: r.uploaded_at })),
      disposed_count: rows.filter((r) => r.disposed_at).length,
    },
  });
};

/** POST /api/archived-documents/:id/dispose (Admin) { confirm: true, reason } */
exports.dispose = async (req, res) => {
  const id = toInt(req.params.id, 'id', { min: 1 });
  if (req.body?.confirm !== true) throw new HttpError(400, 'Confirm that you want to dispose of this file permanently.');
  const reason = String(req.body?.reason || '').trim();
  if (reason.length < 10) throw new HttpError(400, 'Give the reason for disposal (at least 10 characters).');
  if (reason.length > 500) throw new HttpError(400, 'The reason can be up to 500 characters.');
  await withTransaction(async (conn) => {
    const [[d]] = await conn.query('SELECT document_id, doc_type, storage_key, archived_at, disposed_at FROM tbl_adoption_documents WHERE document_id = ? FOR UPDATE', [id]);
    // Only retired document types (migration 028); removed or replaced copies are kept, never disposed of here.
    if (!d || !d.archived_at || !TYPE_NAMES[d.doc_type]) throw new HttpError(404, 'Archived document not found. Only archived documents can be disposed of.');
    if (d.disposed_at) throw new HttpError(409, 'This file was already disposed of.');
    await conn.query('UPDATE tbl_adoption_documents SET disposed_at = NOW(), disposed_by = ?, dispose_reason = ? WHERE document_id = ?', [req.user.user_id, reason, id]);
    await logActivityWith(conn, req, `ARCHIVED_DOCUMENT_DISPOSED (#${id})`, 'Data protection');
    // The file is removed last, after the row and the log entry: if anything above fails, nothing is removed.
    secureDeleteUpload(d.storage_key);
  });
  res.json({ success: true, data: { document_id: id, disposed: true } });
};
