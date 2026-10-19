/**
 * Monthly reconciliation (Admin and Staff with Donations: cash verification).
 * The home enters or uploads (CSV) the lines of its e-wallet or bank statement: date, reference, amount. Each line is
 * matched to donations by method and normalized reference. The screen shows:
 *   - matched lines (and where the amount differs),
 *   - donations reported for that method and month that are NOT in the statement,
 *   - statement lines with no donation ("Unreported deposits"), which can be turned into a walk-in or anonymous
 *     donation after review (or dismissed with a note, for example a refund or a transfer between the home's accounts).
 * Every import is logged with who did it. Verified donations are never changed by an import.
 */
const { pool, withTransaction } = require('../config/db');
const HttpError = require('../utils/HttpError');
const LC = require('./donationLifecycle');
const L = require('../config/donationLifecycle');
const Donation = require('../models/donationModel');
const { toCents, centsToDecimal, dbToCents } = require('../utils/money');
const { readReference, normalizeReference, mask } = require('../utils/reference');
const { logActivityWith, logActivity } = require('../utils/audit');
const { sha256 } = require('../utils/crypto');
const { makeReceiptCode } = require('./donationService');
const claims = require('./donationClaims');
const cash = require('./cashControls');

const MAX_LINES = 2000;
const MAX_CSV = 1024 * 1024;
const PERIOD = /^\d{4}-(0[1-9]|1[0-2])$/;

function requireReconciler(req) {
  if (!claims.canVerify(req.user)) throw new HttpError(403, 'ACCESS DENIED – Reconciliation needs the Donations: cash verification duty.', { duty: 'cash_verification' });
}

/** Splits one CSV line (quotes and "" escapes). */
function csvCells(line) {
  const out = []; let cur = ''; let q = false;
  for (let i = 0; i < line.length; i += 1) {
    const c = line[i];
    if (q) { if (c === '"' && line[i + 1] === '"') { cur += '"'; i += 1; } else if (c === '"') q = false; else cur += c; continue; }
    if (c === '"') q = true; else if (c === ',') { out.push(cur); cur = ''; } else cur += c;
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

/** "2026-10-03" | "10/03/2026" (MM/DD/YYYY) | "03-Oct-2026" -> "2026-10-03" or null. */
function readDate(v) {
  const s = String(v || '').trim();
  let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s);
  if (m) return `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`;
  const MON = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
  m = /^(\d{1,2})[- ]([A-Za-z]{3})[a-z]*[- ,]+(\d{4})$/.exec(s);
  if (m && MON[m[2].toLowerCase()]) return `${m[3]}-${String(MON[m[2].toLowerCase()]).padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  return null;
}

/**
 * Lines from a CSV with a header row naming the date, reference and amount columns (any order; common names such
 * as "Transaction date", "Reference No.", "Credit" are recognised), or from typed rows.
 */
function readLines(body, period) {
  const errors = [];
  let raw = [];
  if (typeof body.csv === 'string' && body.csv.trim()) {
    if (Buffer.byteLength(body.csv) > MAX_CSV) throw new HttpError(422, 'The CSV file must be 1 MB or smaller.');
    const rows = body.csv.replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim());
    const head = csvCells(rows.shift() || '').map((h) => h.toLowerCase());
    const col = (re) => head.findIndex((h) => re.test(h));
    const iDate = col(/date/); const iRef = col(/ref|transaction (id|no)|trace/); const iAmt = col(/amount|credit|deposit/);
    if (iDate < 0 || iRef < 0 || iAmt < 0) throw new HttpError(422, 'The CSV needs a header row with Date, Reference and Amount columns.');
    raw = rows.map((r) => { const c = csvCells(r); return { date: c[iDate], reference: c[iRef], amount: c[iAmt] }; });
  } else if (Array.isArray(body.lines)) raw = body.lines.map((l) => ({ date: l?.date, reference: l?.reference, amount: l?.amount }));
  if (!raw.length) throw new HttpError(422, 'Add at least one statement line.');
  if (raw.length > MAX_LINES) throw new HttpError(422, `Up to ${MAX_LINES} lines per import.`);
  const lines = raw.map((r, i) => {
    const n = i + 1;
    const date = readDate(r.date);
    if (!date) { errors.push(`Line ${n}: the date isn't valid.`); return null; }
    if (date.slice(0, 7) !== period) { errors.push(`Line ${n}: the date isn't in ${period}.`); return null; }
    let ref; try { ref = readReference(r.reference); } catch (e) { errors.push(`Line ${n}: ${e.message}`); return null; }
    let cents; try { cents = toCents(String(r.amount ?? '').replace(/[₱PHP\s]/gi, ''), 'Amount', { min: 0.01, max: 99999999 }); } catch (e) { errors.push(`Line ${n}: ${e.message}`); return null; }
    return { line_no: n, date, ref, cents };
  });
  if (errors.length) throw new HttpError(422, `${errors.length} line${errors.length === 1 ? '' : 's'} need attention. Nothing was imported.`, { line_errors: errors.slice(0, 50) });
  return lines;
}

/** POST /reconciliation/imports { period, method_id, csv? | lines?, file_name?, note? } */
async function importStatement(req, body) {
  requireReconciler(req);
  const b = body || {};
  const period = String(b.period || '');
  if (!PERIOD.test(period)) throw new HttpError(422, 'Choose the month (YYYY-MM).', { errors: { period: 'Choose the month.' } });
  const [[method]] = await pool.query('SELECT method_id, code, name FROM tbl_payment_methods WHERE method_id = ?', [Number(b.method_id) || 0]);
  if (!method) throw new HttpError(422, 'Choose the account (payment method) this statement is for.', { errors: { method_id: 'Choose the account.' } });
  const lines = readLines(b, period);
  const fileHash = typeof b.csv === 'string' ? sha256(b.csv) : null;
  return withTransaction(async (conn) => {
    const [r] = await conn.query('INSERT INTO tbl_reconciliation_imports (period, method_id, source, file_name, file_sha256, line_count, imported_by, note) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [period, method.method_id, typeof b.csv === 'string' ? 'csv' : 'manual', b.file_name ? String(b.file_name).replace(/[^\w.\- ]+/g, '_').slice(0, 200) : null, fileHash, lines.length, req.user.user_id,
        b.note ? String(b.note).trim().slice(0, 500) : null]);
    const seen = new Set();
    const summary = { Matched: 0, 'Amount differs': 0, Unreported: 0, 'Duplicate line': 0 };
    for (const l of lines) {
      let status; let donationId = null;
      if (seen.has(l.ref.norm)) status = 'Duplicate line';
      else {
        seen.add(l.ref.norm);
        const [[d]] = await conn.query(
          `SELECT donation_id, reported_amount, verified_amount, amount FROM tbl_donations
            WHERE ((ref_method = ? AND reference_norm = ?) OR (payment_method_id = ? AND REPLACE(REPLACE(UPPER(verified_reference), ' ', ''), '-', '') = ?))
              AND (claim_status IS NULL OR claim_status NOT IN ('Withdrawn', 'Legacy cancelled')) AND status <> 'Voided'
            ORDER BY donation_id LIMIT 1`, [method.code, l.ref.norm, method.method_id, l.ref.norm]);
        if (d) {
          donationId = d.donation_id;
          const expected = dbToCents(d.verified_amount ?? d.reported_amount ?? d.amount);
          status = expected === l.cents ? 'Matched' : 'Amount differs';
        } else status = 'Unreported';
      }
      summary[status] += 1;
      await conn.query('INSERT INTO tbl_reconciliation_lines (import_id, line_no, txn_date, reference_raw, reference_norm, amount, match_status, donation_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        [r.insertId, l.line_no, l.date, l.ref.raw, l.ref.norm, centsToDecimal(l.cents), status, donationId]);
    }
    await logActivityWith(conn, req, `RECONCILIATION_IMPORTED (${method.name}, ${period}, ${lines.length} lines: ${summary.Matched} matched, ${summary.Unreported} unreported)`, `Reconciliation import #${r.insertId}`);
    return { import_id: r.insertId, summary };
  });
}

/** GET /reconciliation?period=&method_id= - imports, their lines and the donations not found in any statement. */
async function overview(req) {
  requireReconciler(req);
  const period = PERIOD.test(String(req.query?.period || '')) ? req.query.period : new Date().toISOString().slice(0, 7);
  const methodId = Number(req.query?.method_id) || null;
  const [imports] = await pool.query(
    `SELECT i.import_id, i.period, i.method_id, m.name AS method, i.source, i.file_name, i.line_count, i.imported_at, u.full_name AS imported_by_name, i.note
       FROM tbl_reconciliation_imports i JOIN tbl_payment_methods m ON m.method_id = i.method_id JOIN tbl_users u ON u.user_id = i.imported_by
      WHERE i.period = ?${methodId ? ' AND i.method_id = ?' : ''} ORDER BY i.imported_at DESC`, methodId ? [period, methodId] : [period]);
  const ids = imports.map((i) => i.import_id);
  const [lines] = ids.length ? await pool.query(
    `SELECT l.line_id, l.import_id, l.line_no, l.txn_date, l.reference_raw, l.amount, l.match_status, l.donation_id, d.donation_no, d.claim_status,
            l.reviewed_at, u.full_name AS reviewed_by_name, l.review_note
       FROM tbl_reconciliation_lines l LEFT JOIN tbl_donations d ON d.donation_id = l.donation_id LEFT JOIN tbl_users u ON u.user_id = l.reviewed_by
      WHERE l.import_id IN (?) ORDER BY l.import_id DESC, l.line_no`, [ids]) : [[]];
  // Reported (or verified) in this month for the methods imported, but no statement line has the reference.
  const methods = [...new Set(imports.map((i) => i.method_id))];
  const [missing] = methods.length ? await pool.query(
    `SELECT d.donation_id, d.donation_no, d.payment_method AS method, d.reference_raw, d.reported_amount, d.verified_amount, d.sent_at, d.claim_status
       FROM tbl_donations d
      WHERE d.payment_method_id IN (?) AND d.claim_status IN ('Reported', 'Details requested', 'Awaiting approval', 'Verified')
        AND DATE_FORMAT(d.sent_at, '%Y-%m') = ?
        AND NOT EXISTS (SELECT 1 FROM tbl_reconciliation_lines l JOIN tbl_reconciliation_imports i ON i.import_id = l.import_id
                         WHERE i.period = ? AND i.method_id = d.payment_method_id AND l.reference_norm = d.reference_norm)
      ORDER BY d.sent_at`, [methods, period, period]) : [[]];
  await logActivity(req, 'VIEW_RECONCILIATION', `Reconciliation ${period}`);
  const num = (v) => (v === null || v === undefined ? null : Number(v));
  const [accounts] = await pool.query("SELECT method_id, name FROM tbl_payment_methods WHERE method_type = 'qr' ORDER BY sort_order, method_id");
  return {
    period, imports, accounts,
    lines: lines.map((l) => ({ ...l, amount: Number(l.amount) })),
    reported_not_in_statement: missing.map((m) => ({ ...m, reported_amount: num(m.reported_amount), verified_amount: num(m.verified_amount) })),
  };
}

async function lockLine(conn, id) {
  const [[l]] = await conn.query(
    `SELECT l.*, i.method_id, m.code AS method_code, m.name AS method_name FROM tbl_reconciliation_lines l JOIN tbl_reconciliation_imports i ON i.import_id = l.import_id
       JOIN tbl_payment_methods m ON m.method_id = i.method_id WHERE l.line_id = ? FOR UPDATE`, [id]);
  if (!l) throw new HttpError(404, 'Statement line not found.');
  if (l.match_status !== 'Unreported') throw new HttpError(409, 'Only an unreported deposit can be converted or dismissed.');
  return l;
}

/**
 * POST /reconciliation/lines/:id/convert { as: anonymous | walk_in, walk_in_name?, walk_in_kind?, purpose } - after review.
 * The donation is a staff-recorded walk-in (or anonymous) gift for the statement amount with the statement reference
 * (so the same reference can never be recorded twice). Above the dual-control amount a second person confirms it.
 */
async function convert(req, id, body) {
  requireReconciler(req);
  const b = body || {};
  const as = String(b.as || '');
  if (!['anonymous', 'walk_in'].includes(as)) throw new HttpError(422, 'Choose walk-in or anonymous.', { errors: { as: 'Choose walk-in or anonymous.' } });
  const name = as === 'walk_in' ? String(b.walk_in_name || '').trim().replace(/\s+/g, ' ').slice(0, 100) : 'Anonymous donor';
  if (as === 'walk_in' && name.length < 2) throw new HttpError(422, "Enter the donor's name.", { errors: { walk_in_name: "Enter the donor's name." } });
  const purpose = String(b.purpose || 'General support');
  if (!L.PURPOSES.includes(purpose)) throw new HttpError(422, 'Choose the purpose.', { errors: { purpose: 'Choose the purpose.' } });
  const kind = L.DONOR_TYPES.includes(b.walk_in_kind) ? b.walk_in_kind : 'Individual';
  try {
    return await withTransaction(async (conn) => {
      const l = await lockLine(conn, id);
      const cents = dbToCents(l.amount);
      const donorRef = await LC.donorForWalkIn(conn, { name, contact: null, type: kind }, req.user.user_id);
      const dual = await cash.needsDualControl(conn, cents);
      const donationId = await Donation.insertWith(conn, {
        donor_id: null, donor_type: 'walk_in', walk_in_name: name, donor_name: name, source: 'donations_page', amount: centsToDecimal(cents), payment_method: l.method_name,
        status: dual ? 'Pending' : 'Received', item_description: `Deposit found in the ${l.method_name} statement (${String(l.txn_date).slice(0, 10)})`, is_general: true,
        qr_receipt_code: makeReceiptCode(), donor_ref_id: donorRef, is_anonymous: as === 'anonymous', purpose,
      });
      const ymd = l.txn_date instanceof Date ? `${l.txn_date.getFullYear()}-${String(l.txn_date.getMonth() + 1).padStart(2, '0')}-${String(l.txn_date.getDate()).padStart(2, '0')}` : String(l.txn_date).slice(0, 10);
      await conn.query(
        `UPDATE tbl_donations SET payment_method_id = ?, ref_method = ?, reference_raw = ?, reference_norm = ?, verified_amount = ?, verified_reference = ?, verified_received_on = ?,
            verified_by = ?, verified_at = NOW(), recorded_by = ?, dual_control = ? WHERE donation_id = ?`,
        [l.method_id, l.method_code, l.reference_raw, l.reference_norm, centsToDecimal(cents), l.reference_raw, ymd, req.user.user_id, req.user.user_id, dual ? 'Waiting' : null, donationId]);
      await LC.history(conn, donationId, null, dual ? 'Pending' : 'Received', dual ? 'From the statement; waiting for a second person to confirm' : 'Recorded from the statement (reconciliation)', req.user.user_id);
      const d = { donation_id: donationId, status: dual ? 'Pending' : 'Received', payment_method: l.method_name, amount: centsToDecimal(cents) };
      await LC.setAllocation(conn, req, d, [{ program: purpose, amount: Number(centsToDecimal(cents)), intended_use: null, needs_review: false, original_text: null }], { purpose });
      await conn.query("UPDATE tbl_reconciliation_lines SET match_status = 'Converted', donation_id = ?, reviewed_by = ?, reviewed_at = NOW(), review_note = ? WHERE line_id = ?",
        [donationId, req.user.user_id, as === 'anonymous' ? 'Recorded as an anonymous donation' : 'Recorded as a walk-in donation', l.line_id]);
      await logActivityWith(conn, req, `RECONCILIATION_CONVERTED (${as}, PHP ${centsToDecimal(cents)}, ref ${mask(l.reference_norm)})`, `Donation #${donationId}`);
      if (dual) await cash.askSecondPerson(conn, req, donationId);
      return { donation_id: donationId, dual_control: dual };
    });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') throw new HttpError(409, 'A donation with this reference already exists. Check the donation list.');
    throw err;
  }
}

/** POST /reconciliation/lines/:id/dismiss { note } - not a donation (refund, own transfer ...). */
async function dismiss(req, id, body) {
  requireReconciler(req);
  const why = String(body?.note || '').trim().slice(0, 500);
  if (why.length < 5) throw new HttpError(422, 'Explain why this deposit is not a donation.', { errors: { note: 'At least 5 characters.' } });
  await withTransaction(async (conn) => {
    const l = await lockLine(conn, id);
    await conn.query("UPDATE tbl_reconciliation_lines SET match_status = 'Dismissed', reviewed_by = ?, reviewed_at = NOW(), review_note = ? WHERE line_id = ?", [req.user.user_id, why, l.line_id]);
    await logActivityWith(conn, req, `RECONCILIATION_LINE_DISMISSED (ref ${mask(l.reference_norm)})`, `Reconciliation import #${l.import_id}`);
  });
}

module.exports = { importStatement, overview, convert, dismiss, _internal: { csvCells, readDate, readLines } };
