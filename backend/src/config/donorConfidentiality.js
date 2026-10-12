/**
 * Donor confidentiality. Donor identity and contact details are visible only to Admin and to Staff with the
 * "Donor directory" duty. Other Staff see the donor code and initials, and masked contact numbers. Contact
 * details are masked for everyone until "Reveal" (which is logged). Anonymous donations show "Anonymous donor"
 * everywhere. Receipts keep the donor's name (or "Anonymous donor") because they are issued to the donor.
 */
const initials = (name) => String(name || '').trim().split(/\s+/).filter(Boolean).map((w) => `${w[0].toUpperCase()}.`).join(' ') || 'Donor';
const maskContact = (v) => { const s = String(v || ''); return s ? `${'•'.repeat(Math.max(0, s.length - 4))}${s.slice(-4)}` : s; };
const maskEmail = (v) => String(v || '').replace(/^(.).*(@.*)$/, '$1***$2');
const ANONYMOUS = 'Anonymous donor';

/** Admin, or Staff with the Donor directory duty. Accepts a user object (or a role string, for older callers). */
function canSeeDonors(user) {
  if (!user) return false;
  if (typeof user === 'string') return user === 'Admin' || user === 'Donor';
  return user.role === 'Admin' || user.role === 'Donor' || (user.role === 'Staff' && (user.duties || []).includes('donor_directory'));
}

/** The donor as this viewer may see it: name, or "DNR-0001 · J. L.", or "Anonymous donor". */
function donorLabel(row, user) {
  if (row.is_anonymous) return ANONYMOUS;
  const name = row.donor_type === 'walk_in' ? (row.walk_in_name || row.donor_name) : (row.donor_name || row.donor_record_name);
  if (canSeeDonors(user)) return name;
  return [row.donor_code, initials(name)].filter(Boolean).join(' · ');
}

/** A donation or payment row as the viewer may see it (names, contacts). */
function forViewer(row, user) {
  const sees = canSeeDonors(user);
  const out = { ...row, donor_display: 'donor_name' in row || 'walk_in_name' in row ? donorLabel(row, user) : undefined, donor_masked: !sees };
  delete out.donor_contact_enc;
  if (row.is_anonymous && user?.role !== 'Admin') {
    out.donor_name = ANONYMOUS; out.walk_in_name = null; out.walk_in_contact = null;
  }
  if (!sees) {
    if ('donor_name' in out && !row.is_anonymous) out.donor_name = initials(out.donor_name);
    if ('walk_in_name' in out && out.walk_in_name) out.walk_in_name = initials(out.walk_in_name);
    if ('donor_record_name' in out) out.donor_record_name = null;
    if ('donor_email' in out) delete out.donor_email;
  }
  if ('walk_in_contact' in out && out.walk_in_contact) out.walk_in_contact = maskContact(out.walk_in_contact);
  return out;
}

module.exports = { canSeeDonors, donorLabel, forViewer, initials, maskContact, maskEmail, ANONYMOUS, STAFF_SEE_DONOR_NAMES: false };
