const HttpError = require('../utils/HttpError');
const { readUpload, verifyUpload } = require('../utils/files');
const { logActivity } = require('../utils/audit');
const P = require('../services/protectedRecords');
const { watermarkFile } = require('../services/watermark');
const { pool } = require('../config/db');

/**
 * GET /api/protected/:publicId (Admin, Staff)
 * Admin: the record description. Staff: always { requires_token: true } unless they already
 * hold a live grant (so a wrong ID and a real one look the same before a token is entered).
 */
exports.lookup = async (req, res) => {
  if (req.user.role === 'Admin') {
    const record = await P.findByPublicId(req.params.publicId);
    if (!record) throw new HttpError(404, 'Protected record not found.');
    const d = await P.describe(record);
    return res.json({ success: true, data: { ...d, requires_token: false, requires_sealed_reason: d.sealed } });
  }
  try {
    const record = await P.resolveAccess(req, req.params.publicId);
    return res.json({ success: true, data: { ...(await P.describe(record)), requires_token: false } });
  } catch {
    return res.json({ success: true, data: { requires_token: true } });
  }
};

/** POST /api/protected/:publicId/unlock (Staff) { token, reason?, order_number? } -> short grant. */
exports.unlock = async (req, res) => {
  if (req.user.role !== 'Staff') throw new HttpError(403, P.DENIED);
  res.json({ success: true, data: await P.unlockWithToken(req, req.params.publicId, req.body || {}) });
};

/** POST /api/protected/:publicId/open-sealed (Admin) { reason, order_number } -> short grant. */
exports.openSealed = async (req, res) => {
  res.json({ success: true, data: await P.openSealedAsAdmin(req, req.params.publicId, req.body || {}) });
};

async function sendRecord(req, res, { download }) {
  const record = await P.resolveAccess(req, req.params.publicId);
  const file = await P.fileFor(record);
  if (!file) throw new HttpError(404, 'This record has no file yet.');
  const isAdmin = req.user.role === 'Admin';
  if (download && !isAdmin && !record.allow_download) throw new HttpError(403, 'Downloading this record is not allowed.');
  const verified = verifyUpload(file.storage_key, file.sha256);
  let body = readUpload(file.storage_key);
  let mime = file.mime_type;
  // Staff always see a watermarked copy; downloads (Admin or Staff) are always watermarked.
  if (download || !isAdmin) { body = await watermarkFile(body, file.mime_type, req.user); mime = 'application/pdf'; }
  await P.log(download ? 'download' : 'view', { req, recordId: record.record_id, detail: record.label });
  await logActivity(req, `PROTECTED_RECORD_${download ? 'DOWNLOAD' : 'VIEW'}`, `Protected #${record.record_id}`);
  const base = file.original_name.replace(/\.[^.]+$/, '').replace(/["\r\n]/g, '') || 'record';
  const ext = mime === 'application/pdf' ? 'pdf' : (file.original_name.match(/\.(\w+)$/)?.[1] || 'bin');
  res.setHeader('Content-Type', mime);
  res.setHeader('Content-Disposition', `${download ? 'attachment' : 'inline'}; filename="${base}.${ext}"`);
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-File-Verified', verified === null ? 'unknown' : String(verified));
  res.send(body);
}

/** GET /api/protected/:publicId/view (Admin, or Staff with a grant in X-Protected-Access) */
exports.view = (req, res) => sendRecord(req, res, { download: false });
/** GET /api/protected/:publicId/download (Admin, or Staff with a grant when Admin allowed downloads) */
exports.download = (req, res) => sendRecord(req, res, { download: true });

/** GET /api/protected-records?application_id=|child_id= (Admin) - for the Protected record QR cards. */
exports.listRecords = async (req, res) => {
  const applicationId = req.query.application_id ? Number(req.query.application_id) : undefined;
  const childId = req.query.child_id ? String(req.query.child_id) : undefined;
  res.json({ success: true, data: await P.listRecords({ applicationId, childId }) });
};

/** PUT /api/protected-records/:recordId (Admin) { allow_download } */
exports.updateRecord = async (req, res) => {
  const id = Number(req.params.recordId);
  const allow = req.body?.allow_download === true || req.body?.allow_download === 'true';
  const [r] = await pool.query('UPDATE tbl_protected_records SET allow_download = ? WHERE record_id = ?', [allow ? 1 : 0, id]);
  if (!r.affectedRows) throw new HttpError(404, 'Protected record not found.');
  await logActivity(req, `PROTECTED_RECORD_DOWNLOAD_${allow ? 'ALLOWED' : 'BLOCKED'}`, `Protected #${id}`);
  res.json({ success: true, data: { record_id: id, allow_download: allow } });
};

/** POST /api/protected-records/:recordId/tokens (Admin) { staff_user_id, expires_hours, max_uses, purpose } - token shown once. */
exports.issueToken = async (req, res) => {
  res.status(201).json({ success: true, data: await P.issueToken(req, Number(req.params.recordId), req.body || {}) });
};

/** POST /api/protected-tokens/:tokenId/revoke (Admin) */
exports.revokeToken = async (req, res) => {
  await P.revokeToken(req, Number(req.params.tokenId));
  res.json({ success: true, data: await P.accessOverview() });
};

/** GET /api/protected-access (Admin) - active tokens and recent protected access. */
exports.overview = async (req, res) => {
  res.json({ success: true, data: await P.accessOverview() });
};
