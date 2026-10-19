/**
 * Optional proof a donor attaches to a donation report (PDF, JPG or PNG, up to 5 MB). Never required, never a
 * screenshot requirement, and never treated as verification: staff verify against the home's own account.
 *   - checked by content (file signature), not by name; size limited
 *   - scanned with ClamAV when it is installed (services/malwareScan.js); an infected file is refused
 *   - metadata removed: images are re-encoded (EXIF, GPS and camera data dropped); PDFs lose their document
 *     information and XMP metadata
 *   - stored encrypted (AES-256-GCM) under a random name; served only through short-lived signed links
 *   - the SHA-256 of the cleaned file is compared with earlier uploads: the same file on another donation is flagged
 */
const HttpError = require('../utils/HttpError');
const { saveBuffer, discardUnsavedUpload, MB } = require('../utils/files');
const { logActivityWith } = require('../utils/audit');

const MAX = 5 * MB;
const SIG = {
  pdf: (b) => b.subarray(0, 5).toString('latin1') === '%PDF-',
  png: (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  jpg: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
};

async function stripPdf(buf) {
  const { PDFDocument, PDFName } = require('pdf-lib');
  let doc;
  try { doc = await PDFDocument.load(buf, { updateMetadata: false }); } catch { throw new HttpError(422, "This PDF can't be read (it may be password-protected). Attach an unprotected PDF or an image.", { errors: { proof: "This PDF can't be read." } }); }
  doc.setTitle(''); doc.setAuthor(''); doc.setSubject(''); doc.setKeywords([]); doc.setCreator(''); doc.setProducer('');
  try { doc.catalog.delete(PDFName.of('Metadata')); } catch { /* none */ }
  return Buffer.from(await doc.save({ useObjectStreams: false }));
}

async function prepare(file) {
  if (!file || typeof file.data !== 'string' || !file.data) throw new HttpError(422, 'Choose a file, or leave proof empty (it is optional).', { errors: { proof: 'Choose a file.' } });
  const base64 = file.data.includes(',') ? file.data.slice(file.data.indexOf(',') + 1) : file.data;
  const buf = Buffer.from(base64, 'base64');
  if (!buf.length) throw new HttpError(422, 'The file is empty.', { errors: { proof: 'The file is empty.' } });
  if (buf.length > MAX) throw new HttpError(422, 'Proof must be 5 MB or smaller.', { errors: { proof: 'Up to 5 MB.' } });
  const ext = Object.keys(SIG).find((k) => SIG[k](buf));
  if (!ext) throw new HttpError(422, 'Only PDF, JPG or PNG files are accepted.', { errors: { proof: 'PDF, JPG or PNG only.' } });
  const scan = await require('./malwareScan').scan(buf);
  if (!scan.clean) throw new HttpError(422, 'This file was refused by the malware scan.', { errors: { proof: 'Refused by the malware scan.' } });
  let clean;
  if (ext === 'pdf') clean = await stripPdf(buf);
  else {
    const sharp = require('sharp');
    try { clean = ext === 'png' ? await sharp(buf).rotate().png().toBuffer() : await sharp(buf).rotate().jpeg({ quality: 90 }).toBuffer(); } catch { throw new HttpError(422, "This image can't be read. Attach another file.", { errors: { proof: "This image can't be read." } }); }
  }
  const name = `proof.${ext}`;
  const saved = saveBuffer(clean, { folder: 'donation-proofs', ext, mime: ext === 'pdf' ? 'application/pdf' : `image/${ext === 'jpg' ? 'jpeg' : 'png'}`, name });
  return { ...saved, scanned: scan.scanned, scan_detail: scan.detail };
}

async function attach(conn, req, donationId, p) {
  const [[dup]] = await conn.query('SELECT document_id FROM tbl_donation_documents WHERE sha256 = ? AND donation_id <> ? ORDER BY document_id LIMIT 1', [p.sha256, donationId]);
  await conn.query(
    `INSERT INTO tbl_donation_documents (donation_id, kind, label, original_name, mime_type, size_bytes, storage_key, sha256, uploaded_by, duplicate_of)
     VALUES (?, 'donor_proof', 'Proof from the donor', ?, ?, ?, ?, ?, ?, ?)`,
    [donationId, p.original_name, p.mime_type, p.size_bytes, p.storage_key, p.sha256, req.user.user_id, dup ? dup.document_id : null]);
  await logActivityWith(conn, req, `DONOR_PROOF_ADDED (${p.mime_type.split('/')[1]}, ${p.scanned ? 'scanned' : 'not scanned: ClamAV not set up'}${dup ? ', same file as another donation' : ''})`, `Donation #${donationId}`);
}

const discard = (p) => discardUnsavedUpload(p?.storage_key);

module.exports = { prepare, attach, discard, MAX };
