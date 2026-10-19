/**
 * QR donations: the donor's report ("I have sent my donation") and the home's verification.
 *
 * CareSphere never receives, holds or processes money. The donor pays outside the system and reports it; the
 * report is a donation with status 'Pending verification' and claim_status 'Reported'. It counts in NO total and
 * gets NO acknowledgment until a verifier (Admin, or Staff with Donations + Donations: cash verification) checks
 * the home's own bank or e-wallet record and verifies it with the reference, amount and date they found there.
 *
 * Rules enforced here (the server is the only place they are enforced):
 *  - Donors: only whitelisted fields are read; they can't set status, amounts after submitting, receipts or
 *    allocation; they can withdraw while the report is open and report again; they can add proof or a reply.
 *  - Duplicate references: normalized (trim, upper case, no spaces or dashes) and UNIQUE in the database on
 *    (method, reference) across portal and staff-entered donations, so two simultaneous reports can't both save.
 *    The error never says whose donation holds the reference.
 *  - Double submit: an idempotency key per submission (a replay returns the first result) and a short window in
 *    which the same donor, method and amount is refused.
 *  - Flooding: per-donor daily limit and open-report cap (Settings), per-address hourly limit (route), optional
 *    local check question, and an Admin alert on bursts.
 *  - Verification: the reference and date must match the donor's report or Verify is blocked; an amount
 *    difference is recorded separately (reported_amount is never changed) with a reason and needs an Admin;
 *    above the segregation-of-duties threshold a second person must approve, and nobody verifies a donation they
 *    recorded. Verify, status, history, audit and notifications happen in one transaction with the row locked.
 *  - A proof file is optional and never counts as verification.
 */
const { pool, withTransaction } = require('../config/db');
const HttpError = require('../utils/HttpError');
const Donation = require('../models/donationModel');
const LC = require('./donationLifecycle');
const Notify = require('./notifications');
const C = require('../config/donorConfidentiality');
const CL = require('../config/donationClaims');
const { limits } = require('./claimSettings');
const { toCents, centsToDecimal, dbToCents, formatPeso } = require('../utils/money');
const { readReference, normalizeReference, mask } = require('../utils/reference');
const { logActivityWith, logActivity } = require('../utils/audit');
const { makeReceiptCode } = require('./donationService');
const proofs = require('./donationProofs');
const captcha = require('./captcha');

const GENERIC_REF = "This reference number can't be used. Check it against your app and try again, or contact the home if you think this is a mistake.";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DONOR_FIELDS = ['method_id', 'amount', 'reference', 'sent_at', 'sender_hint', 'note', 'proof', 'consent', 'idempotency_key', 'captcha_token', 'captcha_answer'];
const pick = (body, keys) => Object.fromEntries(keys.filter((k) => body && Object.prototype.hasOwnProperty.call(body, k)).map((k) => [k, body[k]]));
const text = (v, max) => { const s = String(v ?? '').trim().replace(/\s+/g, ' '); return s ? s.slice(0, max) : null; };
const pad = (n) => String(n).padStart(2, '0');
const sqlDateTime = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:00`;
const isOpen = (d) => CL.OPEN.includes(d.claim_status);

/** Admin, or Staff with Donations AND Donations: cash verification. */
const canVerify = (user) => user?.role === 'Admin' || (user?.role === 'Staff' && ['donations', 'cash_verification'].every((x) => (user.duties || []).includes(x)));
function requireVerifier(req) {
  if (!canVerify(req.user)) throw new HttpError(403, 'ACCESS DENIED – Verifying donor reports needs the Donations: cash verification duty.', { duty: 'cash_verification' });
}

/** "2026-10-18T14:30" (local time) -> Date, or a 422. Not in the future, not older than the allowed days. */
function readSentAt(v, maxAgeDays) {
  const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::\d{2})?$/.exec(String(v ?? '').trim());
  const err = (msg) => new HttpError(422, msg, { errors: { sent_at: msg } });
  if (!m) throw err('Enter the date and time you sent it.');
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]));
  if (Number.isNaN(d.getTime()) || d.getMonth() !== Number(m[2]) - 1 || d.getDate() !== Number(m[3])) throw err('Enter a real date and time.');
  if (d.getTime() > Date.now() + 5 * 60 * 1000) throw err("The date and time sent can't be in the future.");
  if (d.getTime() < Date.now() - maxAgeDays * 86400000) throw err(`Transfers older than ${maxAgeDays} days can't be reported here. Contact the home instead.`);
  return d;
}

function readSenderHint(v) {
  const s = text(v, 60);
  if (!s) return null;
  if (/^\d+$/.test(s.replace(/\s/g, '')) && s.replace(/\s/g, '').length !== 4) throw new HttpError(422, 'Enter only the last 4 digits of the sending number, or the name on the account.', { errors: { sender_hint: 'Last 4 digits only, or the account name.' } });
  return s;
}

async function openCount(conn) {
  const [[q]] = await conn.query("SELECT COUNT(*) AS n FROM tbl_donations WHERE claim_status IN ('Reported', 'Details requested', 'Awaiting approval')");
  return Number(q.n);
}
/** The "N donor reports to verify" notification for Admins and cash verifiers (one row each, kept current). */
async function notifyQueue(conn) {
  const n = await openCount(conn);
  if (!n) return;
  const opts = { params: { count: n }, groupKey: 'claims_to_verify', mode: 'set' };
  await Notify.toAdmins(conn, 'admin_claims_to_verify', opts);
  await Notify.toStaffWithDuties(conn, 'staff_claims_to_verify', ['donations', 'cash_verification'], opts);
}

async function note(conn, donationId, role, userId, body) {
  const s = text(body, 500);
  if (s) await conn.query('INSERT INTO tbl_donation_claim_notes (donation_id, author_role, user_id, note) VALUES (?, ?, ?, ?)', [donationId, role, userId, s]);
}

// ---------------------------------------------------------------- donor: report

/** POST /donor/donation-reports - "I have sent my donation". */
async function report(req, rawBody) {
  const b = pick(rawBody, DONOR_FIELDS); // anything else in the request (status, verified_amount, receipt ...) is ignored
  const L = await limits();
  const key = String(b.idempotency_key || '');
  if (!UUID.test(key)) throw new HttpError(400, 'Refresh the page and try again.');
  const prior = await Donation.findByIdempotencyKey(req.user.user_id, key);
  if (prior) return { ...(await donorRow(req.user.user_id, prior)), replayed: true };
  if (L.donation_claim_captcha === 1) captcha.check(req.user.user_id, b.captcha_token, b.captcha_answer);

  const errors = {};
  const tryField = (k, fn) => { try { return fn(); } catch (e) { if (e.details?.errors) Object.assign(errors, e.details.errors); else errors[k] = e.message; return null; } };
  const methodId = Number(b.method_id);
  const cents = tryField('amount', () => toCents(b.amount, 'Amount', { min: 1, max: L.donation_claim_max_amount }));
  const ref = tryField('reference', () => readReference(b.reference, 'Transfer reference number'));
  const sentAt = tryField('sent_at', () => readSentAt(b.sent_at, L.donation_claim_max_age_days));
  const senderHint = tryField('sender_hint', () => readSenderHint(b.sender_hint));
  const donorNote = text(b.note, 500);
  if (b.consent !== true) errors.consent = 'Tick the box to let the home use these details to check your donation.';
  if (Object.keys(errors).length) throw new HttpError(422, 'Some answers need attention.', { errors });

  const [[method]] = await pool.query(
    `SELECT m.method_id, m.code, m.name, m.current_version_id FROM tbl_payment_methods m
      WHERE m.method_id = ? AND m.enabled = TRUE AND m.current_version_id IS NOT NULL`, [methodId]);
  if (!method) throw new HttpError(422, 'Choose how you gave.', { errors: { method_id: 'Choose how you gave.' } });

  // Optional proof: checked, scanned and cleaned before anything is saved (it never counts as verification).
  const proof = b.proof ? await proofs.prepare(b.proof) : null;
  let donationId;
  try {
    donationId = await withTransaction(async (conn) => {
      // The donor's row in tbl_users is locked so two reports from the same donor are checked one after the other.
      const [[donor]] = await conn.query('SELECT user_id, full_name FROM tbl_users WHERE user_id = ? FOR UPDATE', [req.user.user_id]);
      const [[day]] = await conn.query('SELECT COUNT(*) AS n FROM tbl_donations WHERE donor_id = ? AND claim_reported_at > NOW() - INTERVAL 1 DAY', [donor.user_id]);
      if (Number(day.n) >= L.donation_claim_daily_limit) throw new HttpError(429, `You can report up to ${L.donation_claim_daily_limit} donations a day. Please try again tomorrow, or contact the home.`);
      const [[open]] = await conn.query("SELECT COUNT(*) AS n FROM tbl_donations WHERE donor_id = ? AND claim_status IN ('Reported', 'Details requested', 'Awaiting approval')", [donor.user_id]);
      if (Number(open.n) >= L.donation_claim_max_pending) throw new HttpError(429, `You have ${open.n} reports waiting for the home to confirm. Please wait until they are checked before reporting another.`);
      const [[dup]] = await conn.query(
        `SELECT donation_no FROM tbl_donations WHERE donor_id = ? AND payment_method_id = ? AND reported_amount = ?
            AND claim_status IN ('Reported', 'Details requested', 'Awaiting approval') AND claim_reported_at > NOW() - INTERVAL ? MINUTE`,
        [donor.user_id, method.method_id, centsToDecimal(cents), L.donation_duplicate_window_minutes]);
      if (dup) throw new HttpError(409, `You reported the same amount a few minutes ago (${dup.donation_no}). Check Donation history before reporting it again.`);

      const id = await Donation.insertWith(conn, {
        donor_id: donor.user_id, donor_type: 'registered', donor_name: donor.full_name, source: 'portal', amount: centsToDecimal(cents),
        payment_method: method.name, status: 'Pending verification', reason_for_donation: donorNote, is_general: true, submitted_by_donor: true,
        qr_receipt_code: makeReceiptCode(), idempotency_key: key, purpose: null,
      });
      await conn.query(
        `UPDATE tbl_donations SET payment_method_id = ?, qr_version_id = ?, reported_amount = ?, ref_method = ?, reference_raw = ?, reference_norm = ?, sent_at = ?,
            sender_hint = ?, donor_note = ?, claim_status = 'Reported', claim_reported_at = NOW(), consent_at = NOW(), consent_version = ? WHERE donation_id = ?`,
        [method.method_id, method.current_version_id, centsToDecimal(cents), method.code, ref.raw, ref.norm, sqlDateTime(sentAt), senderHint, donorNote, CL.CONSENT_VERSION, id]);
      await LC.history(conn, id, null, 'Pending verification', 'Reported by the donor', donor.user_id);
      if (proof) await proofs.attach(conn, req, id, proof);
      await logActivityWith(conn, req, `DONATION_REPORTED (${method.name}, PHP ${centsToDecimal(cents)}, ref ${mask(ref.norm)})`, `Donation #${id}`);
      const [[row]] = await conn.query('SELECT donation_no FROM tbl_donations WHERE donation_id = ?', [id]);
      await Notify.emit(conn, 'donation_reported', { userId: donor.user_id, entityType: 'donation', entityId: id, params: { ref: row.donation_no }, groupKey: `donation_reported:${id}` });
      await notifyQueue(conn);
      return id;
    });
  } catch (err) {
    if (proof) proofs.discard(proof);
    if (err.code === 'ER_DUP_ENTRY') {
      if (/idempotency/i.test(err.message)) {
        const again = await Donation.findByIdempotencyKey(req.user.user_id, key);
        if (again) return { ...(await donorRow(req.user.user_id, again)), replayed: true };
        throw new HttpError(409, 'Refresh the page and try again.');
      }
      await logActivity(req, `DONATION_REPORT_DUPLICATE_REFERENCE (ref ${mask(normalizeReference(b.reference))})`, 'Donation reports');
      throw new HttpError(409, GENERIC_REF, { errors: { reference: 'This reference number can\'t be used.' } });
    }
    throw err;
  }
  await burstCheck(L);
  return donorRow(req.user.user_id, donationId);
}

/** Many reports in 10 minutes (from anyone): one Admin alert per hour. */
async function burstCheck(L) {
  try {
    const [[r]] = await pool.query('SELECT COUNT(*) AS n FROM tbl_donations WHERE claim_reported_at > NOW() - INTERVAL 10 MINUTE');
    if (Number(r.n) >= L.donation_claim_burst_alert) {
      const hour = new Date().toISOString().slice(0, 13);
      await Notify.toAdmins(pool, 'admin_claim_burst', { params: { count: Number(r.n) }, groupKey: `claim_burst:${hour}` });
    }
  } catch (e) { console.error('[claims] burst check', e.message); }
}

// ---------------------------------------------------------------- donor: their own reports

const DONOR_COLS = `d.donation_id, d.donation_no, d.payment_method, d.payment_method_id, d.status, d.claim_status, d.reported_amount, d.verified_amount, d.amount,
  d.reference_raw, d.sent_at, d.sender_hint, d.claim_reported_at, d.claim_message, d.verified_at, d.created_at, d.source, d.legacy_payment_id,
  d.item_description, d.reason_for_donation, d.reason_category, d.donor_note,
  (d.receipt_issued = TRUE OR EXISTS (SELECT 1 FROM tbl_donation_acknowledgments k WHERE k.donation_id = d.donation_id)) AS has_ack`;

/** The donor's view of one donation: steps, the home's message (never internal notes), what they can do. */
function donorShape(r, notes = [], docs = []) {
  const claim = r.claim_status;
  const verified = claim === 'Verified' || (!claim && !['Pending verification', 'Pending', 'Rejected', 'Voided', 'Cancelled'].includes(r.status));
  const ack = !!r.has_ack && r.status !== 'Voided';
  const notMatched = claim === 'Not matched';
  const steps = claim || r.source === 'portal' ? [
    { key: 'reported', label: 'Reported', state: 'completed' },
    notMatched ? { key: 'confirmed', label: 'Not matched yet', state: 'blocked' } : { key: 'confirmed', label: 'Confirmed by the home', state: verified ? 'completed' : claim === 'Withdrawn' || claim === 'Legacy cancelled' ? 'skipped' : 'current' },
    { key: 'acknowledged', label: 'Acknowledged', state: ack ? 'completed' : verified ? 'current' : 'pending' },
  ] : null;
  return {
    donation_id: r.donation_id, donation_no: r.donation_no, method: r.payment_method, status: r.status === 'Voided' ? 'Voided' : claim ? CL.DONOR_LABELS[claim] : r.status,
    claim_status: claim || null,
    reported_amount: r.reported_amount === null || r.reported_amount === undefined ? null : Number(r.reported_amount),
    // The confirmed amount is shown once the home verified it; before that, only what the donor reported.
    confirmed_amount: verified ? Number(r.verified_amount ?? r.amount) : null,
    amount: Number(r.amount), reference: r.reference_raw || null, sent_at: r.sent_at || null, sender_hint: r.sender_hint || null, reported_at: r.claim_reported_at || r.created_at,
    message: ['Not matched', 'Details requested'].includes(claim) ? r.claim_message || null : null,
    item_description: r.item_description || null, your_note: r.donor_note || r.reason_for_donation || r.reason_category || null, created_at: r.created_at,
    steps, legacy: !!r.legacy_payment_id,
    can_withdraw: isOpen(r), can_add_info: isOpen(r), receipt_available: ack,
    notes: notes.filter((n) => n.author_role !== 'internal').map((n) => ({ from: n.author_role === 'donor' ? 'You' : 'The home', note: n.note, at: n.created_at })),
    proofs: docs.map((x) => ({ document_id: x.document_id, name: x.original_name, uploaded_at: x.uploaded_at })),
  };
}

async function donorRow(userId, donationId) {
  const [[r]] = await pool.query(`SELECT ${DONOR_COLS} FROM tbl_donations d WHERE d.donation_id = ? AND d.donor_id = ?`, [donationId, userId]);
  if (!r) throw new HttpError(404, 'Donation not found.');
  const [notes] = await pool.query('SELECT author_role, note, created_at FROM tbl_donation_claim_notes WHERE donation_id = ? ORDER BY created_at, note_id', [donationId]);
  const [docs] = await pool.query("SELECT document_id, original_name, uploaded_at FROM tbl_donation_documents WHERE donation_id = ? AND kind = 'donor_proof' AND uploaded_by = ? ORDER BY uploaded_at", [donationId, userId]);
  return donorShape(r, notes, docs);
}

/** GET /donor/history - the donor's own donations, newest first (legacy gateway rows are hidden). */
async function donorHistory(req) {
  const q = text(req.query?.q, 60);
  const args = [req.user.user_id];
  // Old online-gateway payments that never completed ("Cancelled (legacy)") are hidden from the new screens.
  let where = "d.donor_id = ? AND (d.claim_status IS NULL OR d.claim_status <> 'Legacy cancelled')";
  if (q) { where += ' AND (d.donation_no LIKE ? OR d.reference_raw LIKE ?)'; args.push(`%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`, `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`); }
  const [rows] = await pool.query(`SELECT ${DONOR_COLS} FROM tbl_donations d WHERE ${where} ORDER BY COALESCE(d.claim_reported_at, d.created_at) DESC, d.donation_id DESC LIMIT 200`, args);
  if (!rows.length) return [];
  const ids = rows.map((r) => r.donation_id);
  const [notes] = await pool.query('SELECT donation_id, author_role, note, created_at FROM tbl_donation_claim_notes WHERE donation_id IN (?) ORDER BY created_at, note_id', [ids]);
  const [docs] = await pool.query("SELECT donation_id, document_id, original_name, uploaded_at FROM tbl_donation_documents WHERE donation_id IN (?) AND kind = 'donor_proof' AND uploaded_by = ?", [ids, req.user.user_id]);
  const alloc = await require('../models/donationModel').allocationsFor(ids);
  // How it is allocated: shown once the home confirmed the donation (program and amount only; no internal notes).
  return rows.map((r) => {
    const out = donorShape(r, notes.filter((n) => n.donation_id === r.donation_id), docs.filter((x) => x.donation_id === r.donation_id));
    out.allocation = out.confirmed_amount !== null || !r.claim_status ? (alloc[r.donation_id] || []).map((l) => ({ program: l.program, amount: l.amount, needs_review: l.needs_review })) : [];
    return out;
  });
}

/** Locks the donor's own open report (anything else is "not found", whoever owns it). */
async function lockOwn(conn, req, id) {
  const [[d]] = await conn.query('SELECT * FROM tbl_donations WHERE donation_id = ? AND donor_id = ? FOR UPDATE', [id, req.user.user_id]);
  if (!d || !d.claim_status) throw new HttpError(404, 'Donation not found.');
  return d;
}

/** POST /donor/donation-reports/:id/withdraw - while still open. The reference can then be reported again. */
async function withdraw(req, id) {
  await withTransaction(async (conn) => {
    const d = await lockOwn(conn, req, id);
    if (!isOpen(d)) throw new HttpError(409, 'Only a report still waiting for the home can be withdrawn.');
    await conn.query("UPDATE tbl_donations SET claim_status = 'Withdrawn', last_activity_at = NOW() WHERE donation_id = ?", [d.donation_id]);
    await LC.setStatus(conn, req, d, 'Cancelled', 'Withdrawn by the donor');
    await conn.query("UPDATE tbl_donation_approvals SET status = 'Declined', decided_at = NOW(), decision_note = 'Withdrawn by the donor' WHERE donation_id = ? AND status = 'Pending'", [d.donation_id]);
    await logActivityWith(conn, req, 'DONATION_REPORT_WITHDRAWN', `Donation #${d.donation_id}`);
    await Notify.emit(conn, 'donation_withdrawn', { userId: req.user.user_id, entityType: 'donation', entityId: d.donation_id, params: { ref: d.donation_no }, groupKey: `donation_withdrawn:${d.donation_id}` });
    await notifyQueue(conn);
  });
  return donorRow(req.user.user_id, id);
}

/** POST /donor/donation-reports/:id/info { note?, proof? } - a reply to "the home needs more details", or optional proof. */
async function addInfo(req, id, rawBody) {
  const b = pick(rawBody, ['note', 'proof']);
  const reply = text(b.note, 500);
  if (!reply && !b.proof) throw new HttpError(422, 'Write a reply or attach a file.', { errors: { note: 'Write a reply or attach a file.' } });
  const proof = b.proof ? await proofs.prepare(b.proof) : null;
  try {
    await withTransaction(async (conn) => {
      const d = await lockOwn(conn, req, id);
      if (!isOpen(d)) throw new HttpError(409, 'This report is no longer open. Contact the home if something is wrong.');
      await note(conn, d.donation_id, 'donor', req.user.user_id, reply);
      if (proof) await proofs.attach(conn, req, d.donation_id, proof);
      if (d.claim_status === 'Details requested') {
        await conn.query("UPDATE tbl_donations SET claim_status = 'Reported', last_activity_at = NOW() WHERE donation_id = ?", [d.donation_id]);
        await LC.history(conn, d.donation_id, d.status, d.status, 'The donor replied', req.user.user_id);
      } else await conn.query('UPDATE tbl_donations SET last_activity_at = NOW() WHERE donation_id = ?', [d.donation_id]);
      await logActivityWith(conn, req, `DONATION_REPORT_INFO_ADDED (${[reply ? 'reply' : null, proof ? 'proof' : null].filter(Boolean).join(', ')})`, `Donation #${d.donation_id}`);
      await notifyQueue(conn);
    });
  } catch (err) { if (proof) proofs.discard(proof); throw err; }
  return donorRow(req.user.user_id, id);
}

// ---------------------------------------------------------------- staff: the "To verify" queue

const QUEUE_COLS = `d.donation_id, d.donation_no, d.claim_reported_at, d.payment_method, d.payment_method_id, d.reported_amount, d.reference_raw, d.sent_at, d.sender_hint,
  d.claim_status, d.stale_flagged_at, d.donor_id, d.donor_type, d.donor_name, d.walk_in_name, d.is_anonymous, d.donor_ref_id, dr.donor_code, dr.display_name AS donor_record_name,
  TIMESTAMPDIFF(HOUR, d.claim_reported_at, NOW()) AS age_hours,
  (SELECT COUNT(*) FROM tbl_donation_documents x WHERE x.donation_id = d.donation_id AND x.kind = 'donor_proof') AS proofs,
  (SELECT a.kind FROM tbl_donation_approvals a WHERE a.donation_id = d.donation_id AND a.status = 'Pending' ORDER BY a.approval_id DESC LIMIT 1) AS approval_kind`;

/** GET /donations/to-verify?view=open|stale|approval|details|not_matched|all&method=&q= */
async function queue(req) {
  requireVerifier(req);
  const qy = req.query || {};
  const view = ['open', 'stale', 'approval', 'details', 'not_matched', 'verified', 'all'].includes(qy.view) ? qy.view : 'open';
  const where = ['d.claim_status IS NOT NULL', "d.claim_status <> 'Legacy cancelled'"];
  const args = [];
  if (view === 'open') where.push("d.claim_status IN ('Reported', 'Details requested', 'Awaiting approval')");
  if (view === 'stale') where.push("d.claim_status IN ('Reported', 'Details requested', 'Awaiting approval') AND d.stale_flagged_at IS NOT NULL");
  if (view === 'approval') where.push("d.claim_status = 'Awaiting approval'");
  if (view === 'details') where.push("d.claim_status = 'Details requested'");
  if (view === 'not_matched') where.push("d.claim_status = 'Not matched'");
  if (view === 'verified') where.push("d.claim_status = 'Verified'");
  if (qy.method) { where.push('d.payment_method_id = ?'); args.push(Number(qy.method) || 0); }
  const q = text(qy.q, 60);
  if (q) {
    const like = `%${normalizeReference(q).replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    where.push('(d.donation_no LIKE ? OR d.reference_norm LIKE ?)'); args.push(`%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`, like);
  }
  const [rows] = await pool.query(`SELECT ${QUEUE_COLS} ${Donation.FROM_SQL} WHERE ${where.join(' AND ')} ORDER BY d.claim_reported_at ASC LIMIT 500`, args);
  const [[counts]] = await pool.query(
    `SELECT COALESCE(SUM(claim_status IN ('Reported', 'Details requested', 'Awaiting approval')), 0) AS open,
            COALESCE(SUM(claim_status IN ('Reported', 'Details requested', 'Awaiting approval') AND stale_flagged_at IS NOT NULL), 0) AS stale,
            COALESCE(SUM(claim_status = 'Awaiting approval'), 0) AS approval FROM tbl_donations`);
  require('../controllers/donationController').logView(req, 'VIEW_DONATIONS_TO_VERIFY', 'To verify queue');
  return {
    rows: rows.map((r) => ({
      donation_id: r.donation_id, donation_no: r.donation_no, reported_at: r.claim_reported_at, donor: C.donorLabel({ ...r, is_anonymous: !!r.is_anonymous }, req.user),
      donor_masked: !C.canSeeDonors(req.user), method: r.payment_method, amount: Number(r.reported_amount), reference: r.reference_raw, sent_at: r.sent_at,
      sender_hint: C.canSeeDonors(req.user) ? r.sender_hint : (r.sender_hint ? mask(r.sender_hint) : null), claim_status: r.claim_status, status_label: CL.STAFF_LABELS[r.claim_status],
      stale: !!r.stale_flagged_at, age_hours: Number(r.age_hours), proofs: Number(r.proofs), approval_kind: r.approval_kind || null,
    })),
    counts: { open: Number(counts.open), stale: Number(counts.stale), approval: Number(counts.approval) },
    accounts: (await pool.query("SELECT method_id, name FROM tbl_payment_methods WHERE method_type = 'qr' ORDER BY sort_order, method_id"))[0],
  };
}

// ---------------------------------------------------------------- staff: verify

async function lockClaim(conn, id) {
  const d = await LC.lockDonation(conn, id);
  if (!d.claim_status) throw new HttpError(409, 'This donation is not a donor report.');
  return d;
}

/** Nobody verifies or approves a donation they recorded or reported. */
function separationProblem(user, d) {
  if (d.donor_id && d.donor_id === user.user_id) return 'You reported this donation, so someone else must verify it.';
  if (d.recorded_by && d.recorded_by === user.user_id) return 'You recorded this donation, so someone else must verify it.';
  return null;
}

function sentDate(d) { return String(d.sent_at instanceof Date ? sqlDateTime(d.sent_at) : d.sent_at || '').slice(0, 10); }
function addDays(ymd, n) { const [y, m, dd] = ymd.split('-').map(Number); const x = new Date(y, m - 1, dd + n); return `${x.getFullYear()}-${pad(x.getMonth() + 1)}-${pad(x.getDate())}`; }

/** Compares what the verifier found in the home's account with the donor's report. */
function compare(d, found) {
  const sent = sentDate(d);
  return {
    reference: normalizeReference(found.reference) === d.reference_norm,
    // The money can show in the home's account on the day it was sent or up to N days later (weekends, bank cut-off).
    date: !!sent && found.received_on >= sent && found.received_on <= addDays(sent, CL.MATCH_DATE_TOLERANCE_DAYS),
    amount: found.cents === dbToCents(d.reported_amount),
  };
}

/** Marks the report Verified with the verified figures (reported_amount is never changed). */
async function finalize(conn, req, d, { cents, reference, receivedOn, verifierId, reason }) {
  const reported = dbToCents(d.reported_amount);
  await conn.query(
    `UPDATE tbl_donations SET verified_amount = ?, amount = ?, verified_reference = ?, verified_received_on = ?, verified_by = ?, verified_at = NOW(),
        amount_diff_reason = ?, claim_status = 'Verified', stale_flagged_at = NULL, last_activity_at = NOW() WHERE donation_id = ?`,
    [centsToDecimal(cents), centsToDecimal(cents), reference, receivedOn, verifierId, cents !== reported ? reason : null, d.donation_id]);
  if (cents !== reported) await LC.correction(conn, req, d, 'amount', centsToDecimal(reported), centsToDecimal(cents), `Verified amount differs from the reported amount: ${reason}`, { alert: false });
  await LC.setStatus(conn, req, { ...d }, 'Received', "Verified against the home's account");
  await logActivityWith(conn, req, `DONATION_VERIFIED (PHP ${centsToDecimal(cents)}${cents !== reported ? `, reported PHP ${centsToDecimal(reported)}` : ''}, ref ${mask(normalizeReference(reference))})`, `Donation #${d.donation_id}`);
  if (d.donor_id) await Notify.emit(conn, 'donation_confirmed', { userId: d.donor_id, entityType: 'donation', entityId: d.donation_id, params: { ref: d.donation_no }, groupKey: `donation_confirmed:${d.donation_id}` });
  await Notify.toAdmins(conn, 'admin_donation_received', { params: { source: 'a verified donor report' }, groupKey: 'donations_received', mode: 'count' });
  await notifyQueue(conn);
}

function readFound(b) {
  const errors = {};
  let ref = null; let cents = null;
  try { ref = readReference(b.reference, 'Reference in the home account'); } catch (e) { Object.assign(errors, e.details?.errors || { reference: e.message }); }
  try { cents = toCents(b.amount, 'Amount received', { min: 1, max: 99999999 }); } catch (e) { Object.assign(errors, e.details?.errors || { amount: e.message }); }
  const receivedOn = String(b.received_on || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(receivedOn)) errors.received_on = 'Enter the date it shows in the home account.';
  else if (receivedOn > LC.today()) errors.received_on = "The date can't be in the future.";
  if (Object.keys(errors).length) throw new HttpError(422, 'Enter what the home account shows.', { errors });
  return { reference: ref.raw, cents, received_on: receivedOn };
}

/**
 * POST /donations/:id/verify { reference, amount, received_on, reason? } - from the home's actual bank or e-wallet record.
 *   reference or date differs -> blocked (mark Not matched or Request details instead)
 *   amount differs            -> recorded separately with a reason; an Admin approves
 *   above the threshold       -> a second person approves
 *   otherwise                 -> Verified
 */
async function verify(req, id, rawBody) {
  requireVerifier(req);
  const b = pick(rawBody, ['reference', 'amount', 'received_on', 'reason']);
  const found = readFound(b);
  const L = await limits();
  return withTransaction(async (conn) => {
    const d = await lockClaim(conn, id);
    if (!['Reported', 'Details requested'].includes(d.claim_status)) throw new HttpError(409, d.claim_status === 'Awaiting approval' ? 'This report is waiting for approval.' : `This report is ${CL.STAFF_LABELS[d.claim_status].toLowerCase()}.`);
    const sep = separationProblem(req.user, d);
    if (sep) throw new HttpError(403, sep);
    const c = compare(d, found);
    if (!c.reference || !c.date) {
      await logActivityWith(conn, req, `DONATION_VERIFY_BLOCKED (${[!c.reference && 'reference', !c.date && 'date'].filter(Boolean).join(' and ')} differ)`, `Donation #${d.donation_id}`);
      throw new HttpError(409, `Verify is blocked: the ${[!c.reference && 'reference number', !c.date && 'date'].filter(Boolean).join(' and ')} in the home account ${!c.reference && !c.date ? "don't" : "doesn't"} match the donor's report. Check again, mark it Not matched, or request details from the donor.`,
        { mismatch: { reference: !c.reference, date: !c.date } });
    }
    const reason = text(b.reason, 500);
    const sodNeeded = L.donation_sod_enabled === 1 && found.cents > L.donation_sod_threshold * 100;
    if (!c.amount || sodNeeded) {
      if (!c.amount && !reason) throw new HttpError(422, 'The amount received differs from the amount reported. Give the reason; an administrator will approve it.', { errors: { reason: 'Give the reason for the difference.' }, amount_differs: true });
      const kind = c.amount ? 'second_verifier' : 'amount_difference';
      await conn.query(
        'INSERT INTO tbl_donation_approvals (donation_id, kind, verified_amount, verified_reference, verified_received_on, reason, requested_by) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [d.donation_id, kind, centsToDecimal(found.cents), found.reference, found.received_on, reason, req.user.user_id]);
      await conn.query("UPDATE tbl_donations SET claim_status = 'Awaiting approval', last_activity_at = NOW() WHERE donation_id = ?", [d.donation_id]);
      await LC.history(conn, d.donation_id, d.status, d.status, kind === 'amount_difference' ? 'Checked: the amount received differs; waiting for an administrator' : 'Checked; waiting for a second verifier', req.user.user_id);
      await logActivityWith(conn, req, `DONATION_VERIFY_NEEDS_APPROVAL (${kind}, received PHP ${centsToDecimal(found.cents)})`, `Donation #${d.donation_id}`);
      const params = { ref: d.donation_no, id: d.donation_id, kind };
      await Notify.toAdmins(conn, 'admin_claim_approval', { params, exceptUserId: req.user.user_id, groupKey: `claim_approval:${d.donation_id}` });
      if (kind === 'second_verifier') await Notify.toStaffWithDuties(conn, 'staff_claim_approval', ['donations', 'cash_verification'], { params, exceptUserId: req.user.user_id, groupKey: `claim_approval:${d.donation_id}` });
      return { status: 'Awaiting approval', kind };
    }
    await finalize(conn, req, d, { cents: found.cents, reference: found.reference, receivedOn: found.received_on, verifierId: req.user.user_id, reason });
    return { status: 'Verified' };
  });
}

/**
 * POST /donations/approvals/:id { decision: approve|decline, note? }
 *   amount_difference: an Admin who did not do the check
 *   second_verifier:   an Admin or a cash verifier who did not do the check, record or report it
 */
async function decide(req, approvalId, rawBody) {
  requireVerifier(req);
  const b = pick(rawBody, ['decision', 'note']);
  const decision = String(b.decision || '');
  if (!['approve', 'decline'].includes(decision)) throw new HttpError(400, 'Choose approve or decline.');
  const decisionNote = text(b.note, 500);
  return withTransaction(async (conn) => {
    const [[a]] = await conn.query("SELECT * FROM tbl_donation_approvals WHERE approval_id = ? FOR UPDATE", [approvalId]);
    if (!a || !['amount_difference', 'second_verifier'].includes(a.kind)) throw new HttpError(404, 'Approval not found.');
    if (a.status !== 'Pending') throw new HttpError(409, `This was already ${a.status.toLowerCase()}.`);
    const d = await lockClaim(conn, a.donation_id);
    if (a.requested_by === req.user.user_id) throw new HttpError(403, 'Someone other than the person who checked it must decide.');
    if (a.kind === 'amount_difference' && req.user.role !== 'Admin') throw new HttpError(403, 'An administrator approves an amount difference.');
    const sep = separationProblem(req.user, d);
    if (sep) throw new HttpError(403, sep);
    if (d.claim_status !== 'Awaiting approval') throw new HttpError(409, 'This report is no longer waiting for approval.');
    if (decision === 'decline') {
      if (!decisionNote) throw new HttpError(422, 'Give the reason for declining.', { errors: { note: 'Give the reason.' } });
      await conn.query("UPDATE tbl_donation_approvals SET status = 'Declined', decided_by = ?, decided_at = NOW(), decision_note = ? WHERE approval_id = ?", [req.user.user_id, decisionNote, a.approval_id]);
      await conn.query("UPDATE tbl_donations SET claim_status = 'Reported', last_activity_at = NOW() WHERE donation_id = ?", [d.donation_id]);
      await note(conn, d.donation_id, 'internal', req.user.user_id, `Approval declined: ${decisionNote}`);
      await LC.history(conn, d.donation_id, d.status, d.status, 'Approval declined; to be checked again', req.user.user_id);
      await logActivityWith(conn, req, `DONATION_APPROVAL_DECLINED (${a.kind})`, `Donation #${d.donation_id}`);
      return { status: 'Reported' };
    }
    await conn.query("UPDATE tbl_donation_approvals SET status = 'Approved', decided_by = ?, decided_at = NOW(), decision_note = ? WHERE approval_id = ?", [req.user.user_id, decisionNote, a.approval_id]);
    await logActivityWith(conn, req, `DONATION_APPROVAL_APPROVED (${a.kind})`, `Donation #${d.donation_id}`);
    const receivedOn = a.verified_received_on instanceof Date ? sqlDateTime(a.verified_received_on).slice(0, 10) : String(a.verified_received_on).slice(0, 10);
    await finalize(conn, req, d, { cents: dbToCents(a.verified_amount), reference: a.verified_reference, receivedOn, verifierId: a.requested_by, reason: a.reason });
    return { status: 'Verified' };
  });
}

function readMessage(b, field = 'message') {
  const s = text(b?.[field], 500);
  if (!s || s.length < 5) throw new HttpError(422, 'Write the message for the donor (at least 5 characters). Never include internal notes.', { errors: { [field]: 'At least 5 characters.' } });
  return s;
}

/** POST /donations/:id/not-matched { message } - the message is sent to the donor. Not counted; can be reopened. */
async function notMatched(req, id, body) {
  requireVerifier(req);
  const message = readMessage(body);
  await withTransaction(async (conn) => {
    const d = await lockClaim(conn, id);
    if (!isOpen(d)) throw new HttpError(409, 'Only an open report can be marked Not matched.');
    await conn.query("UPDATE tbl_donations SET claim_status = 'Not matched', claim_message = ?, stale_flagged_at = NULL, last_activity_at = NOW() WHERE donation_id = ?", [message, d.donation_id]);
    await conn.query("UPDATE tbl_donation_approvals SET status = 'Declined', decided_by = ?, decided_at = NOW(), decision_note = 'Not matched' WHERE donation_id = ? AND status = 'Pending'", [req.user.user_id, d.donation_id]);
    await note(conn, d.donation_id, 'home', req.user.user_id, message);
    await LC.setStatus(conn, req, d, 'Rejected', "Not matched with the home's account");
    await logActivityWith(conn, req, 'DONATION_NOT_MATCHED', `Donation #${d.donation_id}`);
    if (d.donor_id) await Notify.emit(conn, 'donation_not_matched', { userId: d.donor_id, entityType: 'donation', entityId: d.donation_id, params: { ref: d.donation_no }, groupKey: `donation_not_matched:${d.donation_id}:${Date.now()}` });
    await notifyQueue(conn);
  });
  return { status: 'Not matched' };
}

/** POST /donations/:id/request-details { message } - asks the donor; they reply from Donation history. */
async function requestDetails(req, id, body) {
  requireVerifier(req);
  const message = readMessage(body);
  await withTransaction(async (conn) => {
    const d = await lockClaim(conn, id);
    if (!['Reported', 'Details requested'].includes(d.claim_status)) throw new HttpError(409, 'Details can be requested only while the report is waiting to be checked.');
    await conn.query("UPDATE tbl_donations SET claim_status = 'Details requested', claim_message = ?, last_activity_at = NOW() WHERE donation_id = ?", [message, d.donation_id]);
    await note(conn, d.donation_id, 'home', req.user.user_id, message);
    await LC.history(conn, d.donation_id, d.status, d.status, 'Details requested from the donor', req.user.user_id);
    await logActivityWith(conn, req, 'DONATION_DETAILS_REQUESTED', `Donation #${d.donation_id}`);
    if (d.donor_id) await Notify.emit(conn, 'donation_details_requested', { userId: d.donor_id, entityType: 'donation', entityId: d.donation_id, params: { ref: d.donation_no }, groupKey: `donation_details:${d.donation_id}:${Date.now()}` });
  });
  return { status: 'Details requested' };
}

/** POST /donations/:id/reopen { note } - a Not matched report whose money did arrive after all: back to the queue. */
async function reopen(req, id, body) {
  requireVerifier(req);
  const why = readMessage(body, 'note');
  await withTransaction(async (conn) => {
    const d = await lockClaim(conn, id);
    if (d.claim_status !== 'Not matched') throw new HttpError(409, 'Only a Not matched report can be reopened.');
    await conn.query("UPDATE tbl_donations SET claim_status = 'Reported', last_activity_at = NOW() WHERE donation_id = ?", [d.donation_id]);
    await note(conn, d.donation_id, 'internal', req.user.user_id, `Reopened: ${why}`);
    await LC.setStatus(conn, req, d, 'Pending verification', 'Reopened for verification');
    await logActivityWith(conn, req, 'DONATION_REPORT_REOPENED', `Donation #${d.donation_id}`);
    await notifyQueue(conn);
  });
  return { status: 'Reported' };
}

/** POST /donations/:id/claim-notes { note } - internal note (never shown to the donor). */
async function internalNote(req, id, body) {
  requireVerifier(req);
  const s = text(body?.note, 500);
  if (!s) throw new HttpError(422, 'Write the note.', { errors: { note: 'Write the note.' } });
  await withTransaction(async (conn) => {
    await lockClaim(conn, id);
    await note(conn, id, 'internal', req.user.user_id, s);
    await logActivityWith(conn, req, 'DONATION_REPORT_NOTE', `Donation #${id}`);
  });
}

/** The claim section of the staff donation page. */
async function claimDetail(req, d) {
  if (!d.claim_status) return null;
  const [notes] = await pool.query(
    'SELECT n.note_id, n.author_role, n.note, n.created_at, u.full_name AS by_name FROM tbl_donation_claim_notes n JOIN tbl_users u ON u.user_id = n.user_id WHERE n.donation_id = ? ORDER BY n.created_at, n.note_id', [d.donation_id]);
  const [approvals] = await pool.query(
    `SELECT a.approval_id, a.kind, a.verified_amount, a.verified_reference, a.verified_received_on, a.reason, a.status, a.requested_at, ru.full_name AS requested_by_name,
            a.requested_by, a.decided_at, du.full_name AS decided_by_name, a.decision_note
       FROM tbl_donation_approvals a JOIN tbl_users ru ON ru.user_id = a.requested_by LEFT JOIN tbl_users du ON du.user_id = a.decided_by
      WHERE a.donation_id = ? AND a.kind IN ('amount_difference', 'second_verifier') ORDER BY a.approval_id DESC`, [d.donation_id]);
  const [[raw]] = await pool.query(`SELECT d.reported_amount, d.verified_amount, d.reference_raw, d.sent_at, d.sender_hint, d.donor_note, d.claim_status, d.claim_message, d.claim_reported_at,
      d.stale_flagged_at, d.verified_reference, d.verified_received_on, d.verified_at, d.amount_diff_reason, d.consent_at, d.legacy_payment_id, d.recorded_by, d.donor_id, vu.full_name AS verified_by_name
      FROM tbl_donations d LEFT JOIN tbl_users vu ON vu.user_id = d.verified_by WHERE d.donation_id = ?`, [d.donation_id]);
  const verifier = canVerify(req.user);
  const pending = approvals.find((a) => a.status === 'Pending');
  return {
    claim_status: raw.claim_status, status_label: CL.STAFF_LABELS[raw.claim_status], reported_amount: Number(raw.reported_amount), verified_amount: raw.verified_amount === null ? null : Number(raw.verified_amount),
    reference: raw.reference_raw, sent_at: raw.sent_at, sender_hint: C.canSeeDonors(req.user) ? raw.sender_hint : (raw.sender_hint ? mask(raw.sender_hint) : null), donor_note: raw.donor_note,
    message_to_donor: raw.claim_message, reported_at: raw.claim_reported_at, stale: !!raw.stale_flagged_at, verified_reference: raw.verified_reference,
    verified_received_on: raw.verified_received_on, verified_at: raw.verified_at, verified_by_name: raw.verified_by_name, amount_diff_reason: raw.amount_diff_reason,
    consent_at: raw.consent_at, legacy: !!raw.legacy_payment_id,
    notes: verifier ? notes : notes.filter((n) => n.author_role !== 'internal'),
    approvals: approvals.map((a) => ({ ...a, verified_amount: a.verified_amount === null ? null : Number(a.verified_amount), mine: a.requested_by === req.user.user_id })),
    can_verify: verifier && ['Reported', 'Details requested'].includes(raw.claim_status) && !separationProblem(req.user, raw),
    can_decide: !!pending && verifier && pending.requested_by !== req.user.user_id && !separationProblem(req.user, raw) && (pending.kind !== 'amount_difference' || req.user.role === 'Admin'),
    can_not_match: verifier && CL.OPEN.includes(raw.claim_status), can_request_details: verifier && ['Reported', 'Details requested'].includes(raw.claim_status),
    can_reopen: verifier && raw.claim_status === 'Not matched', separation_problem: verifier ? separationProblem(req.user, raw) : null, verifier,
  };
}

/** Hourly: open reports older than the setting are flagged Stale for Admin. Never verified or deleted automatically. */
async function staleSweep() {
  const L = await limits();
  const [r] = await pool.query(
    `UPDATE tbl_donations SET stale_flagged_at = NOW() WHERE claim_status IN ('Reported', 'Details requested', 'Awaiting approval') AND stale_flagged_at IS NULL
       AND claim_reported_at < NOW() - INTERVAL ? DAY`, [L.donation_stale_days]);
  if (r.affectedRows) {
    const [[q]] = await pool.query("SELECT COUNT(*) AS n FROM tbl_donations WHERE claim_status IN ('Reported', 'Details requested', 'Awaiting approval') AND stale_flagged_at IS NOT NULL");
    await Notify.toAdmins(pool, 'admin_claims_stale', { params: { count: Number(q.n), days: L.donation_stale_days }, groupKey: 'claims_stale', mode: 'set' });
  }
  return r.affectedRows;
}

/** GET /donor/donate-options - QR cards, limits, the notice and (when on) the check question. */
async function donateOptions(req) {
  const L = await limits();
  return {
    methods: await require('./paymentQr').donorMethods(req),
    limits: { min_amount: 1, max_amount: L.donation_claim_max_amount, max_age_days: L.donation_claim_max_age_days },
    captcha: L.donation_claim_captcha === 1 ? captcha.challenge(req.user.user_id) : null,
    consent_version: CL.CONSENT_VERSION,
    problems: Object.entries(CL.QR_PROBLEMS).map(([value, label]) => ({ value, label })),
  };
}

module.exports = {
  canVerify, report, withdraw, addInfo, donorHistory, donorRow, queue, verify, decide, notMatched, requestDetails, reopen, internalNote, claimDetail,
  staleSweep, donateOptions, _internal: { compare, readSentAt, separationProblem, pick, DONOR_FIELDS, formatPeso },
};
