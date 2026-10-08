/**
 * Donor confidentiality. Donor identity and contact details are confidential: Admin sees them; Staff see
 * initials (names) and masked contact numbers in donation lists and the bank-transfer queue. Staff can
 * still record and verify donations: matching uses the reference number, amount and date, and the donor
 * picker shows names only (no email) so Staff can choose the right registered donor.
 * Receipts keep the donor's name because they are issued to the donor.
 */
const STAFF_SEE_DONOR_NAMES = false;

const initials = (name) => String(name || '').trim().split(/\s+/).filter(Boolean).map((w) => `${w[0].toUpperCase()}.`).join(' ') || 'Donor';
const maskContact = (v) => { const s = String(v || ''); return s ? `${'•'.repeat(Math.max(0, s.length - 4))}${s.slice(-4)}` : s; };

/** A donation or payment row as the viewer may see it. */
function forViewer(row, role) {
  if (role === 'Admin' || role === 'Donor') return row;
  const out = { ...row, donor_masked: true };
  if (!STAFF_SEE_DONOR_NAMES) {
    if ('donor_name' in out) out.donor_name = initials(out.donor_name);
    if ('walk_in_name' in out && out.walk_in_name) out.walk_in_name = initials(out.walk_in_name);
    if ('donor_email' in out) delete out.donor_email;
  }
  if ('walk_in_contact' in out && out.walk_in_contact) out.walk_in_contact = maskContact(out.walk_in_contact);
  return out;
}

module.exports = { STAFF_SEE_DONOR_NAMES, forViewer, initials, maskContact };
