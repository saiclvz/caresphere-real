/**
 * Converts the donations recorded before migration 031 to the donation lifecycle. Run it yourself after
 * `npm run migrate`; nothing runs it automatically.
 *
 *   node scripts/migrateDonations.js                                        dry run: does the whole conversion
 *                                                                           inside a transaction, prints the report,
 *                                                                           then rolls everything back
 *   node scripts/migrateDonations.js --apply --admin-email you@example.com  applies it (one transaction)
 *
 * Both write the report to backend/donation-conversion-report.txt (donation numbers and donor codes only).
 *
 * Per donation (only rows not converted yet; running it again changes nothing):
 *  - Status: the old status is kept in legacy_status. Received + receipt issued -> Acknowledged; Received without
 *    a receipt -> Accepted (a paid online payment shows Received -> Accepted on its timeline). Pending, Pending
 *    verification, Rejected and Cancelled are left as they are and listed under "Rows that don't fit".
 *  - Allocation: the free text is kept in legacy_allocation. A clear match becomes one line for that program
 *    (Food, Hygiene, Education, Clothing, Health, General support) with the donation's amount; anything unclear
 *    becomes "Other: <original text>" marked Needs review. No amounts are invented.
 *  - Purpose: the mapped program, or Other when unclear.
 *  - Donor records (DNR-NNNN): one per donor account; walk-ins become Individual records (same name and contact =
 *    same record). Possible duplicates are listed, never merged.
 *  - In-kind items: item lines (name and quantity) from the stock the donation added, or parsed from the item
 *    text; the value stays empty (shown as "Value not set"). Lines from stock get a lot linked to that inventory
 *    item, holding no more than what is in stock now.
 * Nothing is deleted. Test data is not changed here (see database/review/031_test_data_review.sql).
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');

const apply = process.argv.includes('--apply');
const emailArg = (() => { const i = process.argv.indexOf('--admin-email'); return i > 0 ? process.argv[i + 1] : null; })();

/** "spaghetti x1, earphones x1, mouse x2" / "2 boxes of soap" / "rice (5)" -> [{ name, quantity, guessed }] */
function parseItems(text) {
  return String(text || '').split(/[,;\n]+/).map((p) => p.trim()).filter(Boolean).map((p) => {
    let m = /^(.*?)\s*(?:x|×|\*)\s*(\d+)$/i.exec(p) || /^(.*?)\s*\((\d+)\)$/.exec(p);
    if (m && m[1]) return { name: m[1].trim().slice(0, 100), quantity: Number(m[2]), guessed: false };
    m = /^(\d+)\s+(.+)$/.exec(p);
    if (m) return { name: m[2].trim().slice(0, 100), quantity: Number(m[1]), guessed: false };
    return { name: p.slice(0, 100), quantity: 1, guessed: true };
  }).filter((x) => x.name && x.quantity > 0);
}

async function convert(conn, adminId) {
  const LC = require('../src/services/donationLifecycle');
  const sys = { user: { user_id: adminId } };
  const report = { rows: [], misfits: [], duplicates: [], stock: [] };
  const [rows] = await conn.query(`SELECT d.*, (SELECT p.status FROM tbl_payments p WHERE p.donation_id = d.donation_id LIMIT 1) AS payment_status,
      (SELECT p.gateway FROM tbl_payments p WHERE p.donation_id = d.donation_id LIMIT 1) AS payment_gateway
    FROM tbl_donations d WHERE d.lifecycle_converted_at IS NULL ORDER BY d.created_at, d.donation_id FOR UPDATE`);
  for (const d of rows) {
    const inKind = String(d.payment_method).toLowerCase() === 'in-kind';
    const amount = Number(d.amount);
    const line = { no: d.donation_no || `#${d.donation_id}`, id: d.donation_id, type: inKind ? 'In-kind' : 'Cash', amount, old: d.status };
    const hist = (from, to, note, at = null) => conn.query(`INSERT INTO tbl_donation_status_history (donation_id, from_status, to_status, note, actor_id, created_at) VALUES (?, ?, ?, ?, ?, ${at ? '?' : 'NOW()'})`,
      at ? [d.donation_id, from, to, note, adminId, at] : [d.donation_id, from, to, note, adminId]);

    // ---- donor record
    let donorRef = d.donor_ref_id;
    if (!donorRef) {
      if (d.donor_id) {
        const [[u]] = await conn.query('SELECT user_id, full_name FROM tbl_users WHERE user_id = ?', [d.donor_id]);
        donorRef = u ? await LC.donorForAccount(conn, u, adminId) : null;
      }
      if (!donorRef && (d.walk_in_name || d.donor_name)) {
        donorRef = await LC.donorForWalkIn(conn, { name: d.walk_in_name || d.donor_name, contact: d.walk_in_contact || null, type: 'Individual' }, adminId);
      }
    }
    const [[dr]] = donorRef ? await conn.query('SELECT donor_code FROM tbl_donors WHERE donor_ref_id = ?', [donorRef]) : [[null]];
    line.donor = dr?.donor_code || 'none';

    // ---- allocation (original text kept) and purpose
    const original = (d.allocation_notes || '').trim();
    const mapped = LC.mapAllocation(original, { amount, inKind });
    const purpose = mapped.lines.length ? (mapped.lines[0].needs_review ? 'Other' : mapped.purpose) : 'Other';
    await conn.query('UPDATE tbl_donations SET legacy_status = COALESCE(legacy_status, status), legacy_allocation = COALESCE(legacy_allocation, ?), donor_ref_id = ? WHERE donation_id = ?',
      [original || null, donorRef, d.donation_id]);
    if (mapped.lines.length) await LC.setAllocation(conn, sys, d, mapped.lines, { purpose });
    await conn.query('UPDATE tbl_donations SET purpose = ? WHERE donation_id = ?', [purpose, d.donation_id]);
    line.allocation = original ? `"${original}" -> ${mapped.lines.map((l) => `${l.program}${l.needs_review ? ' (Needs review)' : ''}${l.amount !== null ? ` PHP ${l.amount.toFixed(2)}` : ''}`).join('; ')}` : '(none) -> no allocation line';
    line.purpose = purpose;

    // ---- in-kind item lines (value empty), linked to the stock they created where possible
    line.items = '';
    if (inKind) {
      const [[have]] = await conn.query('SELECT COUNT(*) AS n FROM tbl_donation_item_lines WHERE donation_id = ?', [d.donation_id]);
      if (!Number(have.n)) {
        const [stock] = await conn.query(`SELECT di.inventory_item_id, di.quantity, i.item_name, i.quantity AS in_stock FROM tbl_donation_items di JOIN tbl_inventory i ON i.item_id = di.inventory_item_id
            WHERE di.donation_id = ? ORDER BY di.inventory_item_id`, [d.donation_id]);
        const made = [];
        if (stock.length) {
          for (const s of stock) {
            const [l] = await conn.query('INSERT INTO tbl_donation_item_lines (donation_id, item_name, quantity, estimated_value, inventory_item_id) VALUES (?, ?, ?, NULL, ?)', [d.donation_id, s.item_name, s.quantity, s.inventory_item_id]);
            const [[used]] = await conn.query('SELECT COALESCE(SUM(remaining_qty), 0) AS n FROM tbl_inventory_lots WHERE item_id = ?', [s.inventory_item_id]);
            const remaining = Math.max(0, Math.min(s.quantity, Number(s.in_stock) - Number(used.n)));
            await conn.query('INSERT INTO tbl_inventory_lots (item_id, donation_id, line_id, received_qty, remaining_qty, received_at, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)',
              [s.inventory_item_id, d.donation_id, l.insertId, s.quantity, remaining, d.received_at || d.created_at, adminId]);
            if (remaining < s.quantity) report.stock.push(`${line.no}: ${s.item_name} x${s.quantity}, only ${remaining} still in stock (the rest was used or adjusted); the lot holds ${remaining}.`);
            made.push(`${s.item_name} x${s.quantity} (linked to stock)`);
          }
        } else {
          for (const it of parseItems(d.item_description)) {
            await conn.query('INSERT INTO tbl_donation_item_lines (donation_id, item_name, quantity, estimated_value) VALUES (?, ?, ?, NULL)', [d.donation_id, it.name, it.quantity]);
            made.push(`${it.name} x${it.quantity}${it.guessed ? ' (quantity assumed 1)' : ''} (no stock link)`);
          }
          if (!made.length) report.misfits.push(`${line.no}: in-kind with no stock rows and no item text; add the items on the donation page.`);
        }
        line.items = made.join(', ');
      }
      // The old whole-donation amount on an in-kind row was not a verified value: it is not used as one.
      if (amount > 0) report.misfits.push(`${line.no}: in-kind with an old amount of PHP ${amount.toFixed(2)}; it is not counted as the estimated value. Use "Add value" on each item.`);
    }

    // ---- status (old kept in legacy_status) and the timeline
    let to = d.status;
    await hist(null, d.status, 'Recorded before the donation lifecycle', d.created_at);
    if (d.status === 'Received') {
      const gateway = d.payment_gateway === 'paymongo' && d.payment_status === 'paid';
      if (gateway) await hist('Received', 'Accepted', 'Converted: online payment confirmed');
      to = d.receipt_issued ? 'Acknowledged' : 'Accepted';
      if (!gateway) await hist('Received', 'Accepted', 'Converted: allocation recorded');
      if (d.receipt_issued) {
        await conn.query('INSERT IGNORE INTO tbl_donation_acknowledgments (donation_id, version, issued_by, issued_at) VALUES (?, 1, NULL, ?)', [d.donation_id, d.received_at || d.created_at]);
        await hist('Accepted', 'Acknowledged', 'Converted: receipt already issued');
      }
      await conn.query('UPDATE tbl_donations SET status = ? WHERE donation_id = ?', [to, d.donation_id]);
      if (mapped.lines.some((l) => l.needs_review) || !mapped.lines.length) report.misfits.push(`${line.no}: now ${to}, but its allocation ${mapped.lines.length ? 'needs review' : 'is missing'}. Fix it on the donation page.`);
    } else {
      report.misfits.push(`${line.no}: status "${d.status}" is left as it is (not Received).`);
    }
    line.status = `${d.status} -> ${to}`;
    // The conversion is not activity: the list keeps sorting these by when they really happened.
    await conn.query('UPDATE tbl_donations SET lifecycle_converted_at = NOW(), last_activity_at = COALESCE(received_at, created_at) WHERE donation_id = ?', [d.donation_id]);
    if (adminId) {
      await conn.query("INSERT INTO tbl_activity_logs (user_id, user_role, action_performed, target_entity, ip_address, device_type) VALUES (?, 'Admin', ?, ?, 'script', NULL)",
        [adminId, `DONATION_CONVERTED (${d.status} -> ${to})`, `Donation #${d.donation_id}`]);
    }
    report.rows.push(line);
  }
  // ---- possible duplicate donor records (same name), never merged
  const [dups] = await conn.query(`SELECT GROUP_CONCAT(donor_code ORDER BY donor_code SEPARATOR ', ') AS codes, GROUP_CONCAT(origin ORDER BY donor_code SEPARATOR ', ') AS origins
      FROM tbl_donors GROUP BY name_key HAVING COUNT(*) > 1`);
  report.duplicates = dups.map((x) => `${x.codes} (${x.origins}): same name. Check whether they are the same person; nothing was merged.`);
  return report;
}

function write(report) {
  const out = [];
  out.push(`Donation conversion ${apply ? 'APPLIED' : 'DRY RUN (nothing was changed)'} - ${new Date().toISOString()}`, '');
  out.push(`${report.rows.length} donation(s) to convert.`, '');
  for (const r of report.rows) {
    out.push(`${r.no}  (${r.type}${r.type === 'Cash' ? `, PHP ${r.amount.toFixed(2)}` : ''})`);
    out.push(`   status:     ${r.status}`);
    out.push(`   allocation: ${r.allocation}`);
    out.push(`   purpose:    ${r.purpose}`);
    out.push(`   donor:      ${r.donor}`);
    if (r.items) out.push(`   items:      ${r.items}`);
    out.push('');
  }
  out.push("Rows that don't fit (check these):", ...(report.misfits.length ? report.misfits.map((m) => ` - ${m}`) : [' - none']), '');
  out.push('Stock that was already used:', ...(report.stock.length ? report.stock.map((m) => ` - ${m}`) : [' - none']), '');
  out.push('Possible duplicate donors (not merged):', ...(report.duplicates.length ? report.duplicates.map((m) => ` - ${m}`) : [' - none']), '');
  const text = out.join('\n');
  fs.writeFileSync(path.join(__dirname, '..', 'donation-conversion-report.txt'), text);
  console.log(text);
  console.log(`Report saved to backend${path.sep}donation-conversion-report.txt`);
}

async function main() {
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST || '127.0.0.1', port: Number(process.env.DB_PORT) || 3306, user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '', database: process.env.DB_NAME || 'caresphere_db',
  });
  try {
    let adminId = null;
    if (apply) {
      if (!emailArg) throw new Error('Add --admin-email <your admin email> so the conversion is recorded under your account.');
      const [[a]] = await conn.query("SELECT u.user_id FROM tbl_users u JOIN tbl_roles r ON r.role_id = u.role_id WHERE u.email = ? AND r.role_name = 'Admin' AND u.is_active = TRUE", [emailArg]);
      if (!a) throw new Error('No active Admin account with that email.');
      adminId = a.user_id;
    }
    await conn.beginTransaction();
    const report = await convert(conn, adminId);
    if (apply) await conn.commit(); else await conn.rollback();
    write(report);
  } catch (err) {
    try { await conn.rollback(); } catch { /* not started */ }
    console.error(`[convert] ${err.message}`);
    process.exitCode = 1;
  } finally { await conn.end(); }
}

if (require.main === module) main();
module.exports = { parseItems, convert };
