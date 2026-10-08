/**
 * ID reading: reads an uploaded government ID photo with tesseract.js (OCR, runs on this server, no cloud)
 * and compares what it read with what the applicant typed.
 *
 * Limits (stated in the UI and the paper): OCR on phone photos is often wrong, so a reading can only
 * support or question the typed details. It never proves an ID is genuine, and it never marks an ID as
 * fake: problems lead to "Flagged for review" or "ID type mismatch" for a person to check. PDFs are not
 * read (only JPG and PNG photos).
 *
 * Setup: `npm install` in backend installs tesseract.js. The English language file (about 10 MB) is
 * downloaded the first time and kept in backend/ocr-data, so later readings work offline. To stay fully
 * offline, put eng.traineddata in backend/ocr-data yourself before the first upload.
 */
const fs = require('fs');
const path = require('path');
const { pool, withTransaction } = require('../config/db');
const { encField, decField } = require('../utils/fieldCrypto');
const { readUpload } = require('../utils/files');
const R = require('../config/verificationRules');

const DATA_DIR = path.join(__dirname, '..', '..', 'ocr-data');
const MONTHS = ['JANUARY', 'FEBRUARY', 'MARCH', 'APRIL', 'MAY', 'JUNE', 'JULY', 'AUGUST', 'SEPTEMBER', 'OCTOBER', 'NOVEMBER', 'DECEMBER'];

const upper = (s) => String(s || '').toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
const compact = (s) => upper(s).replace(/[^A-Z0-9]/g, '');
const spaced = (s) => upper(s).replace(/[^A-Z0-9' ]/g, ' ').replace(/\s+/g, ' ').trim();

/** Which ID type the text points to: the selected one if its words appear, else another known card, else null. */
function detectType(text, selected) {
  const t = spaced(text);
  const has = (words) => words.some((w) => t.includes(spaced(w)));
  if (R.ID_TYPES[selected]?.keywords && has(R.ID_TYPES[selected].keywords)) return selected;
  for (const [type, rule] of Object.entries(R.ID_TYPES)) if (rule.keywords && has(rule.keywords)) return type;
  for (const [type, words] of Object.entries(R.OTHER_ID_KEYWORDS)) if (has(words)) return type;
  return null;
}

/** The ways a YYYY-MM-DD date is commonly printed on Philippine IDs, as compact strings. */
function dateForms(iso) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(iso || ''))) return [];
  const [y, m, d] = iso.split('-');
  const mon = MONTHS[Number(m) - 1];
  const d1 = String(Number(d));
  return [`${y}${m}${d}`, `${m}${d}${y}`, `${d}${m}${y}`, `${mon}${d}${y}`, `${mon}${d1}${y}`, `${d}${mon}${y}`, `${d1}${mon}${y}`,
    `${mon.slice(0, 3)}${d}${y}`, `${mon.slice(0, 3)}${d1}${y}`, `${d}${mon.slice(0, 3)}${y}`, `${d1}${mon.slice(0, 3)}${y}`];
}

/** Photo-editing software named in the file (EXIF/XMP metadata sits near the start of the file). */
function editingTrace(buffer) {
  const head = buffer.subarray(0, 256 * 1024).toString('latin1');
  return R.EDITING_SOFTWARE.find((name) => head.includes(name)) || null;
}

const check = (name, result, message) => ({ check: name, result, message });

/**
 * Compares a reading with the typed details. Returns { checks, typeMismatch, flags } where flags lists
 * reasons for "Flagged for review". Pure function (no database), so it is easy to test.
 */
function compare(reading, form) {
  if (!reading) return { checks: [check('ID read from the photo', 'n/a', 'The ID photo has not been read yet. Refresh in a minute.')], typeMismatch: false, flags: [] };
  if (reading.status === 'skipped') return { checks: [check('ID read from the photo', 'n/a', reading.detail || 'Only JPG and PNG photos are read.')], typeMismatch: false, flags: [] };
  if (reading.status === 'failed') return { checks: [check('ID read from the photo', 'n/a', reading.detail || 'ID reading is not available on this server.')], typeMismatch: false, flags: [] };
  const checks = [];
  const flags = [];
  if (reading.editing_trace) {
    checks.push(check('Signs of editing', 'warn', `The file names photo-editing software (${reading.editing_trace}). This doesn't mean it is fake; check the original.`));
    flags.push('editing');
  } else checks.push(check('Signs of editing', 'pass', 'No editing software named in the file.'));
  const conf = Number(reading.confidence || 0);
  if (reading.status === 'unreadable' || conf < R.OCR_MIN_CONFIDENCE) {
    checks.push(check('ID read from the photo', 'warn', `The photo is hard to read (reading confidence ${conf}%). Compare the original ID by hand, or ask for a clearer photo.`));
    return { checks, typeMismatch: false, flags };
  }
  checks.push(check('ID read from the photo', 'pass', `Read with ${conf}% confidence. A reading supports the checks; it never proves the ID is genuine.`));
  const text = reading.text || '';
  const all = compact(text);
  // ID type
  const type = reading.detected_type || detectType(text, form.id_type);
  let typeMismatch = false;
  if (!type) checks.push(check('ID type on the photo', 'warn', `The text doesn't clearly show which ID this is. Check that it is a ${form.id_type}.`));
  else if (type === form.id_type) checks.push(check('ID type on the photo', 'pass', `Looks like a ${type}.`));
  else { checks.push(check('ID type on the photo', 'fail', `Looks like a ${type}, but ${form.id_type} was selected.`)); typeMismatch = true; }
  // ID number
  const number = compact(form.id_number);
  if (number && all.includes(number)) checks.push(check('ID number on the photo', 'pass', 'The typed ID number appears on the photo.'));
  else { checks.push(check('ID number on the photo', 'warn', 'The typed ID number was not found on the photo.')); flags.push('number'); }
  // Name: every part of the name as printed (2+ letters) must appear
  const parts = spaced(form.id_name).split(' ').filter((p) => p.length >= 2);
  const words = ` ${spaced(text)} `;
  const missing = parts.filter((p) => !words.includes(` ${p} `) && !all.includes(p));
  if (parts.length && !missing.length) checks.push(check('Name on the photo', 'pass', 'The name as printed appears on the photo.'));
  else { checks.push(check('Name on the photo', 'warn', 'Part of the typed name was not found on the photo.')); flags.push('name'); }
  // Date of birth and expiry
  if (dateForms(form.id_dob).some((f) => all.includes(f))) checks.push(check('Date of birth on the photo', 'pass', 'The typed date of birth appears on the photo.'));
  else { checks.push(check('Date of birth on the photo', 'warn', 'The typed date of birth was not found on the photo.')); flags.push('dob'); }
  if (form.id_expiry) {
    if (dateForms(form.id_expiry).some((f) => all.includes(f))) checks.push(check('Expiry date on the photo', 'pass', 'The typed expiry date appears on the photo.'));
    else checks.push(check('Expiry date on the photo', 'warn', 'The typed expiry date was not found on the photo.'));
  }
  return { checks, typeMismatch, flags };
}

/** The latest reading of the application's current ID photo, or null. */
async function latestForApplication(conn, applicationId) {
  const [[r]] = await conn.query(
    `SELECT o.status, o.detail, o.text_enc, o.confidence, o.detected_type, o.editing_trace FROM tbl_id_ocr o
       JOIN tbl_adoption_documents d ON d.document_id = o.document_id
      WHERE d.application_id = ? AND d.doc_type = 'valid_id' AND d.status = 'Uploaded' ORDER BY o.ocr_id DESC LIMIT 1`, [applicationId]);
  return r ? { ...r, text: r.text_enc ? decField(r.text_enc) : '' } : null;
}

const OCR_TIMEOUT_MS = 90 * 1000;

/** Is tesseract.js installed completely (package and its engine files)? */
function engineInstalled() {
  try {
    require.resolve('tesseract.js');
    const core = path.dirname(require.resolve('tesseract.js-core/package.json'));
    return fs.readdirSync(core).some((f) => f.endsWith('.wasm'));
  } catch { return false; }
}

/** One reading in a separate process (services/ocrProcess.js), so an OCR crash can't stop the API. */
function recognizeIsolated(buffer) {
  return new Promise((resolve) => {
    const { fork } = require('child_process');
    let settled = false;
    const finish = (r) => { if (!settled) { settled = true; clearTimeout(timer); try { child.kill(); } catch { /* ended */ } resolve(r); } };
    const child = fork(path.join(__dirname, 'ocrProcess.js'), [], { stdio: ['ignore', 'ignore', 'ignore', 'ipc'] });
    const timer = setTimeout(() => finish({ ok: false, error: 'timed out' }), OCR_TIMEOUT_MS);
    child.on('message', finish);
    child.on('error', (err) => finish({ ok: false, error: err.message }));
    child.on('exit', (code) => finish({ ok: false, error: `stopped (code ${code})` }));
    child.send({ image: buffer.toString('base64'), dataDir: DATA_DIR });
  });
}

/** Reads one uploaded ID document and stores the result. Never throws (it runs after the upload response). */
async function readDocument(documentId) {
  let row;
  try {
    const [[doc]] = await pool.query('SELECT document_id, application_id, storage_key, mime_type FROM tbl_adoption_documents WHERE document_id = ?', [documentId]);
    if (!doc) return;
    const save = (r) => pool.query('INSERT INTO tbl_id_ocr (document_id, status, detail, text_enc, confidence, detected_type, editing_trace) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [documentId, r.status, r.detail || null, r.text ? encField(r.text) : null, r.confidence ?? null, r.detected_type || null, r.editing_trace || null]);
    if (!['image/jpeg', 'image/png'].includes(doc.mime_type)) { await save({ status: 'skipped', detail: 'A PDF is not read. Upload a JPG or PNG photo to have it read.' }); return; }
    const buffer = readUpload(doc.storage_key);
    const trace = editingTrace(buffer);
    if (!engineInstalled()) {
      await save({ status: 'failed', detail: 'ID reading is not installed completely on this server (run npm install in backend and let it finish).', editing_trace: trace });
      return;
    }
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const out = await recognizeIsolated(buffer);
    if (!out.ok) {
      console.error('[id-reader] OCR did not finish:', out.error);
      await save({ status: 'failed', detail: 'The ID photo could not be read on this server. A person must compare it by hand.', editing_trace: trace });
      return;
    }
    const [[form]] = await pool.query('SELECT id_type FROM tbl_applicant_details WHERE application_id = ?', [doc.application_id]);
    const selected = form?.id_type ? decField(form.id_type) : '';
    row = { status: out.text.trim().length < 20 ? 'unreadable' : 'read', text: out.text, confidence: out.confidence, detected_type: detectType(out.text, selected), editing_trace: trace };
    await save(row);
    // Already submitted: refresh the ID checks with the new reading (a person's verification stays).
    const [[app]] = await pool.query('SELECT * FROM tbl_adoption_applications WHERE application_id = ?', [doc.application_id]);
    if (app && app.status !== 'Draft') {
      const Adoption = require('../models/adoptionModel');
      const form2 = await Adoption.form(app.application_id);
      await withTransaction((conn) => require('./verification').syncFromForm(conn, app, form2, null));
    }
  } catch (err) {
    console.error('[id-reader] Reading failed:', err.message);
    try { await pool.query("INSERT INTO tbl_id_ocr (document_id, status, detail) VALUES (?, 'failed', ?)", [documentId, 'The ID photo could not be read. A person must compare it by hand.']); } catch { /* ignore */ }
  }
}

/** Starts reading in the background (the upload doesn't wait for it). */
const readInBackground = (documentId) => setImmediate(() => { readDocument(documentId); });

module.exports = { compare, detectType, dateForms, editingTrace, latestForApplication, readDocument, readInBackground };
