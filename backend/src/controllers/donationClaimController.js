const HttpError = require('../utils/HttpError');
const Claims = require('../services/donationClaims');
const QR = require('../services/paymentQr');
const Recon = require('../services/reconciliation');
const Cash = require('../services/cashControls');
const { toInt } = require('../utils/validate');

const id = (req, name = 'id') => toInt(req.params[name], name, { min: 1 });
const ok = (res, data, status = 200) => res.status(status).json({ success: true, data });

// ---- donor
exports.donateOptions = async (req, res) => ok(res, await Claims.donateOptions(req));
exports.report = async (req, res) => { const out = await Claims.report(req, req.body); ok(res, out, out.replayed ? 200 : 201); };
exports.withdraw = async (req, res) => ok(res, await Claims.withdraw(req, id(req)));
exports.addInfo = async (req, res) => ok(res, await Claims.addInfo(req, id(req), req.body));
exports.history = async (req, res) => ok(res, await Claims.donorHistory(req));
exports.reportQrProblem = async (req, res) => ok(res, await QR.reportProblem(req, req.body), 201);

// ---- staff: To verify
exports.queue = async (req, res) => ok(res, await Claims.queue(req));
exports.verify = async (req, res) => ok(res, await Claims.verify(req, id(req), req.body));
exports.decide = async (req, res) => ok(res, await Claims.decide(req, id(req), req.body));
exports.notMatched = async (req, res) => ok(res, await Claims.notMatched(req, id(req), req.body));
exports.requestDetails = async (req, res) => ok(res, await Claims.requestDetails(req, id(req), req.body));
exports.reopen = async (req, res) => ok(res, await Claims.reopen(req, id(req), req.body));
exports.internalNote = async (req, res) => { await Claims.internalNote(req, id(req), req.body); ok(res, { ok: true }, 201); };

// ---- reconciliation
exports.reconciliation = async (req, res) => ok(res, await Recon.overview(req));
exports.importStatement = async (req, res) => ok(res, await Recon.importStatement(req, req.body), 201);
exports.convertLine = async (req, res) => ok(res, await Recon.convert(req, id(req), req.body), 201);
exports.dismissLine = async (req, res) => { await Recon.dismiss(req, id(req), req.body); ok(res, { ok: true }); };

// ---- cash
exports.confirmCash = async (req, res) => { await Cash.confirmCash(req, id(req)); ok(res, { ok: true }); };
exports.cashCounts = async (req, res) => ok(res, await Cash.list(req));
exports.submitCashCount = async (req, res) => ok(res, await Cash.submit(req, req.body), 201);
exports.signOffCashCount = async (req, res) => { await Cash.signOff(req, id(req)); ok(res, { ok: true }); };

// ---- Settings > Payment QR (Admin)
exports.qrList = async (req, res) => ok(res, await QR.adminList(req));
exports.qrPreview = async (req, res) => ok(res, await QR.preview(req, req.body));
exports.qrRequestChange = async (req, res) => ok(res, await QR.requestChange(req, req.body), 201);
exports.qrApprove = async (req, res) => ok(res, await QR.approve(req, id(req), req.body));
exports.qrReject = async (req, res) => ok(res, await QR.reject(req, id(req), req.body));
exports.qrCancel = async (req, res) => ok(res, await QR.reject(req, id(req), req.body, { cancel: true }));
exports.qrUpdateMethod = async (req, res) => ok(res, await QR.updateSettings(req, id(req), req.body));
exports.qrConfirm = async (req, res) => { await QR.confirm(req, id(req)); ok(res, { ok: true }); };
exports.qrVersions = async (req, res) => ok(res, await QR.versions(req, id(req)));
exports.qrResolveProblem = async (req, res) => { await QR.resolveProblem(req, id(req), req.body); ok(res, { ok: true }); };
exports.qrSheet = async (req, res) => ok(res, await QR.sheet(req));

// ---- re-authentication
exports.reauth = async (req, res) => ok(res, await require('../services/reauth').start(req, req.body));

/**
 * GET /api/files/:token - the only way donation files, QR images and acknowledgments are served: a short-lived
 * signed link for the signed-in user (utils/signedLinks.js), and the record's own permission checks again.
 */
exports.file = async (req, res) => {
  const links = require('../utils/signedLinks');
  const { kind, id: fileId } = links.verify(req.params.token, req.user);
  const send = (f) => {
    res.setHeader('Content-Type', f.mime);
    res.setHeader('Content-Disposition', `inline; filename="${String(f.name).replace(/["\r\n]/g, '')}"`);
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.send(f.body);
  };
  if (kind === 'qr') return send(await QR.imageFor(req, fileId));
  if (kind === 'qr_change') return send(await QR.changeImage(req, fileId));
  const D = require('./donationController');
  if (kind === 'donation_doc') return D.sendDocument(req, res, fileId);
  if (kind === 'receipt') return D.sendReceipt(req, res, fileId);
  throw new HttpError(404, 'Not found.');
};
