/**
 * Child admissions (migration 033): New Admission -> Steps 1-4 -> Submit for Admin Approval -> Approve, Return for
 * Correction or Decline. Every handler goes through services/admission.js, which goes through the child record
 * policy (role, Admission duty, assignment, access level and admission status are all checked on the server).
 */
const Admission = require('../services/admission');

exports.list = async (req, res) => {
  const out = await Admission.list(req, req.query);
  res.json({ success: true, data: out.rows, meta: { counts: out.counts, stale_days: out.stale_days } });
};

exports.getOne = async (req, res) => {
  res.json({ success: true, data: await Admission.detail(req, req.params.id) });
};

exports.create = async (req, res) => {
  const { child_id: id } = await Admission.create(req, req.body);
  res.status(201).json({ success: true, data: { child_id: id }, message: 'Admission started. Your progress is saved; continue with the next step.' });
};

exports.saveStep = async (req, res) => {
  await Admission.saveStep(req, req.params.id, req.params.step, req.body);
  res.json({ success: true, data: await Admission.detail(req, req.params.id), message: 'Progress saved.' });
};

exports.uploadFile = async (req, res) => {
  await Admission.uploadFile(req, req.params.id, req.params.key, req.body?.file);
  res.status(201).json({ success: true, data: await Admission.detail(req, req.params.id), message: 'Document uploaded.' });
};

exports.file = async (req, res) => {
  const { file, body } = await Admission.file(req, req.params.id, req.params.fileId);
  let out = body; let mime = file.mime_type;
  if (req.user.role === 'Staff') { out = await require('../services/watermark').watermarkFile(body, file.mime_type, req.user); mime = 'application/pdf'; }
  res.setHeader('Content-Type', mime);
  res.setHeader('Content-Disposition', `inline; filename="${String(file.original_name || 'document').replace(/["\r\n]/g, '')}"`);
  res.setHeader('Cache-Control', 'no-store');
  res.send(out);
};

exports.submit = async (req, res) => {
  const r = await Admission.submit(req, req.params.id);
  res.json({ success: true, data: await Admission.detail(req, req.params.id), message: r.message });
};

exports.approve = async (req, res) => {
  const r = await Admission.approve(req, req.params.id, req.body || {});
  res.json({ success: true, data: { assignment: r.assignment, creator_assigned: r.creator_assigned }, message: r.message });
};

exports.returnForCorrection = async (req, res) => {
  const r = await Admission.returnForCorrection(req, req.params.id, req.body || {});
  res.json({ success: true, message: r.message });
};

exports.decline = async (req, res) => {
  const r = await Admission.decline(req, req.params.id, req.body || {});
  res.json({ success: true, message: r.message });
};

exports.verifyDocument = async (req, res) => {
  const r = await Admission.verifyDocument(req, req.params.id, String(req.params.key), req.body || {});
  res.json({ success: true, data: await Admission.detail(req, req.params.id), message: r.message });
};

exports.withdraw = async (req, res) => {
  const r = await Admission.withdraw(req, req.params.id, req.body || {});
  // The creator's admission access ends with the withdrawal: Admin gets the updated record, Staff only the message.
  const data = await Admission.detail(req, req.params.id).catch((e) => { if (e.status === 403) return null; throw e; });
  res.json({ success: true, data, message: r.message });
};

exports.assignOptions = async (req, res) => {
  res.json({ success: true, data: await Admission.assignOptions() });
};
