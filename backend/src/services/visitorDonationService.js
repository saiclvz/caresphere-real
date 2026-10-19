/**
 * Visit deletion when the visit has a donation. The Visitors page never creates donations
 * itself: donations are recorded through donationService.recordDonation. Donations are never
 * deleted: "void" voids the donation (with a reason; its stock is reversed) and unlinks it.
 */
const { withTransaction } = require('../config/db');
const HttpError = require('../utils/HttpError');
const { moveStock } = require('./donationService');

/**
 * Deletes a visit. If a donation is linked to it, `choice` decides: 'keep' leaves the donation on the
 * Donations page (unlinked); 'void' voids it (Admin, with a reason) and unlinks it. Both keep the donation row.
 */
async function deleteVisit(req, visitorId, choice, voidBody = {}) {
  const LC = require('./donationLifecycle');
  return withTransaction(async (conn) => {
    const [[v]] = await conn.query('SELECT visitor_id FROM tbl_visitors WHERE visitor_id = ? AND archived_at IS NULL FOR UPDATE', [visitorId]);
    if (!v) throw new HttpError(404, 'Visitor record not found.');
    const [[d0]] = await conn.query('SELECT donation_id FROM tbl_donations WHERE visit_id = ? FOR UPDATE', [visitorId]);
    let reversed = [];
    if (d0) {
      if (choice === 'void') {
        const d = await LC.lockDonation(conn, d0.donation_id);
        if (d.status !== 'Voided') reversed = await LC.voidDonation(conn, req, { ...d, amount: Number(d.amount), in_kind: d.payment_method === 'In-kind' }, voidBody, moveStock);
      }
      await conn.query('UPDATE tbl_donations SET visit_id = NULL, last_activity_at = NOW() WHERE donation_id = ?', [d0.donation_id]);
    }
    // Visits are never deleted (migration 034): archived with the reason, hidden from the Visitors page.
    await conn.query('UPDATE tbl_visitors SET archived_at = NOW(), archived_by = ?, archive_reason = ? WHERE visitor_id = ?',
      [req.user.user_id, String(voidBody.archive_reason || 'Removed from the visitor log').slice(0, 500), visitorId]);
    return { donationId: d0?.donation_id || null, reversed };
  });
}

module.exports = { deleteVisit };
