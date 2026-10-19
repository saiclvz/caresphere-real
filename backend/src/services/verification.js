/**
 * Government ID and clearance verification for adoption applications.
 *
 * When an application is submitted (and when the applicant corrects a record), each ID and clearance gets
 * a verification row with automatic checks: recognised ID type, number format, expiry or issue date, the
 * name and date of birth against page 1, and the same number or file on another applicant's application.
 * No official verification service is connected, so the best automatic result is "Manual verification
 * required"; only a person's review (recording how they verified it) can set "Verified", and only an
 * authorized provider (config/verificationProviders.js) can give "Verified – real and valid". OCR, number
 * formats, matching details and image checks never prove an ID genuine and never call it fake. Every change
 * is written to tbl_verification_events and every check run and review to the activity log.
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
  if (!p) return { check: check('Official verification', 'n/a', none), attempt: null };
  try {
    const r = await Promise.race([p.verify(query), new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), Providers.TIMEOUT_MS))]);
    const at = new Date().toISOString();
    const attempt = (result) => `Official check by ${p.name} at ${at}: ${result}${r?.reference ? ` (ref ${r.reference})` : ''}`;
    if (r?.result === 'verified') return { check: check('Official verification', 'pass', `Confirmed by ${p.name}${r.reference ? ` (ref ${r.reference})` : ''} on ${at.slice(0, 16).replace('T', ' ')} UTC.`), verified: true, provider: p.name, reference: r.reference || null, attempt: attempt('verified') };
    if (r?.result === 'not_found') return { check: check('Official verification', 'fail', `${p.name} has no record of this number.`), status: kind === 'government_id' ? 'Invalid ID' : 'Invalid', attempt: attempt('not found') };
    if (r?.result === 'mismatch') return { check: check('Official verification', 'fail', `${p.name} returned different details${r.detail ? `: ${r.detail}` : '.'}`), status: kind === 'government_id' ? 'Information mismatch' : 'Verification failed', attempt: attempt('details differ') };
    return { check: check('Official verification', 'warn', `${p.name} could not be reached. A person must verify it.`), status: kind === 'government_id' ? 'Unable to verify' : null, attempt: attempt('unavailable') };
  } catch (err) {
    return { check: check('Official verification', 'warn', `${p.name} could not be reached. A person must verify it.`), status: kind === 'government_id' ? 'Unable to verify' : null, attempt: `Official check by ${p.name}: no answer (${err.message})` };
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
    `SELECT COUNT(*) AS n FROM tbl_adoption_documents d JOIN tbl_adoption_documents o ON o.sha256 = d.sha256 AND o.application_id <> d.application_id AND o.archived_at IS NULL
       JOIN tbl_adoption_applications oa ON oa.application_id = o.application_id
      WHERE d.application_id = ? AND d.doc_type = 'valid_id' AND d.status = 'Uploaded' AND d.sha256 IS NOT NULL AND oa.applicant_id <> ?`, [appId, applicantId]);
  return Number(r.n);
}

/**
 * Automatic checks for the government ID: the typed details, the duplicate checks, the scan of the front
 * and back photos (services/idScan) and the official adapter for the ID type. Returns { status, checks,
 * auto, auto_result, official }. The status is never "Verified" unless an authorized automatic source
 * returned success (and nothing else failed).
 */
async function idChecks(conn, app, form, hash) {
  const IdTypes = require('./idTypes');
  const IdScan = require('./idScan');
  const Adapters = require('./verificationAdapters');
  const rule = form.id_type && form.id_type !== 'Other' ? await IdTypes.get(form.id_type) : null;
  const checks = [];
  checks.push(rule ? check('ID type recognised', 'pass', rule.label) : check('ID type recognised', 'fail', `"${form.id_type_other || form.id_type}" is not on the list of recognised IDs.`));
  if (rule?.numberRegex) checks.push(rule.numberRegex.test(String(form.id_number || '').toUpperCase().replace(/\s+/g, '')) ? check('ID number format', 'pass', 'The number entered matches the format for this ID type.') : check('ID number format', 'fail', `The number entered doesn't match the ${rule.label} format${rule.example ? ` (e.g. ${rule.example})` : ''}.`));
  else checks.push(check('ID number format', 'n/a', 'This ID type has no fixed number format to check.'));
  // Expiration (typed): Valid / Expired / Expiration date not available / Unable to determine.
  const validDate = /^\d{4}-\d{2}-\d{2}$/.test(String(form.id_expiry || '')) && !Number.isNaN(new Date(`${form.id_expiry}T00:00:00`).getTime());
  if (form.id_expiry && !validDate) checks.push(check('Expiry', 'warn', 'Unable to determine: the expiry date entered is not a valid date.'));
  else if (form.id_expiry) checks.push(form.id_expiry > today() ? check('Expiry', 'pass', `Valid: valid until ${IdReader.longDate(form.id_expiry)}.`) : check('Expiry', 'fail', `Expired: expired on ${IdReader.longDate(form.id_expiry)}.`));
  else if (rule && !rule.expires) checks.push(check('Expiry', 'n/a', 'Expiration date not available: this ID type has no expiry date.'));
  else if (rule) checks.push(check('Expiry', 'warn', 'Expiration date not available: no expiry date was entered for an ID that expires.'));
  else checks.push(check('Expiry', 'warn', 'Unable to determine: this ID type is not recognised and no expiry date was entered.'));
  // Typed ID details against the application (page 1).
  const diffs = [];
  if (norm(form.id_name) !== norm(form.legal_name)) diffs.push(`Name – System: ${form.legal_name || 'not given'} · ID: ${form.id_name || 'not given'}`);
  if (form.id_dob !== form.date_of_birth) diffs.push(`Date of birth – System: ${IdReader.longDate(form.date_of_birth)} · ID: ${IdReader.longDate(form.id_dob)}`);
  checks.push(diffs.length ? check('Applicant information', 'fail', `Information mismatch. ${diffs.join('. ')}.`)
    : check('Applicant information', 'pass', 'Information match: name and date of birth are the same as the application.'));
  const dup = await duplicates(conn, app.application_id, app.applicant_id, hash);
  checks.push(dup ? check('Not used by another applicant', 'warn', 'The same ID number is on another applicant\'s application.') : check('Not used by another applicant', 'pass', 'No other applicant uses this number.'));
  const dupFile = await duplicateFiles(conn, app.application_id, app.applicant_id);
  checks.push(dupFile ? check('ID file not reused', 'warn', 'The same ID file was uploaded by another applicant.') : check('ID file not reused', 'pass', 'The uploaded file is unique.'));

  // The scan of the front and back photos. Supports or questions the details; never proves the ID genuine.
  const scan = await IdScan.forApplication(conn, app, form);
  checks.push(...scan.summary.checks.map((c) => ({ check: `Scan – ${c.check}`, result: c.result, message: c.message })));
  scan.summary.flag_text.forEach((t) => checks.push(check('Review flag', 'warn', t)));

  // Official verification (the adapter for this ID type).
  const off = await Adapters.run(rule?.adapter || 'manual', { type: form.id_type, number: form.id_number, holder: form.id_name, dob: form.id_dob, expiry: form.id_expiry || null, scan: scan.summary.extracted });
  if (off.status === 'verified') checks.push(check('Official verification', 'pass', `Confirmed by ${off.source}${off.reference ? ` (ref ${off.reference})` : ''}.`));
  else if (off.status === 'not_verified') checks.push(check('Official verification', 'fail', `${off.source} did not confirm this ID${off.detail ? `: ${off.detail}` : '.'}`));
  else if (off.status === 'unable') checks.push(check('Official verification', 'warn', `${off.source || 'The official service'} could not be reached. Unable to verify; a person must verify it.`));
  else if (off.status === 'failed') checks.push(check('Official verification', 'warn', `${off.source || 'The official service'} gave an unexpected answer. Verification failed; a person must verify it.`));
  else if (off.status === 'staff_step') checks.push(check('Official verification', 'n/a', 'PhilSys Check: an authorized staff member scans the original QR at verify.philsys.gov.ph and records the result.'));
  else checks.push(check('Official verification', 'n/a', off.detail || 'No official verification service is connected. A person must verify the original ID.'));

  const failed = (name) => checks.some((c) => c.check === name && c.result === 'fail');
  let status = failed('ID type recognised') ? 'Unrecognized ID'
    : scan.summary.status_hint === 'ID type mismatch' ? 'ID type mismatch'
      : failed('ID number format') || scan.summary.status_hint === 'Invalid ID number' ? 'Invalid ID number'
        : failed('Expiry') || scan.summary.status_hint === 'Expired' ? 'Expired'
          : failed('Applicant information') || scan.summary.status_hint === 'Information mismatch' ? 'Information mismatch'
            : scan.summary.status_hint === 'Unrecognized ID' ? 'Unrecognized ID'
              : off.status === 'not_verified' ? 'Invalid ID'
                : off.status === 'unable' ? 'Unable to verify'
                  : off.status === 'failed' ? 'Verification failed'
                  : dup || dupFile || scan.summary.flags.length ? 'Flagged for review' : 'Manual verification required';
  // Only an authorized automatic source's confirmation, with every other check clean, verifies automatically.
  const auto = off.status === 'verified' && off.mode === 'automatic' && status === 'Manual verification required' ? { provider: off.source, reference: off.reference } : null;
  if (auto) status = 'Verified';
  const attempt = off.source && off.mode === 'automatic' ? `Official check by ${off.source} at ${new Date(off.timestamp).toISOString()}: ${off.status}${off.reference ? ` (ref ${off.reference})` : ''}` : null;
  return { status, checks, auto, attempt, auto_result: scan.summary.auto_result, official: off.mode === 'automatic' ? off : null };
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
  return { status, checks, expires, auto, attempt: off.attempt };
}

/** Stores an automatic official verification result (source, reference, time, raw result encrypted). */
async function recordOfficial(conn, verificationId, off) {
  if (!off) return;
  await conn.query(
    `UPDATE tbl_verifications SET official_source = ?, official_result = ?, official_reference = ?, official_at = ?, official_by = NULL,
            official_mode = 'automatic', official_raw_enc = ? WHERE verification_id = ?`,
    [off.source, off.status, off.reference || null, off.timestamp || new Date(), off.raw ? encField(JSON.stringify(off.raw)) : null, verificationId]);
}

async function addEvent(conn, verificationId, from, to, actorId, detail) {
  await conn.query('INSERT INTO tbl_verification_events (verification_id, from_status, to_status, actor_id, detail) VALUES (?, ?, ?, ?, ?)',
    [verificationId, from, to, actorId || null, detail ? String(detail).slice(0, 500) : null]);
}

/** Creates or refreshes the verification rows from the application's answers (in the caller's transaction). */
async function syncFromForm(conn, app, form, actorId = null, { systemFor = null, trigger = 'Automatic checks' } = {}) {
  const { logSystemActivity } = require('../utils/audit');
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
    if (cur && sameData && cur.status === 'Verified') {
      // A person's (or a staff-confirmed official) verification stands until the data changes; the scan
      // results are still refreshed so reviewers see them.
      await conn.query('UPDATE tbl_verifications SET checks = ?, auto_result = ? WHERE verification_id = ?', [JSON.stringify(result.checks), result.auto_result || null, cur.verification_id]);
      continue;
    }
    if (!cur) {
      const [r] = await conn.query(
        `INSERT INTO tbl_verifications (application_id, kind, slot, item_type, reference_enc, reference_hash, holder_enc, issue_date, expiry_date, status, checks, method, method_ref, reviewed_at, auto_result)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [app.application_id, it.kind, it.slot, it.item_type, encField(it.number), hash, encField(it.holder || ''), it.issue_date, expiry, result.status, JSON.stringify(result.checks),
          result.auto ? `Official verification: ${result.auto.provider}` : null, result.auto?.reference || null, result.auto ? new Date() : null, result.auto_result || null]);
      await recordOfficial(conn, r.insertId, result.official);
      await addEvent(conn, r.insertId, null, result.status, actorId, [result.auto ? `Confirmed by ${result.auto.provider}` : 'Automatic checks', result.attempt].filter(Boolean).join('; '));
    } else {
      await conn.query(
        `UPDATE tbl_verifications SET item_type = ?, reference_enc = ?, reference_hash = ?, holder_enc = ?, issue_date = ?, expiry_date = ?, status = ?, checks = ?,
                method = ?, method_ref = ?, reviewed_by = NULL, reviewed_at = ?, auto_result = ? WHERE verification_id = ?`,
        [it.item_type, encField(it.number), hash, encField(it.holder || ''), it.issue_date, expiry, result.status, JSON.stringify(result.checks),
          result.auto ? `Official verification: ${result.auto.provider}` : null, result.auto?.reference || null, result.auto ? new Date() : null, result.auto_result || null, cur.verification_id]);
      await recordOfficial(conn, cur.verification_id, result.official);
      if (cur.status !== result.status || !sameData) await addEvent(conn, cur.verification_id, cur.status, result.status, actorId, [sameData ? 'Automatic checks re-run' : 'Details changed; automatic checks re-run', result.attempt].filter(Boolean).join('; '));
    }
    // Activity log: which record, the ID type, the result, and the official attempt (if any).
    await logSystemActivity(conn, actorId || systemFor,
      `${it.kind === 'government_id' ? 'ID' : 'CLEARANCE'}_AUTOMATIC_CHECK (${it.slot}, ${it.item_type}: ${cur ? `${cur.status} -> ` : ''}${result.status}; ${trigger}${result.attempt ? `; ${result.attempt}` : '; no official source connected'})`,
      `Application #${app.application_id}`);
  }
}

/** Rows for one application. Verified rows past their expiry show as Expired. */
async function list(appId, { withHistory = false } = {}) {
  const [rows] = await pool.query(
    `SELECT v.verification_id, v.kind, v.slot, v.item_type, v.reference_enc, v.holder_enc, DATE_FORMAT(v.issue_date, '%Y-%m-%d') AS issue_date,
            DATE_FORMAT(v.expiry_date, '%Y-%m-%d') AS expiry_date, v.status, v.checks, v.method, v.method_ref, v.note, v.reviewed_at, u.full_name AS reviewed_by_name,
            ur.role_name AS reviewed_by_role, v.updated_at, v.created_at, v.auto_result, v.official_source, v.official_result, v.official_reference, v.official_at,
            v.official_mode, ou.full_name AS official_by_name, our.role_name AS official_by_role
       FROM tbl_verifications v LEFT JOIN tbl_users u ON u.user_id = v.reviewed_by LEFT JOIN tbl_roles ur ON ur.role_id = u.role_id
       LEFT JOIN tbl_users ou ON ou.user_id = v.official_by LEFT JOIN tbl_roles our ON our.role_id = ou.role_id
      WHERE v.application_id = ? ORDER BY v.kind DESC, v.slot`, [appId]);
  const out = rows.map((r) => {
    const expired = r.expiry_date && r.expiry_date <= today();
    return {
      verification_id: r.verification_id, kind: r.kind, slot: r.slot, item_type: r.item_type, reference: decField(r.reference_enc), holder: decField(r.holder_enc),
      issue_date: r.issue_date, expiry_date: r.expiry_date, status: expired && r.status === 'Verified' ? 'Expired' : r.status,
      checks: typeof r.checks === 'string' ? JSON.parse(r.checks) : (r.checks || []), method: r.method, method_ref: r.method_ref, note: r.note,
      reviewed_at: r.reviewed_at, reviewed_by_name: r.reviewed_by_name, reviewed_by_role: r.reviewed_by_role, last_checked: r.updated_at || r.created_at,
      auto_result: r.auto_result || null,
      official: r.official_source ? { source: r.official_source, result: r.official_result, reference: r.official_reference, at: r.official_at, mode: r.official_mode,
        by_name: r.official_by_name || null, by_role: r.official_by_role || null } : null,
    };
  });
  if (withHistory && out.length) {
    const [ev] = await pool.query(
      `SELECT e.verification_id, e.from_status, e.to_status, e.detail, e.created_at, u.full_name AS actor FROM tbl_verification_events e
         LEFT JOIN tbl_users u ON u.user_id = e.actor_id WHERE e.verification_id IN (?) ORDER BY e.created_at DESC, e.event_id DESC`, [out.map((o) => o.verification_id)]);
    for (const o of out) o.history = ev.filter((e) => e.verification_id === o.verification_id).map((e) => ({ ...e, actor: e.actor || 'Automatic checks' }));
    // Staff review: the scan of the front and back next to what the applicant entered.
    const id = out.find((o) => o.kind === 'government_id');
    if (id) {
      const Adoption = require('../models/adoptionModel');
      const form = await Adoption.form(appId);
      const [[app]] = await pool.query('SELECT application_id, applicant_id FROM tbl_adoption_applications WHERE application_id = ?', [appId]);
      const scan = await require('./idScan').forApplication(pool, app, form);
      const side = (x) => (x ? { document_id: x.document_id, state: x.state, result: x.result, attempt_no: x.attempt_no, detected_type: x.detected_type, detected_side: x.detected_side,
        quality: x.quality, checks: x.checks, flags: x.flags, fields: x.fields, machine: x.machine, purged: x.purged, created_at: x.created_at } : null);
      id.scan = {
        front: side(scan.front), back: side(scan.back), attempts: scan.attempts, rule: scan.rule ? { key: scan.rule.key, label: scan.rule.label, adapter: scan.rule.adapter, machine: scan.rule.machine, needs_back: scan.rule.needsBack } : null,
        checks: scan.summary.checks, flags: scan.summary.flag_text, auto_result: scan.summary.auto_result, extracted: scan.summary.extracted, expiry: scan.summary.expiry,
      };
      id.applicant_info = { full_name: form.legal_name || null, date_of_birth: form.date_of_birth || null, id_type: id.item_type, id_number: id.reference,
        name_on_id: form.id_name || null, dob_on_id: form.id_dob || null, expiry_on_id: form.id_expiry || null };
      id.adapter = scan.rule?.adapter || 'manual';
    }
  }
  return out;
}

/** Rows that keep the application from being complete (anything not Verified and current). */
async function blocking(appId) {
  return (await list(appId)).filter((r) => r.status !== 'Verified')
    .map((r) => ({ doc_type: `verification:${r.slot}`, label: r.kind === 'government_id' ? `Government ID (${r.item_type})` : `${r.item_type} of ${r.holder || 'applicant'}`, status: r.status }));
}

/** Statuses that need a person's attention (manual verification, a flag, or a problem to confirm). */
const NEEDS_REVIEW = ['Pending verification', 'Manual verification required', 'Flagged for review', 'Unable to verify', 'ID type mismatch',
  'Information mismatch', 'Invalid ID number', 'Unrecognized ID', 'Expired', 'Invalid', 'Not verified', 'Verification failed'];

/**
 * The review queue: ID and clearance records waiting for a person. Admin sees all; Staff only applications
 * assigned to them. No ID numbers or names from the ID are returned here (open the application to review).
 */
async function queue({ staffId = null } = {}) {
  // Staff: applications they are assigned to through the one assignment service (own rows or the child's).
  const mine = staffId ? [...await require('./assignment').recordIdsFor(pool, 'adoption_application', staffId)].map(Number) : null;
  if (mine && !mine.length) return [];
  const [rows] = await pool.query(
    `SELECT v.verification_id, v.application_id, v.kind, v.slot, v.item_type, v.status, v.updated_at, v.created_at,
            a.reference_no, a.status AS application_status, ad.legal_name, a.assigned_staff_id, su.full_name AS assigned_staff_name
       FROM tbl_verifications v JOIN tbl_adoption_applications a ON a.application_id = v.application_id
       LEFT JOIN tbl_applicant_details ad ON ad.application_id = a.application_id
       LEFT JOIN tbl_users su ON su.user_id = a.assigned_staff_id AND su.is_active = TRUE
      WHERE v.status IN (?) AND a.status NOT IN ('Draft', 'Declined', 'Withdrawn', 'Closed') AND a.archived_at IS NULL
        ${mine ? 'AND a.application_id IN (?)' : ''}
      ORDER BY FIELD(v.status, 'Flagged for review', 'ID type mismatch', 'Information mismatch') DESC, COALESCE(v.updated_at, v.created_at)`,
    mine ? [NEEDS_REVIEW, mine] : [NEEDS_REVIEW]);
  return rows;
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
  // Reject (any negative result) needs a written reason; so does clearing a mismatch or flag to Verified.
  const rejects = v.kind === 'government_id' ? R.ID_REJECT_REASONS : R.CLEARANCE_REJECT_REASONS;
  if (rejects.includes(status) && note.length < 5) throw new HttpError(400, 'Give the reason for rejecting (at least 5 characters).');
  if (status === 'Verified' && R.NEEDS_RESOLUTION_NOTE.includes(v.status) && note.length < 5) {
    throw new HttpError(400, `This record is "${v.status}". Explain how you resolved it before verifying (at least 5 characters).`);
  }
  const ref = String(body?.method_ref || '').trim().slice(0, 120) || null;
  await conn.query('UPDATE tbl_verifications SET status = ?, method = ?, method_ref = ?, note = ?, reviewed_by = ?, reviewed_at = NOW() WHERE verification_id = ?',
    [status, status === 'Verified' ? method : null, status === 'Verified' ? ref : null, note || null, req.user.user_id, verificationId]);
  await addEvent(conn, verificationId, v.status, status, req.user.user_id, [status === 'Verified' ? method : null, ref ? `ref ${ref}` : null, note || null].filter(Boolean).join('; '));
  return { kind: v.kind, slot: v.slot, item_type: v.item_type, from: v.status, to: status, note, method: status === 'Verified' ? method : null };
}

const PHILSYS_RESULTS = { verified: 'Verified', deactivated: 'Deactivated card', unreadable: 'QR code could not be read' };

/**
 * PhilSys Check, recorded by authorized staff: they scanned the ORIGINAL card's QR at verify.philsys.gov.ph
 * and record what it showed. Marked "Staff-confirmed", never "automatic". Only a 'verified' result whose
 * displayed details match the printed details makes the ID "Verified – real and valid".
 */
async function recordPhilSysCheck(conn, req, app, verificationId, body) {
  const [[v]] = await conn.query('SELECT * FROM tbl_verifications WHERE verification_id = ? AND application_id = ? FOR UPDATE', [verificationId, app.application_id]);
  if (!v || v.kind !== 'government_id') throw new HttpError(404, 'Record not found.');
  const rule = await require('./idTypes').get(v.item_type);
  if (rule?.adapter !== 'philsys_check') throw new HttpError(400, 'PhilSys Check applies to the PhilSys National ID only.');
  const result = String(body?.result || '');
  if (!PHILSYS_RESULTS[result]) throw new HttpError(400, 'Choose what PhilSys Check showed.');
  const matches = body?.details_match === true;
  if (result === 'verified' && body?.details_match !== true && body?.details_match !== false) throw new HttpError(400, 'Say whether the details PhilSys Check displayed match the printed card.');
  const note = String(body?.note || '').trim().slice(0, 500);
  if (result === 'verified' && !matches && note.length < 5) throw new HttpError(400, 'Describe which details differ (at least 5 characters).');
  const reference = String(body?.reference || '').trim().slice(0, 120) || null;
  const status = result === 'verified' ? (matches ? 'Verified' : 'Information mismatch') : result === 'deactivated' ? 'Invalid ID' : 'Unable to verify';
  if (status === 'Verified' && v.expiry_date && new Date(v.expiry_date) <= new Date()) throw new HttpError(409, 'This ID has expired and cannot be marked verified.');
  await conn.query(
    `UPDATE tbl_verifications SET status = ?, official_source = 'PhilSys Check (verify.philsys.gov.ph)', official_result = ?, official_reference = ?, official_at = NOW(),
            official_by = ?, official_mode = 'staff_confirmed', official_raw_enc = ?, method = ?, method_ref = ?, note = ?, reviewed_by = ?, reviewed_at = NOW()
      WHERE verification_id = ?`,
    [status, result, reference, req.user.user_id, encField(JSON.stringify({ result, details_match: matches, note })),
      status === 'Verified' ? 'Official verification: PhilSys Check (Staff-confirmed)' : null, reference, note || null, req.user.user_id, verificationId]);
  await addEvent(conn, verificationId, v.status, status, req.user.user_id, `PhilSys Check (Staff-confirmed): ${PHILSYS_RESULTS[result]}${result === 'verified' ? `; details ${matches ? 'match' : 'differ'}` : ''}${note ? `; ${note}` : ''}`);
  return { from: v.status, to: status, result, matches, item_type: v.item_type };
}

module.exports = { syncFromForm, list, blocking, review, queue, recordPhilSysCheck, PHILSYS_RESULTS, NEEDS_REVIEW, REVIEW_RESULTS };
