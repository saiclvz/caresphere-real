/**
 * Visit deletion when the visit has a donation. The Visitors page never creates donations
 * itself: donations are recorded through donationService.recordDonation.
 */
const { withTransaction } = require('../config/db');
const HttpError = require('../utils/HttpError');
const { removeDonation } = require('./donationService');

/**
 * Deletes a visit. If a donation is linked to it, `choice` decides: 'keep' leaves the
 * donation on the Donations page (unlinked), 'remove' deletes it and reverses its stock.
 */
async function deleteVisit(visitorId, choice, userId) {
  return withTransaction(async (conn) => {
    const [[v]] = await conn.query('SELECT visitor_id FROM tbl_visitors WHERE visitor_id = ? FOR UPDATE', [visitorId]);
    if (!v) throw new HttpError(404, 'Visitor record not found.');
    const [[d]] = await conn.query('SELECT donation_id FROM tbl_donations WHERE visit_id = ? FOR UPDATE', [visitorId]);
    let reversed = [];
    if (d) {
      if (choice === 'remove') reversed = await removeDonation(conn, d.donation_id, userId);
      else await conn.query('UPDATE tbl_donations SET visit_id = NULL WHERE donation_id = ?', [d.donation_id]);
    }
    await conn.query('DELETE FROM tbl_visitors WHERE visitor_id = ?', [visitorId]);
    return { donationId: d?.donation_id || null, reversed };
  });
}

module.exports = { deleteVisit };
