/**
 * Government ID and clearance verification for adoption applications.
 *
 * When an application is submitted (and when the applicant corrects a record), each ID and clearance gets
 * a verification row with automatic checks: recognised ID type, number format, expiry or issue date, the
 * name and date of birth against page 1, and the same number or file on another applicant's application.
 * No official verification service is connected, so the best automatic result is "Manual verification
 * required"; only a person's review (recording how they verified it) can set "Verified". Every change is
 * written to tbl_verification_events and the activity log.
 */
const crypto = require('crypto');
const env = require('../config/env');
const { pool } = require('../config/db');
const HttpError = require('../utils/HttpError');
const { encField, decField } = require('../utils/fieldCrypto');
const R = require('../config/verificationRules');
const Providers = require('../config/verificationProviders');
const IdReader = require('./idReader');

/**
 * Asks the official provider for this kind of record, if one is configured. Returns a check plus an
 * optional status and the provider reference; with no provider, a "not available" check.
 */
async function official(kind, query) {
  const p = Providers[kind];
  const none = kind === 'government_id' ? 'No official ID verification service is connected. A person must verify the original ID.'
    : 'No official NBI, police or court verification service is connected. A person must check the original or its official QR code.';
  if (!p) return { check: check('Official verification', 'n/a', none) };
  try {
    const r = await Promise.race([p.verify(query), new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), Providers.TIMEOUT_MS))]);
    if (r?.result === 'verified') return { check: check('Official verification', 'pass', `Confirmed by ${p.name}${r.reference ? ` (ref ${r.reference})` : ''}.`), verified: true, provider: p.name, reference: r.reference || null };
    if (r?.result === 'not_found') return { check: check('Official verification', 'fail', `${p.name} has no record of this number.`), status: kind === 'government_id' ? 'Invalid ID' : 'Invalid' };
    if (r?.result === 'mismatch') return { check: check('Official verification', 'fail', `${p.name} returned different details${r.detail ? `: ${r.detail}` : '.'}`), status: kind === 'government_id' ? 'Information mismatch' : 'Verification failed' };
    return { check: check('Official verification', 'warn', `${p.name} could not be reached. A person must verify it.`), status: kind === 'government_id' ? 'Unable to verify' : null };
  } catch (err) {
    return { check: check('Official verification', 'warn', `${p.name} could not be reached. A person must verify it.`), status: kind === 'government_id' ? 'Unable to verify' : null };
  }
}

const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const refHash = (kind, number) => (number ? crypto.createHmac('sha256', env.phiKey).update(`${kind}:${String(number).toUpperCase().replace(/[\s-]/g, '')}`).digest('hex') : null);
const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z]/g, '');
const addMonths = (date, n) => { const d = new Date(`${date}T00:00:00`); d.setMonth(d.getMonth() + n); return d.toISOString().slice(0, 10); };
const check = (name, result, message) => ({ check: name, result, message });

/** Same reference number (or same ID file) on another applicant's application. */
async function duplicates(conn, appId, applicantId, hash) {
  if (!hash) return 0;
  const [[r]] = await conn.query(
    `SELECT COUNT(*) AS n FROM tbl_verifications v JOIN tbl_adoption_applications a ON a.application_id = v.application_id
      WHERE v.reference_hash = ? AND v.application_id <> ? AND a.applicant_id <> ?`, [hash, appId, applicantId]);
  return Number(r.n);
}
async function duplicateFiles(conn, appId, applicantId) {
  const [[r]] = await conn.query(
    `SELECT COUNT(*) AS n FROM tbl_adoption_documents d JOIN tbl_adoption_documents o ON o.sha256 = d.sha256 AND o.application_id <> d.application_id
       JOIN tbl_adoption_applications oa ON oa.application_id = o.application_id
      WHERE d.application_id = ? AND d.doc_type = 'valid_id' AND d.status = 'Uploaded' AND d.sha256 IS NOT NULL AND oa.applicant_id <> ?`, [appId, applicantId]);
  return Number(r.n);
}

/** Automatic checks for the government ID. Returns { status, checks }. Never "Verified". */
async function idChecks(conn, app, form, hash) {
  const rule = R.ID_TYPES[form.id_type];
  const checks = [];
  checks.push(rule ? check('ID type recognised', 'pass', form.id_type) : check('ID type recognised', 'fail', `"${form.id_type_other || form.id_type}" is not on the list of recognised IDs.`));
  if (rule?.format) checks.push(rule.format.test(form.id_number) ? check('ID number format', 'pass', 'Matches the format for this ID type.') : check('ID number format', 'fail', `Doesn't match the ${form.id_type} format${rule.example ? ` (e.g. ${rule.example})` : ''}.`));
  else checks.push(check('ID number format', 'n/a', 'This ID type has no fixed number format to check.'));
  if (rule && !rule.expires) checks.push(check('Expiry', 'n/a', 'This ID has no expiry date.'));
  else if (!form.id_expiry) checks.push(check('Expiry', 'warn', 'No expiry date entered.'));
  else checks.push(form.id_expiry > today() ? check('Expiry', 'pass', `Valid until ${form.id_expiry}.`) : check('Expiry', 'fail', `Expired on ${form.id_expiry}.`));
  checks.push(norm(form.id_name) === norm(form.legal_name) ? check('Name matches the application', 'pass', 'Same as page 1.')
    : check('Name matches the application', 'fail', 'The name on the ID differs from the legal name on page 1.'));
  checks.push(form.id_dob === form.date_of_birth ? check('Date of birth matches the application', 'pass', 'Same as page 1.')
    : check('Date of birth matches the application', 'fail', 'The date of birth on the ID differs from page 1.'));
  const dup = await duplicates(conn, app.application_id, app.applicant_id, hash);
  checks.push(dup ? check('Not used by another applicant', 'warn', 'The same ID number is on another applicant\'s application.') : check('Not used by another applicant', 'pass', 'No other applicant uses this number.'));
  const dupFile = await duplicateFiles(conn, app.application_id, app.applicant_id);
  checks.push(dupFile ? check('ID file not reused', 'warn', 'The same ID file was uploaded by another applicant.') : check('ID file not reused', 'pass', 'The uploaded file is unique.'));
  // What was read from the ID photo (OCR): supports or questions the typed details, never proves them.
  const read = IdReader.compare(await IdReader.latestForApplication(conn, app.application_id), form);
  checks.push(...read.checks);
  const off = await official('government_id', { type: form.id_type, number: form.id_number, holder: form.id_name, dob: form.id_dob, expiry: form.id_expiry || null });
  checks.push(off.check);
  const failed = (name) => checks.some((c) => c.check === name && c.result === 'fail');
  let status = failed('ID type recognised') ? 'Unrecognized ID'
    : read.typeMismatch ? 'ID type mismatch'
      : failed('ID number format') ? 'Invalid ID number'
        : failed('Expiry') ? 'Expired'
          : failed('Name matches the application') || failed('Date of birth matches the application') ? 'Information mismatch'
            : off.status ? off.status
              : dup || dupFile || read.flags.length ? 'Flagged for review' : 'Manual verification required';
  // Only an authorized provider's confirmation, with every other check clean, verifies automatically.
  const auto = off.verified && status === 'Manual verification required' ? { provider: off.provider, reference: off.reference } : null;
  if (auto) status = 'Verified';
  return { status, checks, auto };
}

/** Automatic checks for one clearance. */
async function clearanceChecks(conn, app, row, hash) {
  const checks = [];
  const expires = row.issue_date ? addMonths(row.issue_date, R.CLEARANCE_VALID_MONTHS) : null;
  checks.push(R.CLEARANCE_KINDS.includes(row.kind) ? check('Clearance type', 'pass', row.kind) : check('Clearance type', 'fail', 'Unknown clearance type.'));
  checks.push(/^[A-Z0-9-]{4,50}$/.test(row.number || '') ? check('Reference number', 'pass', 'Entered.') : check('Reference number', 'fail', 'Missing or unreadable reference number.'));
  checks.push(expires && expires > today() ? check('Issued within 12 months', 'pass', `Valid until ${expires}.`) : check('Issued within 12 months', 'fail', `Older than ${R.CLEARANCE_VALID_MONTHS} months.`));
  const dup = await duplicates(conn, app.application_id, app.applicant_id, hash);
  checks.push(dup ? check('Not used by another applicant', 'warn', 'The same clearance number is on another applicant\'s application.') : check('Not used by another applicant', 'pass', 'No other applicant uses this number.'));
  const off = await official('clearance', { type: row.kind, number: row.number, holder: row.holder, issueDate: row.issue_date });
  checks.push(off.check);
  let status = checks.some((c) => c.result === 'fail' && c.check === 'Issued within 12 months') ? 'Expired'
    : off.status ? off.status
      : checks.some((c) => c.result === 'fail') ? 'Invalid' : dup ? 'Flagged for review' : 'Manual verification required';
  const auto = off.verified && status === 'Manual verification required' ? { provider: off.provider, reference: off.reference } : null;
  if (auto) status = 'Verified';
  return { status, checks, expires, auto };
}

async function addEvent(conn, verificationId, from, to, actorId, detail) {
  await conn.query('INSERT INTO tbl_verification_events (verification_id, from_status, to_status, actor_id, detail) VALUES (?, ?, ?, ?, ?)',
    [verificationId, from, to, actorId || null, detail ? String(detail).slice(0, 500) : null]);
}

/** Creates or refreshes the verification rows from the application's answers (in the caller's transaction). */
async function syncFromForm(conn, app, form, actorId = null) {
  const items = [];
  if (form.id_type && form.id_number) {
    items.push({ slot: 'id', kind: 'government_id', item_type: form.id_type === 'Other' ? (form.id_type_other || 'Other') : form.id_type,
      number: form.id_number, holder: form.id_name, issue_date: null, expiry_date: form.id_expiry || null });
  }
  (Array.isArray(form.clearances) ? form.clearances : []).forEach((c, i) => {
    items.push({ slot: `clearance-${i + 1}`, kind: 'clearance', item_type: c.kind, number: c.number, holder: c.holder, issue_date: c.issue_date || null, row: c });
  });
  for (const it of items) {
    const hash = refHash(it.kind === 'government_id' ? `id:${it.item_type}` : 'clearance', it.number);
    const result = it.kind === 'government_id' ? await idChecks(conn, app, form, hash) : await clearanceChecks(conn, app, it.row, hash);
    const expiry = it.kind === 'government_id' ? it.expiry_date : result.expires;
    const [[cur]] = await conn.query('SELECT verification_id, status, reference_hash, issue_date, expiry_date, item_type FROM tbl_verifications WHERE application_id = ? AND slot = ? FOR UPDATE', [app.application_id, it.slot]);
    const sameData = cur && cur.reference_hash === hash && cur.item_type === it.item_type;
    if (cur && sameData && cur.status === 'Verified') continue; // a person's verification stands until the data changes
    if (!cur) {
      const [r] = await conn.query(
        `INSERT INTO tbl_verifications (application_id, kind, slot, item_type, reference_enc, reference_hash, holder_enc, issue_date, expiry_date, status, checks, method, method_ref, reviewed_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [app.application_id, it.kind, it.slot, it.item_type, encField(it.number), hash, encField(it.holder || ''), it.issue_date, expiry, result.status, JSON.stringify(result.checks),
          result.auto ? `Official verification: ${result.auto.provider}` : null, result.auto?.reference || null, result.auto ? new Date() : null]);
      await addEvent(conn, r.insertId, null, result.status, actorId, result.auto ? `Confirmed by ${result.auto.provider}` : 'Automatic checks');
    } else {
      await conn.query(
        `UPDATE tbl_verifications SET item_type = ?, reference_enc = ?, reference_hash = ?, holder_enc = ?, issue_date = ?, expiry_date = ?, status = ?, checks = ?,
                method = ?, method_ref = ?, reviewed_by = NULL, reviewed_at = ? WHERE verification_id = ?`,
        [it.item_type, encField(it.number), hash, encField(it.holder || ''), it.issue_date, expiry, result.status, JSON.stringify(result.checks),
          result.auto ? `Official verification: ${result.auto.provider}` : null, result.auto?.reference || null, result.auto ? new Date() : null, cur.verification_id]);
      if (cur.status !== result.status || !sameData) await addEvent(conn, cur.verification_id, cur.status, result.status, actorId, sameData ? 'Automatic checks re-run' : 'Details changed; automatic checks re-run');
    }
  }
}

/** Rows for one application. Verified rows past their expiry show as Expired. */
async function list(appId, { withHistory = false } = {}) {
  const [rows] = await pool.query(
    `SELECT v.verification_id, v.kind, v.slot, v.item_type, v.reference_enc, v.holder_enc, DATE_FORMAT(v.issue_date, '%Y-%m-%d') AS issue_date,
            DATE_FORMAT(v.expiry_date, '%Y-%m-%d') AS expiry_date, v.status, v.checks, v.method, v.method_ref, v.note, v.reviewed_at, u.full_name AS reviewed_by_name, v.updated_at, v.created_at
       FROM tbl_verifications v LEFT JOIN tbl_users u ON u.user_id = v.reviewed_by WHERE v.application_id = ? ORDER BY v.kind DESC, v.slot`, [appId]);
  const out = rows.map((r) => {
    const expired = r.expiry_date && r.expiry_date <= today();
    return {
      verification_id: r.verification_id, kind: r.kind, slot: r.slot, item_type: r.item_type, reference: decField(r.reference_enc), holder: decField(r.holder_enc),
      issue_date: r.issue_date, expiry_date: r.expiry_date, status: expired && r.status === 'Verified' ? 'Expired' : r.status,
      checks: typeof r.checks === 'string' ? JSON.parse(r.checks) : (r.checks || []), method: r.method, method_ref: r.method_ref, note: r.note,
      reviewed_at: r.reviewed_at, reviewed_by_name: r.reviewed_by_name, last_checked: r.updated_at || r.created_at,
    };
  });
  if (withHistory && out.length) {
    const [ev] = await pool.query(
      `SELECT e.verification_id, e.from_status, e.to_status, e.detail, e.created_at, u.full_name AS actor FROM tbl_verification_events e
         LEFT JOIN tbl_users u ON u.user_id = e.actor_id WHERE e.verification_id IN (?) ORDER BY e.created_at DESC, e.event_id DESC`, [out.map((o) => o.verification_id)]);
    for (const o of out) o.history = ev.filter((e) => e.verification_id === o.verification_id).map((e) => ({ ...e, actor: e.actor || 'Automatic checks' }));
  }
  return out;
}

/** Rows that keep the application from being complete (anything not Verified and current). */
async function blocking(appId) {
  return (await list(appId)).filter((r) => r.status !== 'Verified')
    .map((r) => ({ doc_type: `verification:${r.slot}`, label: r.kind === 'government_id' ? `Government ID (${r.item_type})` : `${r.item_type} of ${r.holder || 'applicant'}`, status: r.status }));
}

const REVIEW_RESULTS = {
  government_id: ['Verified', 'Invalid ID', 'Expired', 'Information mismatch', 'Invalid ID number', 'ID type mismatch', 'Unrecognized ID', 'Unable to verify', 'Flagged for review', 'Requires correction'],
  clearance: ['Verified', 'Not verified', 'Expired', 'Invalid', 'Verification failed', 'Requires correction', 'Flagged for review'],
};

/** A person's review: the result, how it was verified (for Verified), an optional reference and a note. */
async function review(conn, req, app, verificationId, body) {
  const [[v]] = await conn.query('SELECT * FROM tbl_verifications WHERE verification_id = ? AND application_id = ? FOR UPDATE', [verificationId, app.application_id]);
  if (!v) throw new HttpError(404, 'Record not found.');
  const status = String(body?.status || '');
  if (!REVIEW_RESULTS[v.kind].includes(status)) throw new HttpError(400, 'Choose a review result.');
  const method = String(body?.method || '');
  if (status === 'Verified' && !R.VERIFY_METHODS.includes(method)) throw new HttpError(400, 'Choose how you verified it.');
  if (status === 'Verified' && v.expiry_date && new Date(v.expiry_date) <= new Date()) throw new HttpError(409, 'This record has expired and cannot be marked verified.');
  const note = String(body?.note || '').trim().slice(0, 500);
  if (status === 'Requires correction' && note.length < 5) throw new HttpError(400, 'Tell the applicant what to correct (at least 5 characters).');
  const ref = String(body?.method_ref || '').trim().slice(0, 120) || null;
  await conn.query('UPDATE tbl_verifications SET status = ?, method = ?, method_ref = ?, note = ?, reviewed_by = ?, reviewed_at = NOW() WHERE verification_id = ?',
    [status, status === 'Verified' ? method : null, status === 'Verified' ? ref : null, note || null, req.user.user_id, verificationId]);
  await addEvent(conn, verificationId, v.status, status, req.user.user_id, [status === 'Verified' ? method : null, ref ? `ref ${ref}` : null, note || null].filter(Boolean).join('; '));
  return { kind: v.kind, slot: v.slot, from: v.status, to: status, note };
}

module.exports = { syncFromForm, list, blocking, review, REVIEW_RESULTS };
