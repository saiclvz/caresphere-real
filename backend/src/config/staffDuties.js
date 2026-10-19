/**
 * Staff duties: the areas Admin assigns to each Staff account. The server checks them on every request
 * (middleware/requireDuty.js); Admin has every area; Donors are not affected.
 * Duties don't replace the other rules: sensitive records still need the record to be assigned to the
 * staff member, plus the purpose step, QR token and 3-minute access.
 */
const DUTIES = {
  children: { label: 'Child records', hint: 'Children directory and Care cards; core records when assigned as case worker' },
  admission: { label: 'Admission', hint: 'Start a New Admission and complete it for Admin approval (no lasting access unless assigned)' },
  health: { label: 'Health records', hint: 'Child health records (as the assigned case worker, through the unlock step)' },
  adoption: { label: 'Adoption', hint: 'Adoption applications, CDCLAA and protected adoption records' },
  transition: { label: 'Transition Review', hint: 'Transition reviews for youth turning 18' },
  donations: { label: 'Donations', hint: 'Donations, acknowledgments and receipts' },
  cash_verification: { label: 'Donations: cash verification', hint: "Verify donor reports against the home's account, reconciliation and the daily cash count (needs Donations too)" },
  donor_directory: { label: 'Donor directory', hint: 'Donor names, contact details and donor profiles (others see donor codes and initials)' },
  visitors: { label: 'Visitors', hint: 'Visitor log and walk-in donations' },
  inventory: { label: 'Inventory', hint: 'Stock items and low-stock alerts' },
  meals: { label: 'Meals', hint: 'Meal plans' },
};
const DUTY_KEYS = Object.keys(DUTIES);
/** New Staff accounts start with every duty except the donor directory and cash verification (both opt-in). */
const DEFAULT_DUTIES = DUTY_KEYS.filter((k) => k !== 'donor_directory' && k !== 'cash_verification');

/** Which duty each assignable record type (and unlock record type) needs. */
const DUTY_FOR_RECORD = { child: 'children', health: 'health', adoption_application: 'adoption', transition_review: 'transition' };

module.exports = { DUTIES, DUTY_KEYS, DEFAULT_DUTIES, DUTY_FOR_RECORD };
