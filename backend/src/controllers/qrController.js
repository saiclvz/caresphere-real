const { pool } = require('../config/db');
const qr = require('../services/qrService');
const HttpError = require('../utils/HttpError');
const { requireFields, oneOf } = require('../utils/validate');
const { logActivity } = require('../utils/audit');

/**
 * POST /api/qr/generate-token  (Admin, Staff) - body { target_id } (child health records only; 60-second Token ID)
 * Staff-issued tokens can only be redeemed by the staff member who generated them.
 */
exports.generateToken = async (req, res) => {
  requireFields(req.body, ['target_id']);
  const scope = oneOf(req.body.scope || 'child', ['child'], 'scope');
  const targetId = String(req.body.target_id).trim();
  const [rows] = await pool.query('SELECT status FROM tbl_children WHERE child_id = ?', [targetId]);
  if (!rows.length) throw new HttpError(404, 'Child record not found.');

  const result = await qr.issueToken({ scope, targetId, issuedBy: req.user.user_id });
  await logActivity(req, 'TYPED_TOKEN_ISSUED', `Child ${targetId}`);
  res.status(201).json({ success: true, ...result });
};

/** POST /api/qr/validate  (Admin, Staff) - identify what a scanned code unlocks */
exports.validate = async (req, res) => {
  requireFields(req.body, ['qr_token']);
  const info = await qr.verifyToken(String(req.body.qr_token), { userId: req.user.user_id });
  res.json({ success: true, ...info });
};

/** POST /api/qr/revoke  (Admin) - end all live codes for a record early */
exports.revoke = async (req, res) => {
  requireFields(req.body, ['target_id']);
  const scope = oneOf(req.body.scope || 'child', ['child'], 'scope');
  await qr.revokeForTarget(scope, req.body.target_id);
  await logActivity(req, `QR_TOKEN_REVOKED (${scope})`, `${scope} #${req.body.target_id}`);
  res.json({ success: true, message: 'Active QR codes revoked.' });
};
