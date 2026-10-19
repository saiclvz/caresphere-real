/**
 * The one way staff record a donation (Donations page and Visitors page share it).
 * Everything happens in ONE transaction, so either all of it saves or none of it does:
 *   1. the donor record (DNR-NNNN) and the donation (number DNT-YYYY-NNNN, receipt code for the QR)
 *   2. in-kind items: new inventory items if needed, item lines, inventory lots and a
 *      'donation_in' stock movement per item (row-locked)
 *   3. the allocation lines, the status timeline, the visit link
 *   4. the audit log entry
 * Donations are never deleted: see donationLifecycle.voidDonation.
 */
const env = require('../config/env');
const { withTransaction } = require('../config/db');
const Donation = require('../models/donationModel');
const HttpError = require('../utils/HttpError');
const { hmac, randomCode } = require('../utils/crypto');
const { logActivityWith } = require('../utils/audit');

const DUPLICATE_WINDOW_MINUTES = 10;

/** Unique, signed receipt code. It is printed as text under the receipt's QR code. */
function makeReceiptCode() {
  // 120 random bits (separate from the sequential donation and acknowledgment numbers) plus a 96-bit signature.
  const base = `CSR-${randomCode(15)}`;
  return `${base}.${hmac(base, env.receiptKey).slice(0, 16)}`;
}

/**
 * Changes one item's stock with a row lock (SELECT ... FOR UPDATE), so simultaneous
 * entries can't corrupt the count, and records the movement.
 */
async function moveStock(conn, { itemId, change, type, donationId, userId, lotId = null, note = null }) {
  const [[item]] = await conn.query('SELECT item_id, item_name, quantity, min_threshold FROM tbl_inventory WHERE item_id = ? FOR UPDATE', [itemId]);
  if (!item) throw new HttpError(400, 'One of the inventory items no longer exists. Refresh and try again.');
  const after = item.quantity + change;
  if (after < 0) {
    throw new HttpError(409, `Only ${item.quantity} ${item.item_name} left in stock, so ${-change} can't be removed. Keep the donation instead, or correct the stock on the Inventory page first.`);
  }
  await conn.query('UPDATE tbl_inventory SET quantity = ?, last_updated_by = ? WHERE item_id = ?', [after, userId, itemId]);
  await conn.query(
    `INSERT INTO tbl_inventory_movements (item_id, movement_type, change_qty, quantity_before, quantity_after, donation_id, created_by, lot_id, note)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`, [itemId, type, change, item.quantity, after, donationId, userId, lotId, note ? String(note).slice(0, 255) : null]);
  // Crossing into low stock notifies Admin and Staff in this same transaction.
  if (item.quantity > item.min_threshold && after <= item.min_threshold) await require('./notifications').lowStock(conn);
  return { item_id: itemId, item_name: item.item_name, quantity: Math.abs(change) };
}

/**
 * @param req   the request (for the acting user and the audit log)
 * @param d     cleaned input from donationController.create:
 *   { donor_type, donor (user row) | walk_in_name + walk_in_contact + walk_in_kind, anonymous, visit_id?, amount,
 *     payment_method, description, purpose, allocation: [{ program, amount | intended_use }],
 *     items: [{ item_id } | { new_item }, quantity, estimated_value?, expiry_date?] }
 * Creates the donation number, the donor record, item lines with their inventory lots, the allocation lines and
 * the first timeline entries. Recorded donations start as Received; a cash donation with a complete allocation
 * is Accepted straight away (in-kind gifts are inspected first).
 */
async function recordDonation(req, d) {
  const userId = req.user.user_id;
  const LC = require('./donationLifecycle');
  return withTransaction(async (conn) => {
    // ---- the visit (locked so two staff can't link donations to it at the same time)
    let visit = null;
    if (d.visit_id) {
      [[visit]] = await conn.query('SELECT visitor_id, visitor_name, check_in_time FROM tbl_visitors WHERE visitor_id = ? FOR UPDATE', [d.visit_id]);
      if (!visit) throw new HttpError(404, 'That visit no longer exists. Refresh the Visitors page and try again.');
      const [[taken]] = await conn.query('SELECT donation_id, donation_no FROM tbl_donations WHERE visit_id = ?', [d.visit_id]);
      if (taken) throw new HttpError(409, `This visit already has a donation (${taken.donation_no || `#${taken.donation_id}`}). A visit can have only one.`);
    }

    // ---- duplicate guard for walk-ins without a visit: same name, same amount, last 10 minutes
    if (d.donor_type === 'walk_in' && !d.visit_id) {
      const [[dup]] = await conn.query(
        `SELECT donation_id, donation_no, created_at FROM tbl_donations
          WHERE donor_type = 'walk_in' AND LOWER(walk_in_name) = LOWER(?) AND amount = ? AND status <> 'Voided'
            AND created_at >= NOW() - INTERVAL ? MINUTE
          ORDER BY created_at DESC LIMIT 1 FOR UPDATE`, [d.walk_in_name, d.amount, DUPLICATE_WINDOW_MINUTES]);
      if (dup) {
        throw new HttpError(409, `This looks like a duplicate: donation ${dup.donation_no || `#${dup.donation_id}`} for the same donor and amount was recorded at ${String(dup.created_at).slice(11, 16)}. Check the Donations page before recording it again.`,
          { duplicate_of: dup.donation_id });
      }
    }

    // ---- new inventory items for in-kind gifts (created at 0, stocked below)
    const lines = [];
    for (const line of d.items || []) {
      if (line.new_item) {
        const [[exists]] = await conn.query('SELECT item_id, archived_at FROM tbl_inventory WHERE LOWER(item_name) = LOWER(?) LIMIT 1 FOR UPDATE', [line.new_item.item_name]);
        if (exists?.archived_at) throw new HttpError(409, `An archived inventory item is named "${line.new_item.item_name}". Ask an Admin to restore it, then pick it from the list.`);
        if (exists) throw new HttpError(409, `An inventory item named "${line.new_item.item_name}" already exists. Pick it from the list instead.`);
        const [res] = await conn.query(
          `INSERT INTO tbl_inventory (item_name, category, quantity, min_threshold, is_needed_by_donors, last_updated_by)
           VALUES (?, ?, 0, ?, FALSE, ?)`, [line.new_item.item_name, line.new_item.category, line.new_item.min_threshold, userId]);
        lines.push({ ...line, itemId: res.insertId, name: line.new_item.item_name });
      } else {
        const [[it]] = await conn.query('SELECT item_name FROM tbl_inventory WHERE item_id = ? AND archived_at IS NULL', [line.item_id]);
        if (!it) throw new HttpError(400, 'One of the inventory items no longer exists or was archived. Refresh and try again.');
        lines.push({ ...line, itemId: line.item_id, name: it.item_name });
      }
    }

    // ---- the donor record (DNR-NNNN) and the donation itself (number and receipt code included)
    const walkIn = d.donor_type === 'walk_in';
    const donorRef = walkIn
      ? await LC.donorForWalkIn(conn, { name: d.walk_in_name, contact: d.walk_in_contact, type: d.walk_in_kind || 'Individual' }, userId)
      : await LC.donorForAccount(conn, d.donor, userId);
    // ---- dual control: cash above the threshold waits for a second person (not counted, no acknowledgment)
    const cashControls = require('./cashControls');
    const dual = d.payment_method === 'Cash' && await cashControls.needsDualControl(conn, Math.round(Number(d.amount) * 100));
    const firstStatus = dual ? 'Pending' : 'Received';
    const donationId = await Donation.insertWith(conn, {
      donor_id: walkIn ? null : d.donor.user_id,
      donor_type: d.donor_type,
      walk_in_name: walkIn ? d.walk_in_name : null,
      walk_in_contact: walkIn ? d.walk_in_contact : null,
      visit_id: d.visit_id || null,
      donor_name: walkIn ? d.walk_in_name : d.donor.full_name,
      source: d.visit_id ? 'visitors_page' : 'donations_page',
      amount: d.amount,
      payment_method: d.payment_method,
      status: firstStatus,
      item_description: d.description,
      reason_category: null,
      is_general: true,
      child_ids: [],
      allocation_notes: null,
      qr_receipt_code: makeReceiptCode(),
      donor_ref_id: donorRef,
      is_anonymous: d.anonymous,
      purpose: d.purpose,
    });
    await conn.query('UPDATE tbl_donations SET recorded_by = ?, dual_control = ? WHERE donation_id = ?', [userId, dual ? 'Waiting' : null, donationId]);
    const donation = { donation_id: donationId, status: firstStatus, payment_method: d.payment_method, amount: d.amount, dual_control: dual ? 'Waiting' : null };
    await LC.history(conn, donationId, null, firstStatus, `${d.visit_id ? 'Recorded from a visit' : 'Recorded by staff'}${dual ? '; waiting for a second person to confirm the cash' : ''}`, userId);

    // ---- in-kind lines, lots and stock, locked in item order so two entries can't deadlock
    const items = [];
    for (const line of [...lines].sort((a, b) => a.itemId - b.itemId)) {
      await conn.query('INSERT INTO tbl_donation_items (donation_id, inventory_item_id, quantity) VALUES (?, ?, ?)', [donationId, line.itemId, line.quantity]);
      const [l] = await conn.query('INSERT INTO tbl_donation_item_lines (donation_id, item_name, quantity, estimated_value, inventory_item_id, expiry_date) VALUES (?, ?, ?, ?, ?, ?)',
        [donationId, line.name, line.quantity, line.estimated_value ?? null, line.itemId, line.expiry_date || null]);
      const [lot] = await conn.query('INSERT INTO tbl_inventory_lots (item_id, donation_id, line_id, received_qty, remaining_qty, expiry_date, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [line.itemId, donationId, l.insertId, line.quantity, line.quantity, line.expiry_date || null, userId]);
      items.push(await moveStock(conn, { itemId: line.itemId, change: line.quantity, type: 'donation_in', donationId, userId, lotId: lot.insertId }));
    }

    // ---- allocation lines; a complete cash allocation accepts the donation now
    await LC.setAllocation(conn, req, donation, d.allocation, { purpose: d.purpose });
    if (dual) await cashControls.askSecondPerson(conn, req, donationId);
    if (d.payment_method === 'Cash') await cashControls.afterCashRecorded(conn, req, donationId);
    if (!dual && !LC.isInKind(donation) && !(await LC.allocationProblems(conn, donation)).length) {
      await LC.setStatus(conn, req, donation, 'Accepted', 'Allocation recorded with the donation');
    }

    // ---- the visit is now "Donated"; it no longer needs review
    if (visit) await conn.query('UPDATE tbl_visitors SET needs_review = FALSE WHERE visitor_id = ?', [visit.visitor_id]);

    // ---- audit log, in the same transaction (no names: the donor type and method only)
    const who = walkIn ? 'walk-in' : `registered donor #${d.donor.user_id}`;
    await logActivityWith(conn, req, `CREATE_DONATION (${who}, ${d.payment_method}${visit ? `, visit #${visit.visitor_id}` : ''})`, `Donation #${donationId}`);
    for (const it of items) {
      await logActivityWith(conn, req, `INVENTORY_DONATION_IN (+${it.quantity}, donation #${donationId})`, `Inventory #${it.item_id}`);
    }
    const source = d.donor_type === 'walk_in' ? 'walk-in visitor' : 'recorded by staff';
    await require('./notifications').toAdmins(conn, 'admin_donation_received', { params: { source }, groupKey: 'donations_received', mode: 'count', exceptUserId: userId });
    return { donationId, items };
  });
}

module.exports = { recordDonation, moveStock, makeReceiptCode, DUPLICATE_WINDOW_MINUTES };
