/**
 * The one way staff record a donation (Donations page and Visitors page share it).
 * Everything happens in ONE transaction, so either all of it saves or none of it does:
 *   1. the donation (donor type, source, receipt code for the receipt and its QR code)
 *   2. in-kind items: new inventory items if needed, tbl_donation_items, and a
 *      'donation_in' stock movement per item (row-locked)
 *   3. the visit link (visit_id), clearing any "needs review" flag on that visit
 *   4. the children supported, or the general flag
 *   5. the audit log entry
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
  const base = `CSR-${Date.now().toString(36).toUpperCase()}-${randomCode(3)}`;
  return `${base}.${hmac(base, env.receiptKey).slice(0, 16)}`;
}

/**
 * Changes one item's stock with a row lock (SELECT ... FOR UPDATE), so simultaneous
 * entries can't corrupt the count, and records the movement.
 */
async function moveStock(conn, { itemId, change, type, donationId, userId }) {
  const [[item]] = await conn.query('SELECT item_id, item_name, quantity, min_threshold FROM tbl_inventory WHERE item_id = ? FOR UPDATE', [itemId]);
  if (!item) throw new HttpError(400, 'One of the inventory items no longer exists. Refresh and try again.');
  const after = item.quantity + change;
  if (after < 0) {
    throw new HttpError(409, `Only ${item.quantity} ${item.item_name} left in stock, so ${-change} can't be removed. Keep the donation instead, or correct the stock on the Inventory page first.`);
  }
  await conn.query('UPDATE tbl_inventory SET quantity = ?, last_updated_by = ? WHERE item_id = ?', [after, userId, itemId]);
  await conn.query(
    `INSERT INTO tbl_inventory_movements (item_id, movement_type, change_qty, quantity_after, donation_id, created_by)
     VALUES (?, ?, ?, ?, ?, ?)`, [itemId, type, change, after, donationId, userId]);
  // Crossing into low stock notifies Admin and Staff in this same transaction.
  if (item.quantity > item.min_threshold && after <= item.min_threshold) await require('./notifications').lowStock(conn);
  return { item_id: itemId, item_name: item.item_name, quantity: Math.abs(change) };
}

/**
 * @param req   the request (for the acting user and the audit log)
 * @param d     cleaned input from donationController.create:
 *   { donor_type, donor (user row) | walk_in_name + walk_in_contact, visit_id?, amount, payment_method,
 *     reason_category, description, allocation_notes, is_general, child_ids, items: [{ item_id } | { new_item }, quantity] }
 */
async function recordDonation(req, d) {
  const userId = req.user.user_id;
  return withTransaction(async (conn) => {
    // ---- the visit (locked so two staff can't link donations to it at the same time)
    let visit = null;
    if (d.visit_id) {
      [[visit]] = await conn.query('SELECT visitor_id, visitor_name, check_in_time FROM tbl_visitors WHERE visitor_id = ? FOR UPDATE', [d.visit_id]);
      if (!visit) throw new HttpError(404, 'That visit no longer exists. Refresh the Visitors page and try again.');
      const [[taken]] = await conn.query('SELECT donation_id FROM tbl_donations WHERE visit_id = ?', [d.visit_id]);
      if (taken) throw new HttpError(409, `This visit already has a donation (#${String(taken.donation_id).padStart(6, '0')}). A visit can have only one.`);
    }

    // ---- duplicate guard for walk-ins without a visit: same name, same amount, last 10 minutes
    if (d.donor_type === 'walk_in' && !d.visit_id) {
      const [[dup]] = await conn.query(
        `SELECT donation_id, created_at FROM tbl_donations
          WHERE donor_type = 'walk_in' AND LOWER(walk_in_name) = LOWER(?) AND amount = ?
            AND created_at >= NOW() - INTERVAL ? MINUTE
          ORDER BY created_at DESC LIMIT 1 FOR UPDATE`, [d.walk_in_name, d.amount, DUPLICATE_WINDOW_MINUTES]);
      if (dup) {
        throw new HttpError(409, `This looks like a duplicate: donation #${String(dup.donation_id).padStart(6, '0')} from ${d.walk_in_name} for the same amount was recorded at ${String(dup.created_at).slice(11, 16)}. Check the Donations page before recording it again.`,
          { duplicate_of: dup.donation_id });
      }
    }

    // ---- new inventory items for in-kind gifts (created at 0, stocked below)
    const lines = [];
    for (const line of d.items || []) {
      if (line.new_item) {
        const [[exists]] = await conn.query('SELECT item_id FROM tbl_inventory WHERE LOWER(item_name) = LOWER(?) LIMIT 1 FOR UPDATE', [line.new_item.item_name]);
        if (exists) throw new HttpError(409, `An inventory item named "${line.new_item.item_name}" already exists. Pick it from the list instead.`);
        const [res] = await conn.query(
          `INSERT INTO tbl_inventory (item_name, category, quantity, min_threshold, is_needed_by_donors, last_updated_by)
           VALUES (?, ?, 0, ?, FALSE, ?)`, [line.new_item.item_name, line.new_item.category, line.new_item.min_threshold, userId]);
        lines.push({ itemId: res.insertId, quantity: line.quantity });
      } else {
        lines.push({ itemId: line.item_id, quantity: line.quantity });
      }
    }

    // ---- the donation itself (receipt code included)
    const walkIn = d.donor_type === 'walk_in';
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
      status: 'Received',
      item_description: d.description,
      reason_category: d.reason_category,
      is_general: d.is_general,
      child_ids: d.child_ids,
      allocation_notes: d.allocation_notes,
      qr_receipt_code: makeReceiptCode(),
    });

    // ---- in-kind stock, locked in item order so two entries can't deadlock
    const items = [];
    for (const line of [...lines].sort((a, b) => a.itemId - b.itemId)) {
      await conn.query('INSERT INTO tbl_donation_items (donation_id, inventory_item_id, quantity) VALUES (?, ?, ?)', [donationId, line.itemId, line.quantity]);
      items.push(await moveStock(conn, { itemId: line.itemId, change: line.quantity, type: 'donation_in', donationId, userId }));
    }

    // ---- the visit is now "Donated"; it no longer needs review
    if (visit) await conn.query('UPDATE tbl_visitors SET needs_review = FALSE WHERE visitor_id = ?', [visit.visitor_id]);

    // ---- audit log, in the same transaction
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

/**
 * Removes a donation inside a transaction. In-kind stock it added is taken back out
 * with a 'donation_reversal' movement (row-locked). Returns the reversed items.
 */
async function removeDonation(conn, donationId, userId) {
  const items = await Donation.items(donationId, conn);
  const reversed = [];
  for (const it of items) {
    reversed.push(await moveStock(conn, { itemId: it.item_id, change: -it.quantity, type: 'donation_reversal', donationId, userId }));
  }
  await conn.query('DELETE FROM tbl_donations WHERE donation_id = ?', [donationId]); // items cascade; movements keep history
  return reversed;
}

module.exports = { recordDonation, removeDonation, moveStock, makeReceiptCode, DUPLICATE_WINDOW_MINUTES };
