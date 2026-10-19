/**
 * Maps the legacy online-payment records (tbl_payments, read-only since migration 037) to the new donation fields.
 * Run it yourself after `npm run migrate`; review the dry run first.
 *
 *   node scripts/mapLegacyPayments.js            dry run: lists EVERY legacy payment row and how it would be mapped;
 *                                                changes nothing
 *   node scripts/mapLegacyPayments.js --apply    applies the mapping in one transaction and records it in
 *                                                tbl_legacy_payment_map (running it again changes nothing)
 *
 * Both write the list to backend/legacy-payment-mapping.csv (payment and donation numbers only; reference numbers
 * are masked to the last 4 characters; no names).
 *
 * Mapping (tbl_payments itself is never changed or deleted; only tbl_donations gets the new fields):
 *   gateway (PayMongo) paid             -> the donation is Verified with the amount paid (kept in totals)
 *   gateway pending / failed / cancelled / expired
 *                                       -> "Cancelled (legacy)", excluded from totals (these never had a donation;
 *                                          if one exists it is set to Cancelled)
 *   bank transfer waiting               -> a donor report (Reported) in Donations > To verify, with its reference,
 *                                          transfer date and proof
 *   bank transfer confirmed             -> Verified (kept in totals)
 *   bank transfer rejected              -> Not matched (excluded from totals), the rejection reason as the home's message
 * Audit entries are kept and one entry is added per mapped donation.
 */
const fs = require('fs');
const path = require('path');

const mask = (v) => { const s = String(v || '').replace(/\s+/g, ''); return s ? `****${s.slice(-4)}` : ''; };
const norm = (v) => String(v || '').trim().toUpperCase().replace(/[\s-]+/g, '');
const ymd = (v) => { if (!v) return null; if (v instanceof Date) return `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, '0')}-${String(v.getDate()).padStart(2, '0')}`; return String(v).slice(0, 10); };

function plan(p) {
  if (p.gateway === 'paymongo') {
    if (p.status === 'paid') return { mapped_as: 'Verified', counted: true, claim: 'Verified' };
    return { mapped_as: 'Cancelled (legacy)', counted: false, claim: 'Legacy cancelled' };
  }
  if (p.status === 'pending_verification') return { mapped_as: 'Reported (now in To verify)', counted: false, claim: 'Reported' };
  if (p.status === 'confirmed') return { mapped_as: 'Verified', counted: true, claim: 'Verified' };
  if (p.status === 'rejected') return { mapped_as: 'Not matched', counted: false, claim: 'Not matched' };
  return { mapped_as: 'Cancelled (legacy)', counted: false, claim: 'Legacy cancelled' };
}

/** Runs on an open connection inside the caller's transaction. Returns the report rows. */
async function run(conn, { apply = false } = {}) {
  const [rows] = await conn.query(
    `SELECT p.*, m.code AS method_code, d.donation_no, d.status AS donation_status, d.amount AS donation_amount, d.claim_status
       FROM tbl_payments p LEFT JOIN tbl_payment_methods m ON m.method_id = p.method_id LEFT JOIN tbl_donations d ON d.donation_id = p.donation_id
      WHERE NOT EXISTS (SELECT 1 FROM tbl_legacy_payment_map x WHERE x.payment_id = p.payment_id)
      ORDER BY p.payment_id`);
  const report = [];
  for (const p of rows) {
    const pl = plan(p);
    const ref = p.gateway === 'paymongo' ? p.gateway_payment_id : p.transfer_reference;
    const out = { payment_id: p.payment_id, gateway: p.gateway, method: p.method_name, old_status: p.status, amount: Number(p.amount).toFixed(2),
      donation_no: p.donation_no || '', reference: mask(ref), mapped_as: pl.mapped_as, counted: pl.counted ? 'yes' : 'no', note: '' };
    if (p.donation_id && p.claim_status) out.note = 'donation already has report fields: left as it is';
    if (!p.donation_id && pl.claim !== 'Legacy cancelled') out.note = 'no donation linked: recorded in the map only';
    report.push(out);
    if (!apply) continue;
    if (p.donation_id && !p.claim_status) {
      const common = [p.method_id, p.method_code || null, ref || null, ref ? norm(ref) : null, p.amount, p.payment_id];
      try {
        if (pl.claim === 'Verified') {
          await conn.query(
            `UPDATE tbl_donations SET payment_method_id = ?, ref_method = ?, reference_raw = ?, reference_norm = ?, reported_amount = ?, legacy_payment_id = ?,
                claim_status = 'Verified', verified_amount = amount, verified_reference = ?, verified_received_on = ?, verified_by = ?, verified_at = COALESCE(?, ?, created_at),
                claim_reported_at = created_at, sent_at = ? WHERE donation_id = ?`,
            [...common, ref || null, ymd(p.transfer_date || p.paid_at || p.created_at), p.verified_by || null, p.verified_at || null, p.paid_at || null,
              p.transfer_date ? `${ymd(p.transfer_date)} 00:00:00` : p.paid_at || p.created_at, p.donation_id]);
        } else if (pl.claim === 'Reported' || pl.claim === 'Not matched') {
          await conn.query(
            `UPDATE tbl_donations SET payment_method_id = ?, ref_method = ?, reference_raw = ?, reference_norm = ?, reported_amount = ?, legacy_payment_id = ?,
                claim_status = ?, claim_message = ?, claim_reported_at = ?, sent_at = ?, sender_hint = ? WHERE donation_id = ?`,
            [...common, pl.claim, pl.claim === 'Not matched' ? (p.rejection_reason || 'The transfer could not be found in the home account.').slice(0, 500) : null,
              p.created_at, p.transfer_date ? `${ymd(p.transfer_date)} 00:00:00` : p.created_at, p.account_last4 ? String(p.account_last4) : null, p.donation_id]);
          if (p.proof_storage_key) {
            await conn.query(
              `INSERT INTO tbl_donation_documents (donation_id, kind, label, original_name, mime_type, size_bytes, storage_key, sha256, uploaded_by)
               VALUES (?, 'donor_proof', 'Proof from the donor (legacy bank transfer)', ?, ?, ?, ?, ?, ?)`,
              [p.donation_id, p.proof_name || 'proof', p.proof_mime || 'application/octet-stream', p.proof_size || 0, p.proof_storage_key, p.proof_sha256 || null, p.donor_id]);
          }
        } else {
          await conn.query("UPDATE tbl_donations SET legacy_payment_id = ?, claim_status = 'Legacy cancelled', reported_amount = ? WHERE donation_id = ?", [p.payment_id, p.amount, p.donation_id]);
          if (!['Cancelled', 'Voided', 'Rejected'].includes(p.donation_status)) {
            await conn.query("UPDATE tbl_donations SET status = 'Cancelled' WHERE donation_id = ?", [p.donation_id]);
            await conn.query("INSERT INTO tbl_donation_status_history (donation_id, from_status, to_status, note) VALUES (?, ?, 'Cancelled', 'Legacy online payment not completed')", [p.donation_id, p.donation_status]);
          }
        }
      } catch (err) {
        if (err.code !== 'ER_DUP_ENTRY') throw err;
        // The same reference is already on another donation: map without the reference and say so.
        await conn.query('UPDATE tbl_donations SET legacy_payment_id = ?, reported_amount = ?, claim_status = ? WHERE donation_id = ?', [p.payment_id, p.amount, pl.claim, p.donation_id]);
        out.note = 'reference already used by another donation: mapped without the reference (check it)';
      }
      // tbl_activity_logs needs a user: the donor of the payment, with the role marked as the migration (not their action).
      await conn.query("INSERT INTO tbl_activity_logs (user_id, user_role, action_performed, target_entity, ip_address) VALUES (?, 'System (migration)', ?, ?, 'migration')",
        [p.donor_id, `LEGACY_PAYMENT_MAPPED (payment #${p.payment_id}: ${p.gateway} ${p.status} -> ${pl.mapped_as})`, `Donation #${p.donation_id}`]);
    }
    await conn.query('INSERT INTO tbl_legacy_payment_map (payment_id, old_status, mapped_as, donation_id, counted, note) VALUES (?, ?, ?, ?, ?, ?)',
      [p.payment_id, `${p.gateway}:${p.status}`, pl.mapped_as, p.donation_id || null, pl.counted ? 1 : 0, out.note || null]);
  }
  return report;
}

function toCsv(report) {
  const cols = ['payment_id', 'gateway', 'method', 'old_status', 'amount', 'donation_no', 'reference', 'mapped_as', 'counted', 'note'];
  const esc = (v) => { const s = String(v ?? ''); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  return [cols.join(','), ...report.map((r) => cols.map((c) => esc(r[c])).join(','))].join('\r\n');
}

module.exports = { run, plan, toCsv };

if (require.main === module) {
  require('dotenv').config();
  const mysql = require('mysql2/promise');
  const apply = process.argv.includes('--apply');
  (async () => {
    const conn = await mysql.createConnection({
      host: process.env.DB_HOST || '127.0.0.1', port: Number(process.env.DB_PORT) || 3306, user: process.env.DB_USER || 'root',
      password: process.env.DB_PASSWORD || '', database: process.env.DB_NAME || 'caresphere_db',
    });
    try {
      await conn.beginTransaction();
      const report = await run(conn, { apply });
      if (apply) await conn.commit(); else await conn.rollback();
      const file = path.join(__dirname, '..', 'legacy-payment-mapping.csv');
      fs.writeFileSync(file, toCsv(report));
      console.log(`${apply ? 'Applied' : 'Dry run (nothing changed)'}: ${report.length} legacy payment row(s) not mapped before.`);
      for (const r of report) console.log(`  payment #${r.payment_id} ${r.gateway} ${r.old_status} PHP ${r.amount} ${r.donation_no || '(no donation)'} -> ${r.mapped_as}, counted: ${r.counted}${r.note ? ` (${r.note})` : ''}`);
      console.log(`List written to ${file}${apply ? '' : '. Run again with --apply to apply it.'}`);
    } catch (err) {
      await conn.rollback().catch(() => {});
      console.error(`Failed, nothing was changed: ${err.message}`);
      process.exitCode = 1;
    } finally { await conn.end(); }
  })();
}
