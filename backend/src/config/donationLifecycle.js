/**
 * Donation lifecycle, programs, void reasons and display labels. The rules that use them are in
 * services/donationLifecycle.js. Edit wording here.
 *
 *   Pending -> Received -> (Under inspection, in-kind) -> Accepted (allocation required)
 *   -> Acknowledged (acknowledgment issued) -> Allocated -> Partially distributed -> Fully distributed -> Closed
 *   Rejected (not accepted) and Voided (entered by mistake, duplicate, not received) end a donation.
 * 'Pending verification' (a bank transfer waiting for staff) and 'Cancelled' (an older status) are kept so
 * no row ever loses its status.
 */
const STATUSES = ['Pending', 'Pending verification', 'Received', 'Under inspection', 'Accepted', 'Acknowledged', 'Allocated',
  'Partially distributed', 'Fully distributed', 'Closed', 'Rejected', 'Voided', 'Cancelled'];
/** The statuses shown in the Status filter (the lifecycle, in order). */
const FILTER_STATUSES = ['Pending', 'Pending verification', 'Received', 'Under inspection', 'Accepted', 'Acknowledged', 'Allocated',
  'Partially distributed', 'Fully distributed', 'Closed', 'Rejected', 'Voided'];
/** Verified or accepted: the only donations counted in totals and reports (never Voided, Rejected or pending). */
const COUNTED = ['Received', 'Under inspection', 'Accepted', 'Acknowledged', 'Allocated', 'Partially distributed', 'Fully distributed', 'Closed'];
/** Edit is allowed before acknowledgment; afterwards changes are correction entries with a reason. */
const EDITABLE = ['Pending', 'Received', 'Under inspection', 'Accepted'];
/** Statuses that come after the acknowledgment. */
const ACKNOWLEDGED_OR_LATER = ['Acknowledged', 'Allocated', 'Partially distributed', 'Fully distributed', 'Closed'];
/** Distribution and utilization can be recorded once the allocation is confirmed. */
const DISTRIBUTABLE = ['Allocated', 'Partially distributed'];
const ENDED = ['Rejected', 'Voided', 'Cancelled', 'Closed'];

/** Allowed manual transitions (the server checks each one; the page offers only the next allowed action). */
const TRANSITIONS = {
  Pending: ['Received', 'Rejected'],
  Received: ['Under inspection', 'Accepted', 'Rejected'],
  'Under inspection': ['Accepted', 'Rejected'],
  Acknowledged: ['Allocated'],
  'Fully distributed': ['Closed'],
};

const PROGRAMS = ['Food', 'Hygiene', 'Education', 'Clothing', 'Health', 'Shelter and utilities', 'General support', 'Other'];
const PURPOSES = PROGRAMS;

/**
 * Words that map a free-text allocation to a program (migration and the bank-transfer note). Matched on whole
 * words, case-insensitive. Text matching none, or more than one program, becomes "Other: <text>" (Needs review).
 */
const PROGRAM_KEYWORDS = {
  Food: ['food', 'foods', 'meal', 'meals', 'rice', 'candy', 'candies', 'snack', 'snacks', 'milk', 'grocery', 'groceries', 'canned', 'noodles', 'biscuits', 'spaghetti', 'bread', 'fruit', 'fruits', 'formula'],
  Hygiene: ['hygiene', 'soap', 'shampoo', 'toothpaste', 'toothbrush', 'toothbrushes', 'diaper', 'diapers', 'sanitary', 'tissue', 'detergent', 'toiletries'],
  Education: ['study', 'studies', 'school', 'education', 'educational', 'book', 'books', 'notebook', 'notebooks', 'pencil', 'pencils', 'tuition', 'learning', 'learn'],
  Clothing: ['clothing', 'clothes', 'cloth', 'shirt', 'shirts', 'shoes', 'uniform', 'uniforms', 'apparel', 'dress', 'dresses'],
  Health: ['health', 'medicine', 'medicines', 'medical', 'vitamins', 'checkup', 'dental'],
  'General support': ['general support', 'general', 'operations', 'children in our care'],
};

const VOID_REASONS = ['Entered by mistake', 'Duplicate entry', 'Payment not received', 'Test data', 'Other'];
const DONOR_TYPES = ['Individual', 'Organization'];
const DOCUMENT_KINDS = { delivery_receipt: 'Delivery receipt', proof_of_transfer: 'Proof of transfer', photo: 'Donation photo', other: 'Other document' };
const CORRECTABLE = ['amount', 'purpose', 'payment_method'];

/** Method shown in the list: the method only (reference numbers and descriptions are on the detail page). */
function methodLabel(m) {
  const s = String(m || '').trim();
  const low = s.toLowerCase();
  if (low === 'in-kind') return 'In-kind';
  if (low === 'cash') return 'Cash';
  if (low.startsWith('bank')) return 'Bank transfer';
  if (['gcash', 'maya', 'grabpay', 'shopeepay / maribank'].includes(low)) return `E-wallet (${s})`;
  if (low === 'check' || low === 'cheque') return 'Check';
  return s || 'Not recorded';
}

module.exports = {
  STATUSES, FILTER_STATUSES, COUNTED, EDITABLE, ACKNOWLEDGED_OR_LATER, DISTRIBUTABLE, ENDED, TRANSITIONS, PROGRAMS, PURPOSES,
  PROGRAM_KEYWORDS, VOID_REASONS, DONOR_TYPES, DOCUMENT_KINDS, CORRECTABLE, methodLabel,
};
