import { Ban, CheckCircle2, CircleDot, Clock, FileCheck2, Lock, PackageCheck, PackageOpen, Search, ShieldCheck, Truck, XCircle } from 'lucide-react';

/** Lifecycle status: badge tone and icon (the word is always shown too). */
export const STATUS_META = {
  Pending: { tone: 'amber', icon: Clock },
  'Pending verification': { tone: 'amber', icon: Clock },
  Received: { tone: 'blue', icon: PackageOpen },
  'Under inspection': { tone: 'blue', icon: Search },
  Accepted: { tone: 'blue', icon: CheckCircle2 },
  Acknowledged: { tone: 'green', icon: FileCheck2 },
  Allocated: { tone: 'green', icon: ShieldCheck },
  'Partially distributed': { tone: 'green', icon: Truck },
  'Fully distributed': { tone: 'green', icon: PackageCheck },
  Closed: { tone: 'slate', icon: Lock },
  Rejected: { tone: 'red', icon: XCircle },
  Voided: { tone: 'red', icon: Ban },
  Cancelled: { tone: 'slate', icon: Ban },
};
export const statusMeta = (s) => STATUS_META[s] || { tone: 'slate', icon: CircleDot };

export const SOURCE_LABEL = { portal: 'Portal', walk_in: 'Walk-in', staff: 'Staff recorded' };
export const SOURCE_TONE = { portal: 'blue', walk_in: 'green', staff: 'slate' };

/** One allocation line as text: "Food ₱500.00" or "Food: kitchen stock" or "Other: squishy". */
export function allocationText(l, money) {
  const use = l.program === 'Other' ? String(l.intended_use || '').replace(/^Other: /, '') : l.intended_use;
  return `${l.program}${l.amount !== null && l.amount !== undefined ? ` ${money(l.amount)}` : ''}${use && (l.amount === null || l.amount === undefined || l.program === 'Other') ? `: ${use}` : ''}`;
}

/** "In-kind", "Cash", or "Cash · E-wallet (GCash)" (never "Cash · Cash"). */
export function typeMethod(d) {
  if (d.in_kind) return 'In-kind';
  return !d.method_label || d.method_label === 'Cash' ? 'Cash' : `Cash · ${d.method_label}`;
}

/** In-kind total for a card: never "₱0.00". "None" when there are no in-kind gifts, "Value not set" when none has a value. */
export function inKindTotal(count, value, money) {
  if (!Number(count)) return 'None';
  return Number(value) > 0 ? money(value) : 'Value not set';
}
