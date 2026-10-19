/**
 * Inventory movements (migration 035). Every quantity change is a movement with a type and a reason; the item's
 * quantity is only ever changed together with its movement row (services/inventoryMovements.js).
 *
 * Manual movements (Inventory page): Stock in, Stock out, Adjustment, Disposal. Donations add and remove stock
 * through the Donations module (donation_in, distribution_out, void_reversal ...); those rows are shown under the
 * matching type with the donation as the related record.
 */
const TYPES = {
  stock_in: { label: 'Stock in', sign: 1, reasons: ['Purchase', 'Return', 'Other'] },
  stock_out: { label: 'Stock out', sign: -1, reasons: ['Meal preparation', 'Child supplies', 'Medical', 'Distribution', 'Damaged/expired', 'Other'] },
  adjustment: { label: 'Adjustment', sign: 0, reasons: ['Physical count correction', 'Data correction', 'Other'] },
  disposal: { label: 'Disposal', sign: -1, reasons: ['Expired', 'Damaged', 'Lost', 'Other'] },
};
/** Set by the system only (never chosen on the page). */
const OPENING_BALANCE = 'Opening balance';

/** Every stored movement_type, shown as one of the four types. */
const DISPLAY = {
  stock_in: 'stock_in', donation_in: 'stock_in',
  stock_out: 'stock_out', distribution_out: 'stock_out', donation_reversal: 'stock_out', void_reversal: 'stock_out',
  adjustment: 'adjustment', manual_edit: 'adjustment', correction: 'adjustment',
  disposal: 'disposal',
};
/** Reason shown for movements recorded before reasons existed. */
const LEGACY_REASON = {
  donation_in: 'Donation', distribution_out: 'Donation used (distribution)', donation_reversal: 'Donation reversed',
  void_reversal: 'Donation voided', manual_edit: 'Quantity edited (before reasons were recorded)', correction: 'Correction',
};

const MAX_QTY = 1000000;

module.exports = { TYPES, OPENING_BALANCE, DISPLAY, LEGACY_REASON, MAX_QTY };
