/**
 * Automatic ID scanning for the adoption application (page 3): the FRONT and BACK photos of the
 * applicant's government ID are checked on this server as soon as each is uploaded.
 *
 * Two results are kept apart, always:
 *  1. Automated checks: Passed, Failed or Unable to read. Image quality, ID type and side, OCR fields,
 *     QR/MRZ, number format, dates, expiry, consistency, and the match with what the applicant entered.
 *  2. Authenticity: "Verified – real and valid" only when an authorized official verification returned
 *     success and it was recorded (services/verificationAdapters.js). Otherwise "Manual verification
 *     required". OCR, formats, appearance or a decoded QR never make an ID "real", and nothing here ever
 *     calls an ID fake: suspicious signs only add review flags ("Flagged for review").
 *
 * Nothing leaves this server: OCR (tesseract.js), QR decoding (jsQR) and image checks (sharp) run locally.
 * Extracted fields are stored encrypted; the raw QR text is never stored; ID numbers are kept only as a
 * keyed hash for the duplicate check.
 */
const crypto = require('crypto');
const env = require('../../config/env');
const { pool } = require('../../config/db');
const { encField, decField } = require('../../utils/fieldCrypto');
const { readUpload } = require('../../utils/files');
const R = require('../../config/verificationRules');
const IdTypes = require('../idTypes');
const Image = require('./image');
const Ocr = require('./ocr');
const Mrz = require('./mrz');
const Qr = require('./qr');
const Text = require('./text');

/** Uploads allowed per side: the first photo plus 5 retakes. After that, a person reviews the ID. */
const MAX_ATTEMPTS = 6;
const SIDE_OF = { valid_id: 'front', valid_id_back: 'back' };
const FIELD_LABEL = { full_name: 'full name', date_of_birth: 'date of birth', id_number: 'ID number', address: 'address', date_issued: 'date issued', expiry_date: 'expiry date' };
const FLAG_TEXT = {
  editing_software: 'The photo file names photo-editing software. Potential alteration detected. Manual verification required.',
  possible_screenshot: 'This looks like a screenshot or a copy of a photo (no camera data). Ask for a photo of the actual card.',
  qr_unreadable: 'The QR code on the back could not be read.',
  qr_unrecognised: 'The QR code does not contain PhilSys data.',
  qr_mismatch: 'The details in the QR code differ from the printed details.',
  mrz_mismatch: 'The MRZ details differ from the printed details.',
  mrz_check_failed: 'The passport MRZ check digits do not verify.',
  dates_inconsistent: 'Dates differ between the front, the back and the QR/MRZ.',
  duplicate_image: 'The same ID photo was uploaded on another applicant\'s application.',
  number_reused: 'The same ID number is on another applicant\'s application.',
  same_photo_both_sides: 'The front and back are the same photo.',
  type_differs_by_side: 'The front and back look like different ID types.',
  too_many_retakes: `More than ${MAX_ATTEMPTS - 1} retakes of one side. A person should review the ID.`,
};

const today = () => new Date().toISOString().slice(0, 10);
const check = (name, result, message, extra = {}) => ({ check: name, result, message, ...extra });
const numberHash = (type, number) => (number ? crypto.createHmac('sha256', env.phiKey).update(`id:${type}:${String(number).toUpperCase().replace(/[\s-]/g, '')}`).digest('hex') : null);
const compactNo = (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
const mask = (s) => { const c = compactNo(s); return c ? `${'•'.repeat(Math.max(0, c.length - 4))}${c.slice(-4)}` : null; };
const parseJson = (v, f) => { if (v == null) return f; if (typeof v !== 'string') return v; try { return JSON.parse(v); } catch { return f; } };
const dec = (v) => { if (!v) return null; try { return JSON.parse(decField(v)); } catch { return null; } };
const longDate = (iso) => { if (!iso) return 'not found'; const d = new Date(`${iso}T00:00:00Z`); return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString('en-PH', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' }); };

// ---------------------------------------------------------------- one side (pure, testable)

/**
 * Scans one photo. buffer: the file; mime: its type; side: 'front' | 'back'; rule: the selected type's rule
 * (or null for "Other"); rules: all active rules. Returns the scan result to store (no database access).
 */
async function analyseSide(buffer, mime, { side, rule, rules, selectedKey }) {
  const checks = []; const flags = [];
  const out = { result: null, checks, flags, quality: null, fields: {}, machine: { kind: 'none', status: 'not_expected', fields: null }, detected_type: null, detected_side: null, dhash: null, number: null };
  if (mime === 'application/pdf') {
    checks.push(check('Photo', 'fail', 'A PDF can\'t be scanned automatically. Take a photo of the card, or upload a JPG or PNG.'));
    out.result = 'unreadable';
    return out;
  }
  let img;
  try { img = await Image.analyse(buffer); } catch {
    checks.push(check('Photo', 'fail', 'This image could not be opened. Take the photo again.'));
    out.result = 'unreadable';
    return out;
  }
  out.quality = img.quality; out.dhash = img.dhash;
  // Quality: low resolution, darkness and blur fail; glare and over-exposure fail too, since they hide text.
  if (img.problems.length) checks.push(check('Photo quality', 'fail', img.problems.map((p) => Image.PROBLEM_TEXT[p]).join(' '), { problems: img.problems }));
  else checks.push(check('Photo quality', 'pass', 'Sharp, well lit and large enough.'));
  const trace = require('../idReader').editingTrace(buffer);
  if (trace) flags.push('editing_software');
  if (img.possibleScreenshot) flags.push('possible_screenshot');

  // OCR (on this server). Retries turned 90/180/270 degrees when the reading is poor.
  const ocr = await Ocr.read(img.ocrImage);
  if (!ocr.ok) {
    checks.push(check('Readable', 'n/a', ocr.error === 'not_installed' ? 'Automatic reading is not installed on this server. A person will check the ID.' : 'The photo could not be read automatically. A person will check the ID.'));
    out.result = 'unreadable';
    return out;
  }
  const goodWords = (ocr.words || []).filter((w) => w.conf >= 60 && /[A-Z0-9]{2,}/i.test(w.text)).length;
  const readable = ocr.confidence >= R.OCR_MIN_CONFIDENCE && goodWords >= 6;

  // Machine-readable parts: MRZ (passports) and QR (PhilID back). Decoding never proves authenticity.
  const mrz = Mrz.parse(ocr.text);
  const qrText = Qr.decode(img.rgba);
  const qr = qrText ? Qr.read(qrText) : null;

  const ident = Text.identify(ocr.text, rules, selectedKey);
  out.detected_type = ident?.key || (mrz ? 'Passport' : qr && qr.format.startsWith('philsys') ? 'PhilSys National ID' : null);
  out.detected_side = mrz ? 'front' : (qr && qr.format.startsWith('philsys') ? 'back' : ident?.side || null);

  if (!readable && !mrz && !(qr && qr.format !== 'unknown')) {
    checks.push(check('Readable', 'fail', `We couldn't read this side (reading confidence ${ocr.confidence}%). Please try again in good light.`));
    out.result = 'unreadable';
    return out;
  }
  checks.push(check('Readable', 'pass', `Read with ${ocr.confidence}% confidence${ocr.rotated ? ` (photo was turned ${ocr.rotated}°)` : ''}.`));

  // Card fully in the photo: confident words touching the edge of the picture mean the card is cut off.
  const W = Math.max(...(ocr.words || []).map((w) => w.x1 || 0), 1); const H = Math.max(...(ocr.words || []).map((w) => w.y1 || 0), 1);
  const edge = (ocr.words || []).filter((w) => w.conf >= 70 && (w.x0 <= 2 || w.y0 <= 2 || w.x1 >= W - 2 || w.y1 >= H - 2)).length;
  if (edge >= 3) checks.push(check('Whole card in the photo', 'fail', 'Part of the card seems to be cut off. Put the whole card inside the frame.'));

  // ID type and side.
  if (rule) {
    if (!out.detected_type) checks.push(check('ID type', side === 'front' ? 'warn' : 'n/a', side === 'front' ? `The photo doesn't clearly show which ID this is. Check that it is a ${rule.label}.` : 'The back has few printed words to identify the ID type.', { unrecognized: side === 'front' }));
    else if (out.detected_type !== rule.key) checks.push(check('ID type', 'fail', `This looks like a ${out.detected_type}, but ${rule.label} was selected.`, { mismatch: true }));
    else checks.push(check('ID type', 'pass', `Looks like a ${rule.label}.`));
  } else checks.push(check('ID type', 'n/a', 'This ID type is not on the list of accepted IDs; a person will check it.', { unrecognized: true }));
  if (out.detected_side && out.detected_side !== side) {
    checks.push(check('Correct side', 'fail', `This looks like the ${out.detected_side} of the ID, but it was uploaded as the ${side}. Upload the ${side} here.`, { wrong_side: true }));
  } else if (out.detected_side) checks.push(check('Correct side', 'pass', `This is the ${side}.`));

  // Fields from the printed text.
  const fields = Text.extract(ocr.text, rule);
  out.fields = fields;
  const required = rule ? (side === 'front' ? rule.frontFields : rule.backFields) || [] : [];
  const missing = required.filter((f) => !fields[f] && !(f === 'full_name' && (mrz?.full_name || qr?.fields?.full_name)) && !(f === 'date_of_birth' && (mrz?.date_of_birth || qr?.fields?.date_of_birth)) && !(f === 'expiry_date' && mrz?.expiry_date) && !(f === 'id_number' && mrz?.id_number));
  if (required.length) {
    checks.push(missing.length
      ? check('Required details', 'fail', `Not found on the ${side}: ${missing.map((f) => FIELD_LABEL[f] || f).join(', ')}. Take a clearer photo of the whole ${side}.`, { missing })
      : check('Required details', 'pass', `Found on the ${side}: ${required.map((f) => FIELD_LABEL[f] || f).join(', ')}.`));
  }
  const number = fields.id_number || mrz?.id_number || qr?.fields?.id_number || null;
  out.number = number;
  if (rule?.numberRegex && fields.id_number) {
    checks.push(rule.numberRegex.test(String(fields.id_number).toUpperCase().replace(/\s+/g, ''))
      ? check('ID number format', 'pass', 'The number on the ID has the right format.')
      : check('ID number format', 'fail', `The number read from the ID doesn't match the ${rule.label} format${rule.example ? ` (e.g. ${rule.example})` : ''}.`, { invalid_number: true }));
  }
  const dob = fields.date_of_birth || mrz?.date_of_birth || qr?.fields?.date_of_birth;
  if (dob) {
    const age = (Date.now() - new Date(`${dob}T00:00:00Z`).getTime()) / (365.25 * 86400000);
    if (age < 0 || age > 120) checks.push(check('Dates valid', 'fail', 'The date of birth read from the ID is not a valid date.'));
  }
  if (fields.date_issued && fields.date_issued > today()) checks.push(check('Dates valid', 'fail', 'The date issued read from the ID is in the future.'));

  // MRZ / QR expected for this type and side.
  const expectMachine = rule && rule.machine !== 'none' && rule.machineSide === side;
  if (rule?.machine === 'mrz' && expectMachine) {
    out.machine = { kind: 'mrz', status: mrz ? (mrz.valid ? 'read' : 'invalid') : 'not_found', fields: mrz ? { full_name: mrz.full_name, date_of_birth: mrz.date_of_birth, id_number: mrz.id_number, expiry_date: mrz.expiry_date, checks: mrz.checks } : null };
    if (!mrz) checks.push(check('MRZ (two lines at the bottom)', 'fail', 'The two machine-readable lines at the bottom of the photo page were not found. Include the whole page in the photo.'));
    else if (!mrz.valid) { checks.push(check('MRZ (two lines at the bottom)', 'fail', `The MRZ check digits don't verify (${Object.entries(mrz.checks).filter(([, ok]) => ok === false).map(([k]) => k.replace(/_/g, ' ')).join(', ')}). Retake the photo; if this persists, a person will check it.`)); flags.push('mrz_check_failed'); }
    else if (!mrz.complete) checks.push(check('MRZ (two lines at the bottom)', 'warn', 'Read, but part of it was unclear; the readable check digits verify.'));
    else checks.push(check('MRZ (two lines at the bottom)', 'pass', 'Read; the check digits verify. (This shows the MRZ is consistent, not that the passport is genuine.)'));
  } else if (rule?.machine === 'qr' && expectMachine) {
    out.machine = { kind: 'qr', status: qr ? (qr.format.startsWith('philsys') && qr.format !== 'philsys_unreadable' ? 'read' : 'invalid') : 'not_found', fields: qr ? { ...qr.fields, format: qr.format, signature_present: qr.signature_present, signature_checked: false } : null };
    if (!qr) { checks.push(check('QR code', 'fail', 'The QR code could not be read. Take the photo straight on, without glare on the QR code.')); flags.push('qr_unreadable'); }
    else if (out.machine.status !== 'read') { checks.push(check('QR code', 'warn', 'A QR code was found but it doesn\'t contain PhilSys data.')); flags.push('qr_unrecognised'); }
    else checks.push(check('QR code', 'pass', 'Read. Its digital signature is checked with PhilSys Check by the home, not here.'));
  }

  out.result = checks.some((c) => c.result === 'fail') ? 'failed' : 'passed';
  return out;
}

// ---------------------------------------------------------------- both sides + the application (pure)

/**
 * Combines the latest front and back scans with what the applicant entered. Returns
 * { checks, flags, auto_result, status_hint, extracted, donor } (see the module comment).
 */
function summarize({ front, back, form, rule, attempts = {}, duplicateImage = false, numberReused = false }) {
  const checks = []; const flags = new Set();
  const needsBack = rule ? rule.needsBack : true;
  for (const [side, s] of [['front', front], ['back', back]]) {
    if (!s) { if (side === 'front' || needsBack) checks.push(check(`${side === 'front' ? 'Front' : 'Back'}: photo`, 'fail', `Upload the ${side} of the ID.`, { side, missing: true })); continue; }
    if (s.state === 'scanning') { checks.push(check(`${side === 'front' ? 'Front' : 'Back'}: scan`, 'n/a', 'Scanning...', { side, pending: true })); continue; }
    (s.checks || []).forEach((c) => checks.push({ ...c, check: `${side === 'front' ? 'Front' : 'Back'}: ${c.check}`, side }));
    (s.flags || []).forEach((f) => flags.add(f));
  }
  const done = (s) => s && s.state === 'done';
  if (done(front) && done(back)) {
    if (front.image_dhash && back.image_dhash && Image.hamming(front.image_dhash, back.image_dhash) <= 6) { flags.add('same_photo_both_sides'); checks.push(check('Front and back', 'fail', 'The same photo was uploaded for both sides. Upload the back of the card.')); }
    if (front.detected_side === 'back' && back.detected_side === 'front') checks.push(check('Front and back', 'fail', 'The front and back look swapped. Upload each photo in the right place.', { swapped: true }));
    if (front.detected_type && back.detected_type && front.detected_type !== back.detected_type) flags.add('type_differs_by_side');
  }

  // What the ID says: machine-readable data first (QR/MRZ), then the printed front.
  const f = front?.fields || {}; const m = front?.machine?.fields || back?.machine?.fields || null;
  const printed = { full_name: f.full_name, date_of_birth: f.date_of_birth, id_number: f.id_number || back?.fields?.id_number, expiry_date: f.expiry_date || back?.fields?.expiry_date, date_issued: f.date_issued || back?.fields?.date_issued, address: f.address };
  // QR/MRZ against the printed details (consistency, flag only).
  if (m && (printed.full_name || printed.date_of_birth)) {
    const kind = (front?.machine?.fields ? front.machine.kind : back?.machine?.kind) || 'qr';
    const nameOk = !m.full_name || !printed.full_name || Text.sameName(m.full_name, printed.full_name) !== false;
    const dobOk = !m.date_of_birth || !printed.date_of_birth || m.date_of_birth === printed.date_of_birth;
    const noOk = !m.id_number || !printed.id_number || compactNo(m.id_number) === compactNo(printed.id_number);
    if (!nameOk || !noOk) flags.add(kind === 'mrz' ? 'mrz_mismatch' : 'qr_mismatch');
    if (!dobOk) flags.add('dates_inconsistent');
    checks.push(nameOk && dobOk && noOk
      ? check(`${kind === 'mrz' ? 'MRZ' : 'QR code'} matches the printed details`, 'pass', 'Name, date of birth and number agree.')
      : check(`${kind === 'mrz' ? 'MRZ' : 'QR code'} matches the printed details`, 'warn', [!nameOk && 'name differs', !dobOk && 'date of birth differs', !noOk && 'number differs'].filter(Boolean).join(', ') + '. Flagged for review.'));
  }
  const best = { full_name: m?.full_name || printed.full_name, date_of_birth: m?.date_of_birth || printed.date_of_birth, id_number: m?.id_number || printed.id_number, expiry_date: m?.expiry_date || printed.expiry_date, date_issued: printed.date_issued, address: printed.address };

  // Against what the applicant entered (page 1 and page 3).
  // Both the printed details and the QR/MRZ are compared; a difference in either is reported.
  const diffs = [];
  const sources = [printed, m].filter(Boolean);
  const differs = (key, same) => sources.map((src) => src[key]).find((v) => v && form[key === 'full_name' ? 'legal_name' : key] && !same(v));
  const badName = differs('full_name', (v) => Text.sameName(v, form.legal_name) !== false);
  const badDob = differs('date_of_birth', (v) => v === form.date_of_birth);
  const badNo = differs('id_number', (v) => compactNo(v) === compactNo(form.id_number));
  if (badName) diffs.push({ field: 'Name', system: form.legal_name, id: badName });
  if (badDob) diffs.push({ field: 'Date of birth', system: longDate(form.date_of_birth), id: longDate(badDob) });
  if (badNo) diffs.push({ field: 'ID number', system: mask(form.id_number), id: mask(badNo) });
  const compared = Boolean(best.full_name || best.date_of_birth || best.id_number);
  if (compared) {
    checks.push(diffs.length
      ? check('Matches your application', 'fail', `Information mismatch. ${diffs.map((d) => `${d.field} – System: ${d.system} · ID: ${d.id}`).join('. ')}.`, { diffs })
      : check('Matches your application', 'pass', 'Information match: the details on the ID agree with the application.'));
  }

  // Expiry: Valid, Expired, or Unable to determine.
  let expiry = { state: 'n/a', date: null };
  if (rule && !rule.expires) expiry = { state: 'no_expiry', date: null };
  else {
    const date = best.expiry_date || form.id_expiry || null;
    expiry = !date ? { state: 'unknown', date: null } : date < today() ? { state: 'expired', date } : { state: 'valid', date };
  }
  if (expiry.state === 'expired') checks.push(check('Expiry', 'fail', `Expired: expired on ${longDate(expiry.date)}. Upload a valid ID.`, { expired: true }));
  else if (expiry.state === 'valid') checks.push(check('Expiry', 'pass', `Valid: valid until ${longDate(expiry.date)}.`));
  else if (expiry.state === 'unknown' && (done(front) || done(back))) checks.push(check('Expiry', 'warn', 'Unable to determine: no expiry date was found on the ID.'));

  if (duplicateImage) flags.add('duplicate_image');
  if (numberReused) flags.add('number_reused');
  if ((attempts.front || 0) > MAX_ATTEMPTS || (attempts.back || 0) > MAX_ATTEMPTS) flags.add('too_many_retakes');

  // Automated result: Unable to read when a needed side couldn't be read; Failed when a check failed.
  const sides = [front, needsBack ? back : null].filter(Boolean);
  const missingSide = !front || (needsBack && !back);
  const pending = sides.some((s) => s.state !== 'done');
  let auto = null;
  if (!missingSide && !pending) {
    auto = sides.some((s) => s.result === 'unreadable') ? 'Unable to read' : checks.some((c) => c.result === 'fail') ? 'Failed' : 'Passed';
  }
  const failed = (pred) => checks.some((c) => c.result === 'fail' && pred(c));
  const statusHint = failed((c) => c.mismatch) ? 'ID type mismatch'
    : (checks.some((c) => c.unrecognized) && !front?.detected_type) ? 'Unrecognized ID'
      : failed((c) => c.invalid_number) ? 'Invalid ID number'
        : failed((c) => c.expired) ? 'Expired'
          : failed((c) => c.diffs) ? 'Information mismatch'
            : flags.size ? 'Flagged for review' : null;

  return {
    checks, flags: [...flags], flag_text: [...flags].map((k) => FLAG_TEXT[k] || k), auto_result: auto, status_hint: statusHint,
    extracted: best, expiry, needs_back: needsBack, attempts,
  };
}

/** The donor's checklist (icon + word in the UI). States: pass, fail, pending, n/a. */
function donorChecklist(sum, front, back, rule) {
  const st = (pred, failPred) => (failPred ? 'fail' : pred ? 'pass' : 'pending');
  const has = (name, side) => sum.checks.find((c) => c.check.endsWith(name) && (!side || c.side === side));
  const res = (c) => (!c ? null : c.result);
  const typeC = has('ID type', 'front'); const fr = has('Readable', 'front'); const br = has('Readable', 'back');
  const numC = has('ID number format', 'front'); const match = has('Matches your application');
  const exp = has('Expiry'); const machine = has('QR code') || has('MRZ (two lines at the bottom)');
  const diffs = match?.diffs || [];
  const items = [
    { key: 'type', label: 'ID type matches your selection', state: res(typeC) === 'pass' ? 'pass' : res(typeC) === 'fail' ? 'fail' : front?.state === 'done' ? 'n/a' : 'pending' },
    { key: 'front', label: 'Front is readable', state: front?.state === 'done' ? (front.result === 'unreadable' ? 'fail' : res(fr) === 'pass' ? 'pass' : 'fail') : 'pending' },
    { key: 'back', label: rule && !rule.needsBack ? 'Back (optional for this ID)' : 'Back is readable', state: !back ? (rule && !rule.needsBack ? 'n/a' : 'pending') : back.state === 'done' ? (back.result === 'unreadable' ? 'fail' : res(br) === 'pass' ? 'pass' : 'fail') : 'pending' },
    { key: 'number', label: 'ID number format is correct', state: !numC ? (front?.state === 'done' ? 'n/a' : 'pending') : res(numC) === 'pass' ? 'pass' : 'fail' },
    { key: 'name', label: 'Name matches', state: !match ? 'pending' : st(true, diffs.some((d) => d.field === 'Name')) },
    { key: 'dob', label: 'Date of birth matches', state: !match ? 'pending' : st(true, diffs.some((d) => d.field === 'Date of birth')) },
    { key: 'expiry', label: 'Not expired', state: sum.expiry.state === 'expired' ? 'fail' : sum.expiry.state === 'valid' ? 'pass' : sum.expiry.state === 'no_expiry' ? 'n/a' : 'pending' },
    { key: 'machine', label: rule?.machine === 'mrz' ? 'MRZ read' : 'QR code read', state: !rule || rule.machine === 'none' ? 'n/a' : !machine ? 'pending' : res(machine) === 'pass' ? 'pass' : 'fail' },
  ];
  return items;
}

// ---------------------------------------------------------------- database

async function latestScans(conn, applicationId) {
  const [rows] = await conn.query(
    `SELECT s.* FROM tbl_id_scans s JOIN tbl_adoption_documents d ON d.document_id = s.document_id
      WHERE s.application_id = ? AND d.status = 'Uploaded' ORDER BY s.scan_id DESC`, [applicationId]);
  const [counts] = await conn.query('SELECT side, COUNT(*) AS n FROM tbl_id_scans WHERE application_id = ? GROUP BY side', [applicationId]);
  const pick = (side) => {
    const r = rows.find((x) => x.side === side);
    if (!r) return null;
    return {
      scan_id: r.scan_id, document_id: r.document_id, side, state: r.state, result: r.result, attempt_no: r.attempt_no, detected_type: r.detected_type, detected_side: r.detected_side,
      quality: parseJson(r.quality, null), checks: parseJson(r.checks, []), flags: parseJson(r.flags, []), fields: dec(r.fields_enc) || {},
      machine: { kind: r.machine_kind, status: r.machine_status, fields: dec(r.machine_enc) }, image_hash: r.image_hash, image_dhash: r.image_dhash, number_hash: r.number_hash,
      created_at: r.created_at, finished_at: r.finished_at, purged: Boolean(r.purged_at),
    };
  };
  return { front: pick('front'), back: pick('back'), attempts: Object.fromEntries(counts.map((c) => [c.side, Number(c.n)])) };
}

/** Same image or same ID number on another applicant's application. */
async function duplicates(conn, app, scans) {
  const hashes = [scans.front?.image_hash, scans.back?.image_hash].filter(Boolean);
  const numbers = [scans.front?.number_hash, scans.back?.number_hash].filter(Boolean);
  let duplicateImage = false; let numberReused = false;
  if (hashes.length) {
    const [[r]] = await conn.query(
      `SELECT COUNT(*) AS n FROM tbl_adoption_documents d JOIN tbl_adoption_applications a ON a.application_id = d.application_id
        WHERE d.sha256 IN (?) AND d.archived_at IS NULL AND d.application_id <> ? AND a.applicant_id <> ?`, [hashes, app.application_id, app.applicant_id]);
    duplicateImage = Number(r.n) > 0;
  }
  if (numbers.length) {
    const [[r]] = await conn.query(
      `SELECT (SELECT COUNT(*) FROM tbl_id_scans s JOIN tbl_adoption_applications a ON a.application_id = s.application_id
                WHERE s.number_hash IN (?) AND s.application_id <> ? AND a.applicant_id <> ?)
            + (SELECT COUNT(*) FROM tbl_verifications v JOIN tbl_adoption_applications a ON a.application_id = v.application_id
                WHERE v.reference_hash IN (?) AND v.application_id <> ? AND a.applicant_id <> ?) AS n`,
      [numbers, app.application_id, app.applicant_id, numbers, app.application_id, app.applicant_id]);
    numberReused = Number(r.n) > 0;
  }
  return { duplicateImage, numberReused };
}

/** Everything about the ID scan for one application (used by the donor page, the staff review and the checks). */
async function forApplication(conn, app, form) {
  const scans = await latestScans(conn, app.application_id);
  const rule = form.id_type ? await IdTypes.get(form.id_type) : null;
  const dup = await duplicates(conn, app, scans);
  const sum = summarize({ ...scans, form, rule, ...dup });
  return { ...scans, rule, summary: sum, checklist: donorChecklist(sum, scans.front, scans.back, rule) };
}

/** Scans one uploaded ID side and stores the result. Never throws (runs after the upload response). */
async function scanDocument(documentId, { actorId = null } = {}) {
  let scanId = null;
  try {
    const [[doc]] = await pool.query('SELECT document_id, application_id, doc_type, storage_key, mime_type, sha256, uploaded_by FROM tbl_adoption_documents WHERE document_id = ?', [documentId]);
    const side = doc && SIDE_OF[doc.doc_type];
    if (!side) return;
    const Adoption = require('../../models/adoptionModel');
    const form = await Adoption.form(doc.application_id);
    const rules = await IdTypes.all();
    const rule = form.id_type ? await IdTypes.get(form.id_type) : null;
    const [[{ n }]] = await pool.query('SELECT COUNT(*) AS n FROM tbl_id_scans WHERE application_id = ? AND side = ?', [doc.application_id, side]);
    const [ins] = await pool.query('INSERT INTO tbl_id_scans (application_id, document_id, side, attempt_no, selected_type, image_hash) VALUES (?, ?, ?, ?, ?, ?)',
      [doc.application_id, documentId, side, Number(n) + 1, form.id_type || null, doc.sha256 || null]);
    scanId = ins.insertId;

    const out = await analyseSide(readUpload(doc.storage_key), doc.mime_type, { side, rule, rules, selectedKey: form.id_type });
    await pool.query(
      `UPDATE tbl_id_scans SET state = 'done', result = ?, detected_type = ?, detected_side = ?, quality = ?, checks = ?, flags = ?, fields_enc = ?,
              machine_kind = ?, machine_status = ?, machine_enc = ?, image_dhash = ?, number_hash = ?, finished_at = NOW() WHERE scan_id = ?`,
      [out.result, out.detected_type, out.detected_side, JSON.stringify(out.quality), JSON.stringify(out.checks), JSON.stringify(out.flags),
        Object.keys(out.fields || {}).length ? encField(JSON.stringify(out.fields)) : null, out.machine.kind, out.machine.status,
        out.machine.fields ? encField(JSON.stringify(out.machine.fields)) : null, out.dhash, numberHash(form.id_type || 'Other', out.number), scanId]);
    const { logSystemActivity } = require('../../utils/audit');
    await logSystemActivity(pool, actorId || doc.uploaded_by,
      `ID_SCAN (${side}, attempt ${Number(n) + 1}: ${out.result}${out.flags.length ? `; flags: ${out.flags.join(', ')}` : ''})`, `Application #${doc.application_id}`);
    // Submitted applications: refresh the verification record (a person's verification stays until the data changes).
    const [[app]] = await pool.query('SELECT * FROM tbl_adoption_applications WHERE application_id = ?', [doc.application_id]);
    if (app && app.status !== 'Draft') {
      const { withTransaction } = require('../../config/db');
      await withTransaction((conn) => require('../verification').syncFromForm(conn, app, form, null, { systemFor: doc.uploaded_by, trigger: `ID ${side} scanned` }));
    }
  } catch (err) {
    console.error('[id-scan] Scan failed:', err.message);
    if (scanId) {
      await pool.query("UPDATE tbl_id_scans SET state = 'done', result = 'unreadable', checks = ?, finished_at = NOW() WHERE scan_id = ?",
        [JSON.stringify([check('Readable', 'n/a', 'The photo could not be scanned automatically. A person will check the ID.')]), scanId]).catch(() => {});
    }
  }
}

const scanInBackground = (documentId, opts) => setImmediate(() => { scanDocument(documentId, opts); });

/** Retention: extracted fields are removed from scans of closed applications after the configured days. */
async function purgeOld() {
  const [[s]] = await pool.query("SELECT setting_value FROM tbl_settings WHERE setting_key = 'id_scan_retention_days'").catch(() => [[null]]);
  const days = Math.max(1, Number(s?.setting_value) || 90);
  const [r] = await pool.query(
    `UPDATE tbl_id_scans s JOIN tbl_adoption_applications a ON a.application_id = s.application_id
        SET s.fields_enc = NULL, s.machine_enc = NULL, s.purged_at = NOW()
      WHERE s.purged_at IS NULL AND a.status IN ('Closed', 'Declined', 'Withdrawn') AND a.updated_at < NOW() - INTERVAL ? DAY`, [days]).catch(() => [{ affectedRows: 0 }]);
  return r.affectedRows || 0;
}

module.exports = {
  analyseSide, summarize, donorChecklist, forApplication, latestScans, scanDocument, scanInBackground, purgeOld,
  mask, numberHash, MAX_ATTEMPTS, SIDE_OF, FLAG_TEXT,
};
