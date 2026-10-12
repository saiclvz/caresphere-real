/**
 * Staff duties: the areas Admin assigns to each Staff account. The server checks them on every request
 * (middleware/requireDuty.js); Admin has every area; Donors are not affected.
 * Duties don't replace the other rules: sensitive records still need the record to be assigned to the
 * staff member, plus the purpose step, QR token and 3-minute access.
 */
const DUTIES = {
  children: { label: 'Child records', hint: 'Children list, child profiles, registering children' },
  health: { label: 'Health records', hint: 'Child health records and case files (as case worker)' },
  adoption: { label: 'Adoption', hint: 'Adoption applications, CDCLAA and protected adoption records' },
  transition: { label: 'Transition Review', hint: 'Transition reviews for youth turning 18' },
  donations: { label: 'Donations', hint: 'Donations, bank-transfer verification and receipts' },
  donor_directory: { label: 'Donor directory', hint: 'Donor names, contact details and donor profiles (others see donor codes and initials)' },
  visitors: { label: 'Visitors', hint: 'Visitor log and walk-in donations' },
  inventory: { label: 'Inventory', hint: 'Stock items and low-stock alerts' },
  meals: { label: 'Meals', hint: 'Meal plans' },
};
const DUTY_KEYS = Object.keys(DUTIES);
/** New Staff accounts start with every duty except the donor directory (donor identity is opt-in). */
const DEFAULT_DUTIES = DUTY_KEYS.filter((k) => k !== 'donor_directory');

/** Which duty each assignable record type (and unlock record type) needs. */
const DUTY_FOR_RECORD = { child: 'health', health: 'health', adoption_application: 'adoption', transition_review: 'transition' };

module.exports = { DUTIES, DUTY_KEYS, DEFAULT_DUTIES, DUTY_FOR_RECORD };
