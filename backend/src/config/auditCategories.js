/**
 * Audit log (Admin > Activity log): categories, events, record types and friendly labels.
 *
 * The log reads three tables without copying them: tbl_activity_logs (codes like
 * "VIEW_ADOPTION_APPLICATION (computer, ...)"), tbl_health_data_access_logs (shown as HEALTH_<event>)
 * and tbl_unlock_events (shown as UNLOCK_<EVENT>). Entries are never edited: the category is worked
 * out from the event code with the rules below, in order; anything unmatched falls into DEFAULT.
 * Codes are matched by prefix and must contain only A-Z, 0-9 and "_".
 */
const CATEGORIES = [
  { key: 'sensitive', label: 'Sensitive record access' },
  { key: 'accounts', label: 'Sign-in and accounts' },
  { key: 'changes', label: 'Data changes' },
  { key: 'donations', label: 'Donations and payments' },
  { key: 'inventory', label: 'Inventory' },
  { key: 'settings', label: 'Settings' },
];
const DEFAULT_CATEGORY = 'changes';

/** Activity-log code prefixes per category (first match wins; health and unlock entries are always "sensitive"). */
const RULES = [
  ['sensitive', ['VIEW_ADOPTION_APPLICATION', 'VIEW_ADOPTION_DOCUMENT', 'DOWNLOAD_ADOPTION_DOCUMENT', 'VERIFY_ADOPTION_DOCUMENT', 'VIEW_HEALTH_RECORD',
    'VIEW_CHILD_ADOPTION_LEGAL', 'VIEW_CHILD_ADOPTION_HISTORY', 'VIEW_TRANSITION_REVIEW', 'VIEW_INFORMATION_RELEASES', 'VIEW_PAYMENT_PROOF', 'ADOPTION_INTERNAL_NOTE',
    'ADOPTION_DOCUMENTS_REQUESTED', 'DOCUMENT_REVIEWED', 'ID_VERIFICATION', 'CLEARANCE_VERIFICATION', 'ID_DETAILS_CORRECTED', 'CLEARANCE_DETAILS_CORRECTED', 'CAPTURE_ATTEMPT', 'VIEW_DONATIONS', 'VIEW_BANK_TRANSFERS', 'PROTECTED_', 'OPEN_SEALED_RECORD', 'QR_PRINTED', 'ADOPTION_ASSIGNED', 'ADOPTION_REASSIGNED', 'ADOPTION_UNASSIGNED',
    'TRANSITION_ASSIGNED', 'TRANSITION_REASSIGNED', 'TRANSITION_UNASSIGNED', 'CHILD_CASE_WORKER', 'ADOPTION_QR_LINK', 'TRANSITION_QR_LINK',
    'DOCUMENT_MARKED_PROTECTED', 'VIEW_RECORD_ACCESS', 'INFORMATION_RELEASED', 'EXPORT_SENSITIVE', 'CONFIDENTIALITY_UNDERTAKING', 'UPLOAD_ADOPTION_DOCUMENT', 'REMOVE_ADOPTION_DOCUMENT']],
  ['accounts', ['LOGIN', 'LOGOUT', 'MFA_', 'REGISTER_DONOR', 'CREATE_USER', 'UPDATE_USER', 'DEACTIVATE_USER', 'REACTIVATE_USER', 'CHANGE_PASSWORD', 'UPDATE_DUTIES', 'ACCESS_DENIED_DUTY']],
  ['donations', ['CREATE_DONATION', 'UPDATE_DONATION', 'DELETE_DONATION', 'UNLINK_DONATION', 'CONFIRM_DONATION', 'CANCEL_DONATION', 'DONATION_',
    'DOWNLOAD_RECEIPT', 'VERIFY_RECEIPT', 'BANK_TRANSFER_', 'PAYMENT_']],
  ['inventory', ['INVENTORY_', 'CREATE_INVENTORY', 'UPDATE_INVENTORY', 'DELETE_INVENTORY']],
  ['settings', ['UPDATE_SETTINGS', 'UPDATE_PAYMENT_METHOD', 'NOTIFICATION_CLEANUP', 'UNDERTAKING_TEXT_CHANGED']],
];

/** Event dropdown: friendly names, each covering code prefixes. Narrowed by the selected category. */
const EVENTS = [
  { key: 'unlock_started', category: 'sensitive', label: 'Unlocked sensitive sections', codes: ['UNLOCK_SESSION_STARTED', 'UNLOCK_VERIFY_SUCCESS'] },
  { key: 'unlock_failed', category: 'sensitive', label: 'Wrong or expired token, lockout', codes: ['UNLOCK_VERIFY_FAILED', 'UNLOCK_LOCKOUT', 'UNLOCK_REQUEST_DENIED'] },
  { key: 'purpose_qr', category: 'sensitive', label: 'Purpose stated and QR token generated', codes: ['UNLOCK_PURPOSE_CHOSEN', 'UNLOCK_QR_GENERATED', 'UNLOCK_PHONE_OPENED'] },
  { key: 'access_ended', category: 'sensitive', label: 'Access ended', codes: ['UNLOCK_SESSION_LOCKED', 'UNLOCK_SESSION_EXPIRED', 'UNLOCK_SESSION_REVOKED', 'UNLOCK_SESSION_SIGNED_OUT', 'UNLOCK_TOKEN_REPLACED', 'HEALTH_TOKEN_EXPIRED', 'HEALTH_TOKEN_REVOKED'] },
  { key: 'viewed_record', category: 'sensitive', label: 'Viewed a protected record', codes: ['VIEW_ADOPTION_APPLICATION', 'VIEW_TRANSITION_REVIEW', 'VIEW_CHILD_ADOPTION_LEGAL', 'VIEW_CHILD_ADOPTION_HISTORY', 'VIEW_HEALTH_RECORD', 'UNLOCK_VIEW_SECTIONS', 'HEALTH_VIEW', 'OPEN_SEALED_RECORD', 'VIEW_INFORMATION_RELEASES'] },
  { key: 'documents', category: 'sensitive', label: 'Viewed or downloaded a document', codes: ['VIEW_ADOPTION_DOCUMENT', 'DOWNLOAD_ADOPTION_DOCUMENT', 'UNLOCK_VIEW_DOCUMENT', 'UNLOCK_DOWNLOAD_DOCUMENT', 'VIEW_PAYMENT_PROOF', 'PROTECTED_RECORD_', 'VERIFY_ADOPTION_DOCUMENT'] },
  { key: 'notes_requests', category: 'sensitive', label: 'Internal notes, document requests and document reviews', codes: ['ADOPTION_INTERNAL_NOTE', 'ADOPTION_DOCUMENTS_REQUESTED', 'DOCUMENT_REVIEWED'] },
  { key: 'capture', category: 'sensitive', label: 'Screenshot, print or copy attempts', codes: ['CAPTURE_ATTEMPT'] },
  { key: 'id_clearance', category: 'sensitive', label: 'ID and clearance verification', codes: ['ID_VERIFICATION', 'CLEARANCE_VERIFICATION', 'ID_DETAILS_CORRECTED', 'CLEARANCE_DETAILS_CORRECTED'] },
  { key: 'tokens', category: 'sensitive', label: 'Health and protected-record tokens', codes: ['HEALTH_TOKEN_', 'PROTECTED_TOKEN_'] },
  { key: 'assignments', category: 'sensitive', label: 'Assigned staff changed', codes: ['ADOPTION_ASSIGNED', 'ADOPTION_REASSIGNED', 'ADOPTION_UNASSIGNED', 'TRANSITION_ASSIGNED', 'TRANSITION_REASSIGNED', 'TRANSITION_UNASSIGNED', 'CHILD_CASE_WORKER', 'UNLOCK_ASSIGNED'] },
  { key: 'undertaking', category: 'sensitive', label: 'Confidentiality undertaking accepted or declined', codes: ['CONFIDENTIALITY_UNDERTAKING'] },
  { key: 'copy_print', category: 'sensitive', label: 'Copy, print and QR prints', codes: ['UNLOCK_COPY', 'UNLOCK_PRINT', 'QR_PRINTED', 'UNLOCK_WARNING_SHOWN'] },
  { key: 'signin', category: 'accounts', label: 'Sign-ins and sign-outs', codes: ['LOGIN', 'LOGOUT'] },
  { key: 'mfa', category: 'accounts', label: 'Two-step verification', codes: ['MFA_'] },
  { key: 'accounts', category: 'accounts', label: 'Accounts created, changed, deactivated or reactivated', codes: ['CREATE_USER', 'UPDATE_USER', 'DEACTIVATE_USER', 'REACTIVATE_USER', 'REGISTER_DONOR', 'UPDATE_DUTIES'] },
  { key: 'password', category: 'accounts', label: 'Password changed', codes: ['CHANGE_PASSWORD'] },
  { key: 'children', category: 'changes', label: 'Child records', codes: ['REGISTER_CHILD', 'UPDATE_CHILD', 'DELETE_CHILD', 'DISCHARGE_CHILD', 'STATUS_', 'CHILD_', 'REMOVE_CHILD_PHOTO', 'UPDATE_HEALTH_RECORD', 'UPDATE_CASE_FILES'] },
  { key: 'adoption_status', category: 'changes', label: 'Adoption status changes', codes: ['ADOPTION_STATUS', 'ADOPTION_SUBMITTED', 'ADOPTION_WITHDRAWN', 'ADOPTION_FINALIZED', 'ADOPTION_CHILD_MATCHED', 'ADOPTION_HOME_STUDY', 'ADOPTION_AUTO_CLOSED', 'ADOPTION_ARCHIVED', 'ADOPTION_DRAFT', 'ADOPTION_DOCUMENT_REQUEST_CLOSED'] },
  { key: 'transition', category: 'changes', label: 'Transition reviews', codes: ['TRANSITION_', 'UPDATE_TRANSITION_REVIEW', 'VIEW_TRANSITION_REVIEWS'] },
  { key: 'schedules', category: 'changes', label: 'Staff schedules', codes: ['CREATE_SHIFT', 'UPDATE_SHIFT', 'DELETE_SHIFT', 'SCHEDULE_', 'MAP_SCHEDULE_AREA', 'CREATE_SCHEDULE_AREA', 'UPDATE_SCHEDULE_AREA'] },
  { key: 'meals_visitors', category: 'changes', label: 'Meals and visitors', codes: ['CREATE_MEAL', 'UPDATE_MEAL', 'DELETE_MEAL', 'VISITOR_', 'UPDATE_VISITOR', 'DELETE_VISITOR'] },
  { key: 'privacy', category: 'changes', label: 'Privacy requests and incidents', codes: ['DATA_SUBJECT_REQUEST', 'SECURITY_INCIDENT'] },
  { key: 'exports', category: 'changes', label: 'Exports and reports', codes: ['EXPORT_', 'GENERATE_COMPLIANCE'] },
  { key: 'donations', category: 'donations', label: 'Donations recorded or changed', codes: ['CREATE_DONATION', 'UPDATE_DONATION', 'DELETE_DONATION', 'UNLINK_DONATION', 'CONFIRM_DONATION', 'CANCEL_DONATION', 'DONATION_'] },
  { key: 'payments', category: 'donations', label: 'Payments and bank-transfer verifications', codes: ['PAYMENT_', 'BANK_TRANSFER_'] },
  { key: 'receipts', category: 'donations', label: 'Receipts', codes: ['DOWNLOAD_RECEIPT', 'VERIFY_RECEIPT'] },
  { key: 'stock', category: 'inventory', label: 'Stock changes', codes: ['INVENTORY_'] },
  { key: 'items', category: 'inventory', label: 'Items added, edited or removed', codes: ['CREATE_INVENTORY', 'UPDATE_INVENTORY', 'DELETE_INVENTORY'] },
  { key: 'settings', category: 'settings', label: 'Settings, payment methods and the undertaking text', codes: ['UPDATE_SETTINGS', 'UPDATE_PAYMENT_METHOD', 'NOTIFICATION_CLEANUP', 'UNDERTAKING_TEXT_CHANGED'] },
];

const RECORD_TYPES = [
  { key: 'child', label: 'Child' }, { key: 'health', label: 'Health record' }, { key: 'adoption', label: 'Adoption application' },
  { key: 'transition', label: 'Transition review' }, { key: 'donation', label: 'Donation' }, { key: 'inventory', label: 'Inventory item' },
  { key: 'user', label: 'User account' }, { key: 'schedule', label: 'Staff schedule' },
];

/** "How it ended" (Sensitive record access only): codes for each outcome. */
const ENDED = [
  { key: 'locked', label: 'Locked by user', codes: ['UNLOCK_SESSION_LOCKED', 'HEALTH_TOKEN_REVOKED'] },
  { key: 'expired', label: 'Expired', codes: ['UNLOCK_SESSION_EXPIRED', 'HEALTH_TOKEN_EXPIRED'] },
  { key: 'revoked', label: 'Revoked by Admin', codes: ['UNLOCK_SESSION_REVOKED', 'PROTECTED_TOKEN_REVOKED'] },
  { key: 'replaced', label: 'Replaced by a new token', codes: ['UNLOCK_TOKEN_REPLACED'] },
  { key: 'auto', label: 'Revoked automatically', codes: ['UNLOCK_SESSION_SIGNED_OUT', 'PROTECTED_TOKEN_LOCKED'] },
  { key: 'unknown', label: 'Unknown', codes: ['UNLOCK_SESSION_ENDED'] },
];

for (const list of [...RULES.map(([, c]) => c), ...EVENTS.map((e) => e.codes), ...ENDED.map((e) => e.codes)]) {
  for (const c of list) if (!/^[A-Z0-9_]+$/.test(c)) throw new Error(`auditCategories: invalid code prefix ${c}`);
}

// ---------------------------------------------------------------- friendly labels

const UNLOCK_LABELS = {
  PURPOSE_CHOSEN: 'Stated a purpose', QR_GENERATED: 'Generated a QR token', PHONE_OPENED: 'Opened the token on a phone',
  VERIFY_SUCCESS: 'Verified a token', VERIFY_FAILED: 'Entered a wrong or expired token', LOCKOUT: 'Locked out after wrong tokens',
  SESSION_STARTED: 'Unlocked sensitive sections', SESSION_LOCKED: 'Locked the record (Lock now)', SESSION_EXPIRED: 'Access expired',
  SESSION_REVOKED: 'Access revoked by Admin', SESSION_SIGNED_OUT: 'Access ended at sign-out', TOKEN_REPLACED: 'Token replaced by a new one',
  VIEW_SECTIONS: 'Viewed sensitive sections', VIEW_DOCUMENT: 'Viewed a document', DOWNLOAD_DOCUMENT: 'Downloaded a document',
  COPY: 'Copied text from a record', PRINT: 'Printed a record', WARNING_SHOWN: 'Shown the 30-second warning', REQUEST_DENIED: 'Unlock refused: not assigned',
  ASSIGNED: 'Changed assigned staff', EDIT_SAVED: 'Saved changes to a record',
};
const HEALTH_LABELS = {
  TOKEN_ISSUED: 'Opened health records', VIEW: 'Viewed health record', UPDATE: 'Updated health record', TOKEN_DENIED: 'Health access refused',
  TOKEN_EXPIRED: 'Health access expired', TOKEN_REVOKED: 'Health records locked',
};
/** Activity codes: [base code, label or (inside-the-brackets) => label]. */
const ACTIVITY_LABELS = [
  ['ACCESS_DENIED_DUTY', (p) => `Access denied: no ${p || 'duty'} duty`],
  ['VIEW_DONATIONS', 'Viewed the donations list'], ['VIEW_BANK_TRANSFERS', 'Viewed the bank transfer queue'],
  ['UPDATE_DUTIES', (p) => { const m = /^(.+?) -> (.+)$/.exec(p); return m ? `Changed staff duties: ${m[1]} to ${m[2]}` : 'Changed staff duties'; }],
  ['VIEW_ADOPTION_APPLICATION', (p) => `Viewed application (sensitive sections ${/included/.test(p) ? 'included' : /locked/.test(p) ? 'locked' : 'not recorded'})`],
  ['ADOPTION_INTERNAL_NOTE', 'Added an internal note'],
  ['ADOPTION_DOCUMENTS_REQUESTED', 'Requested documents'],
  ['ID_VERIFICATION', (p) => { const m = /: (.+?) -> (.+)$/.exec(p); return m ? `Reviewed the government ID: ${m[1]} to ${m[2]}` : 'Reviewed the government ID'; }],
  ['CLEARANCE_VERIFICATION', (p) => { const m = /: (.+?) -> (.+)$/.exec(p); return m ? `Reviewed a clearance: ${m[1]} to ${m[2]}` : 'Reviewed a clearance'; }],
  ['CAPTURE_ATTEMPT', (p) => { const m = /^(\w+), (.+)$/.exec(p); const k = { print_screen: 'Print Screen', capture_shortcut: 'screenshot shortcut', print: 'print', save_page: 'save page', copy: 'copy', cut: 'cut', right_click: 'right-click', drag: 'drag' }; return m ? `Capture attempt blocked (${k[m[1]] || m[1]}) on ${m[2]}` : 'Capture attempt blocked'; }],
  ['ID_DETAILS_CORRECTED', 'Applicant corrected the ID details'], ['CLEARANCE_DETAILS_CORRECTED', 'Applicant corrected a clearance'],
  ['DOCUMENT_REVIEWED', (p) => { const m = /^([a-z_]+): (.+?) -> (.+)$/.exec(p); return m ? `Reviewed a document: ${m[2]} to ${m[3]}` : 'Reviewed a document'; }],
  ['ADOPTION_STATUS', (p) => { const m = /(.+?) -> (.+)/.exec(p); return m ? `Changed status: ${m[1]} to ${m[2]}` : 'Changed status'; }],
  ['ADOPTION_SUBMITTED', 'Submitted an application'], ['ADOPTION_WITHDRAWN', 'Withdrew an application'], ['ADOPTION_DRAFT_CREATED', 'Started an application'],
  ['ADOPTION_FINALIZED', 'Finalized an adoption'], ['ADOPTION_CHILD_MATCHED', 'Matched a child'], ['ADOPTION_HOME_STUDY_SCHEDULED', 'Scheduled a home study'],
  ['ADOPTION_ARCHIVED', 'Archived an application'], ['ADOPTION_AUTO_CLOSED', 'Closed automatically'], ['ADOPTION_DOCUMENT_REQUEST_CLOSED', 'Closed a document request'],
  ['ADOPTION_ASSIGNED', 'Assigned staff'], ['ADOPTION_REASSIGNED', 'Reassigned staff'], ['ADOPTION_UNASSIGNED', 'Removed assigned staff'],
  ['TRANSITION_ASSIGNED', 'Assigned staff'], ['TRANSITION_REASSIGNED', 'Reassigned staff'], ['TRANSITION_UNASSIGNED', 'Removed assigned staff'],
  ['CHILD_CASE_WORKER_ASSIGNED', 'Set the case worker'], ['CHILD_CASE_WORKER_REASSIGNED', 'Changed the case worker'], ['CHILD_CASE_WORKER_UNASSIGNED', 'Removed the case worker'],
  ['VIEW_ADOPTION_DOCUMENT', 'Viewed a document'], ['DOWNLOAD_ADOPTION_DOCUMENT_DENIED', 'Download refused (not allowed for Staff)'], ['DOWNLOAD_ADOPTION_DOCUMENT', 'Downloaded a document'], ['UPLOAD_ADOPTION_DOCUMENT', 'Uploaded a document'],
  ['REMOVE_ADOPTION_DOCUMENT', 'Removed a document'], ['VERIFY_ADOPTION_DOCUMENT', 'Checked a document\'s integrity'], ['DOCUMENT_MARKED_PROTECTED', 'Marked a document protected'],
  ['VIEW_HEALTH_RECORD', 'Viewed health record'], ['UPDATE_HEALTH_RECORD', 'Updated health record'], ['UPDATE_CASE_FILES', 'Updated case files'],
  ['VIEW_CHILD_ADOPTION_LEGAL', 'Viewed adoption legal records'], ['VIEW_CHILD_ADOPTION_HISTORY', 'Viewed a child\'s adoption history'], ['VIEW_TRANSITION_REVIEWS', 'Viewed the transition review list'], ['VIEW_TRANSITION_REVIEW', 'Viewed a transition review'],
  ['UPDATE_TRANSITION_REVIEW', 'Updated a transition review'], ['VIEW_PAYMENT_PROOF', 'Viewed a proof of transfer'], ['VIEW_INFORMATION_RELEASES', 'Viewed information releases'],
  ['INFORMATION_RELEASED', 'Released information'], ['OPEN_SEALED_RECORD', 'Opened a sealed record'], ['QR_PRINTED', 'Printed a QR label'],
  ['PROTECTED_TOKEN_ISSUED', 'Issued a protected-record token'], ['PROTECTED_TOKEN_USED', 'Used a protected-record token'], ['PROTECTED_TOKEN_REVOKED', 'Revoked a protected-record token'],
  ['PROTECTED_TOKEN_LOCKED', 'Protected-record token locked after wrong tries'], ['PROTECTED_RECORD_VIEW', 'Viewed a protected record'], ['PROTECTED_RECORD_DOWNLOAD', 'Downloaded a protected record'],
  ['CONFIDENTIALITY_UNDERTAKING_ACCEPTED', (p) => { const area = /^(Adoption|Transition Review)/.exec(p)?.[1]; const v = /CU(?:-TR)?-\d{4}-\d+/.exec(p)?.[0];
    return `Accepted the confidentiality undertaking${area || v ? ` (${[area, v].filter(Boolean).join(', ')})` : ''}`; }],
  ['CONFIDENTIALITY_UNDERTAKING_DECLINED', (p) => { const area = /^(Adoption|Transition Review)/.exec(p)?.[1]; return `Declined the confidentiality undertaking${area ? ` (${area})` : ''}`; }],
  ['UNDERTAKING_TEXT_CHANGED', (p) => { const m = /(?:(\w+): )?(.+?) -> (.+)/.exec(p); return m ? `Changed the undertaking text${m[1] ? ` (${m[1]})` : ''}: ${m[2]} to ${m[3]}` : 'Changed the undertaking text'; }], ['EXPORT_SENSITIVE_ACCESS_LOG', 'Exported the sensitive access log'],
  ['LOGIN_PASSWORD_OK_MFA_PENDING', 'Signed in (waiting for two-step code)'], ['LOGIN', 'Signed in'], ['LOGOUT', 'Signed out'],
  ['MFA_FAILED', 'Two-step code failed'], ['MFA_ENROLLED', 'Set up two-step verification'], ['MFA_RESET', 'Reset two-step verification'],
  ['MFA_CLEARED', 'Two-step verification cleared'], ['MFA_BACKUP_CODE_USED', 'Used a two-step backup code'],
  ['REGISTER_DONOR', 'Created a donor account'], ['CREATE_USER', (p) => `Created a${p ? ` ${p}` : 'n'} account`], ['UPDATE_USER', 'Edited a user account'],
  ['DEACTIVATE_USER', 'Deactivated an account'], ['REACTIVATE_USER', 'Reactivated an account'], ['CHANGE_PASSWORD', 'Changed password'],
  ['REGISTER_CHILD', 'Registered a child'], ['UPDATE_CHILD_PHOTO', 'Changed a child\'s photo'], ['REMOVE_CHILD_PHOTO', 'Removed a child\'s photo'], ['UPDATE_CHILD', 'Edited a child record'],
  ['DELETE_CHILD', 'Deleted a child record'], ['DISCHARGE_CHILD', 'Discharged a child'], ['CHILD_ADOPTED', 'Marked a child adopted'],
  ['CREATE_SHIFT', 'Added a shift'], ['UPDATE_SHIFT', 'Changed a shift'], ['DELETE_SHIFT', 'Removed a shift'],
  ['SCHEDULE_BULK_CREATE', 'Added shifts in bulk'], ['SCHEDULE_BULK_COPY_DAY', 'Copied a day of shifts'], ['SCHEDULE_BULK_COPY_WEEK', 'Copied a week of shifts'],
  ['SCHEDULE_BULK_UNDO', 'Undid a bulk schedule change'], ['CREATE_SCHEDULE_AREA', 'Added a schedule area'], ['UPDATE_SCHEDULE_AREA', 'Changed a schedule area'],
  ['MAP_SCHEDULE_AREA', 'Mapped old shift areas to the list'], ['VIEW_RECORD_ACCESS', 'Viewed the record access overview'],
  ['CREATE_MEAL', 'Added a meal'], ['UPDATE_MEAL', 'Edited a meal'], ['DELETE_MEAL', 'Deleted a meal'],
  ['VISITOR_CHECK_IN', 'Checked in a visitor'], ['VISITOR_CHECK_OUT', 'Checked out a visitor'], ['UPDATE_VISITOR', 'Edited a visit'], ['DELETE_VISITOR', 'Deleted a visit'],
  ['CREATE_DONATION', 'Recorded a donation'], ['UPDATE_DONATION', 'Edited a donation'], ['DELETE_DONATION', 'Deleted a donation'], ['UNLINK_DONATION', 'Unlinked a donation from a visit'],
  ['CONFIRM_DONATION_RECEIVED', 'Marked a donation received'], ['CANCEL_DONATION', 'Cancelled a donation'], ['DONATION_PAID_ONLINE', 'Donation paid online'],
  ['DOWNLOAD_RECEIPT', 'Downloaded a receipt'], ['VERIFY_RECEIPT_FAILED', 'Receipt check failed'], ['VERIFY_RECEIPT', 'Checked a receipt'],
  ['BANK_TRANSFER_SUBMITTED', 'Submitted a bank transfer'], ['BANK_TRANSFER_CONFIRMED', 'Confirmed a bank transfer'], ['BANK_TRANSFER_REJECTED', 'Rejected a bank transfer'],
  ['PAYMENT_CHECKOUT_STARTED', 'Started an online payment'],
  ['INVENTORY_DONATION_IN', 'Stock added from a donation'], ['INVENTORY_DONATION_REVERSAL', 'Stock removed (donation reversed)'],
  ['CREATE_INVENTORY_ITEM', 'Added an inventory item'], ['UPDATE_INVENTORY_ITEM', (p) => (p ? `Edited an inventory item (${p.replace(/qty /, 'quantity ').replace('->', 'to')})` : 'Edited an inventory item')],
  ['DELETE_INVENTORY_ITEM', 'Deleted an inventory item'],
  ['UPDATE_SETTINGS', 'Changed settings'], ['UPDATE_PAYMENT_METHOD', 'Changed a payment method'], ['NOTIFICATION_CLEANUP', 'Cleaned up old notifications'],
  ['DATA_SUBJECT_REQUEST', 'Privacy request'], ['SECURITY_INCIDENT_LOGGED', 'Logged a security incident'], ['SECURITY_INCIDENT_UPDATED', 'Updated a security incident'],
  ['EXPORT_AUDIT_LOG', 'Exported the audit log'], ['GENERATE_COMPLIANCE_REPORT', 'Generated a compliance report'],
];

const humanize = (code) => {
  const s = code.toLowerCase().replace(/_/g, ' ').trim();
  return s.charAt(0).toUpperCase() + s.slice(1);
};

/** Friendly action label for an entry: { src, code } -> text. Raw codes stay in the tooltip and export. */
function friendlyLabel(src, code) {
  const raw = String(code || '');
  if (src === 'unlock') return UNLOCK_LABELS[raw.replace(/^UNLOCK_/, '')] || humanize(raw.replace(/^UNLOCK_/, ''));
  if (src === 'health') return HEALTH_LABELS[raw.replace(/^HEALTH_/, '')] || humanize(raw.replace(/^HEALTH_/, ''));
  const m = /^([A-Z0-9_]+)(?:\s*\((.*)\))?/.exec(raw);
  const base = m?.[1] || raw;
  const inner = m?.[2] || '';
  const hit = ACTIVITY_LABELS.find(([c]) => base === c || base.startsWith(`${c}_`) || base.startsWith(c));
  if (!hit) return humanize(base);
  return typeof hit[1] === 'function' ? hit[1](inner) : hit[1];
}

module.exports = { CATEGORIES, DEFAULT_CATEGORY, RULES, EVENTS, RECORD_TYPES, ENDED, friendlyLabel };
