/**
 * Child admission workflow (migration 033). Wording and lists live here; the rules are in services/admission.js.
 *
 *   Staff with the Admission duty (or Admin) -> New Admission -> Step 1 Basic information -> Step 2 Referral details
 *   -> Step 3 Parent/guardian and family -> Step 4 Documents / admission checklist -> Submit for Admin Approval
 *   -> Admin review -> Approve (Admitted) | Return for Correction (Needs Correction) | Decline (Declined)
 *
 * "Creating a child record does not mean owning the child record": the Admission duty decides who can create
 * an admission, the assignment decides who keeps working on the child, and Admin approval decides whether the
 * child is officially admitted.
 */
/**
 * Lifecycle (migration 036):  Referral Received -> Intake and Assessment -> Pending Approval -> Admitted
 * Other outcomes: Declined (Admin decision), Not Admitted (withdrawn before a decision). 'Draft' is kept for
 * admissions started before 036 and is shown as Referral Received or Intake and Assessment.
 */
const STATUSES = ['Draft', 'Referral Received', 'Intake and Assessment', 'Pending Approval', 'Needs Correction', 'Admitted', 'Declined', 'Not Admitted'];
/** The creator (and Admin) may change the admission only in these. */
const EDITABLE = ['Draft', 'Referral Received', 'Intake and Assessment', 'Needs Correction'];
/** Still an admission (not decided): the creator keeps their temporary admission access. */
const OPEN = [...EDITABLE, 'Pending Approval'];
/** Closed without admission: kept, read-only, not in the Children list. */
const CLOSED = ['Declined', 'Not Admitted'];
/** How each stored status is shown. */
const LABELS = { 'Pending Approval': 'Pending Admin Approval', 'Needs Correction': 'Returned for correction' };
/** The stage shown for a row (legacy Draft: from how far it got). */
function stageOf(status, hasReferral) {
  if (status === 'Draft') return hasReferral ? 'Intake and Assessment' : 'Referral Received';
  return status;
}
const label = (status) => LABELS[status] || status;
/** tbl_children.status while the child is not admitted yet. */
const CHILD_STATUS = 'In admission';

const STEPS = [
  { n: 1, key: 'basic', title: 'Basic information' },
  { n: 2, key: 'referral', title: 'Referral details' },
  { n: 3, key: 'family', title: 'Parent/guardian and family' },
  { n: 4, key: 'documents', title: 'Documents / admission checklist' },
];

const REFERRAL_SOURCES = [
  'DSWD', 'Local social welfare office (LSWDO / MSWDO / CSWDO)', 'Police (PNP / WCPD)', 'Hospital', 'Court', 'Barangay',
  'Another child-caring agency', 'Parent or relative (voluntary)', 'Found or walk-in', 'Other',
];
const RELATIONSHIPS = ['Mother', 'Father', 'Grandparent', 'Aunt or uncle', 'Older sibling', 'Legal guardian', 'Other relative', 'Other'];
const GUARDIAN_STATUS = ['Living', 'Deceased', 'Whereabouts unknown'];
const MAX_GUARDIANS = 6;

/**
 * Documents checklist. Each item is marked Received, To follow or Not applicable before submitting; a copy can be
 * uploaded (encrypted). `level: 'sensitive'` copies (medical) open only for Admin or the assigned case worker
 * through the unlock step, never for the creator.
 *
 * `required: true` items can't be "To follow" when the admission is submitted or approved: they must be Received,
 * or Not applicable with a reason in the note. The server checks this on submit and again on approval.
 */
const CHECKLIST = [
  { key: 'referral_letter', label: 'Referral letter or endorsement', required: true },
  { key: 'social_case_study', label: 'Social Case Study Report (SCSR)' },
  { key: 'birth_certificate', label: 'Birth certificate (PSA) or foundling certificate', required: true },
  { key: 'medical_certificate', label: 'Medical certificate or health assessment', level: 'sensitive' },
  { key: 'police_report', label: 'Police or barangay report (found, abandoned or rescued child)', condition: 'When the child was found, abandoned or rescued' },
  { key: 'court_order', label: 'Court order or commitment papers', condition: 'When a court committed or referred the child' },
  { key: 'parent_consent', label: 'Deed of voluntary commitment or consent of parent/guardian', condition: 'When a parent or guardian commits the child voluntarily' },
  { key: 'school_records', label: 'School records' },
  { key: 'other', label: 'Other documents' },
];
/**
 * Which items are Required is a setting (admission_required_documents, Settings > Child record access); the
 * `required: true` flags above are its default. Conditional items name the case they apply to (not enforced: the
 * reviewing Admin judges them). Everything else is Optional.
 */
const DEFAULT_REQUIRED = CHECKLIST.filter((c) => c.required).map((c) => c.key);
function requirementOf(item, requiredKeys) {
  if (requiredKeys.includes(item.key)) return 'Required';
  return item.condition ? 'Conditional' : 'Optional';
}
const CHECK_STATUSES = ['Received', 'To follow', 'Not applicable'];
/** The reviewing Admin's verification of an item. */
const VERIFY_RESULTS = ['Verified', 'Rejected', 'Requires correction'];
/** What a checklist item shows: Pending, Submitted, Verified, Rejected, Requires Correction or Not Applicable. */
function docStatusOf(mark) {
  if (!mark?.status) return 'Not marked';
  if (mark.verification_status === 'Rejected') return 'Rejected';
  if (mark.verification_status === 'Requires correction') return 'Requires Correction';
  if (mark.status === 'To follow') return 'Pending';
  if (mark.verification_status === 'Verified') return mark.status === 'Not applicable' ? 'Not Applicable (verified)' : 'Verified';
  return mark.status === 'Not applicable' ? 'Not Applicable' : 'Submitted';
}
const FILE_TYPES = ['pdf', 'jpg', 'png'];
const FILE_MAX_MB = 10;

const MESSAGES = {
  submitted: 'Admission submitted successfully. Waiting for Admin approval.',
  approved: 'Admission approved. Child is now Admitted.',
  withdrawn: 'Admission withdrawn. It is kept as Not Admitted.',
  returned: 'Admission returned for correction. The staff member who created it was notified.',
  declined: 'Admission declined. The record is kept.',
  saved: 'Progress saved.',
  created: 'Admission started. Your progress is saved; continue with the next step.',
};

module.exports = {
  STATUSES, EDITABLE, OPEN, CLOSED, LABELS, stageOf, label, CHILD_STATUS, STEPS, REFERRAL_SOURCES, RELATIONSHIPS, GUARDIAN_STATUS, MAX_GUARDIANS,
  CHECKLIST, DEFAULT_REQUIRED, requirementOf, CHECK_STATUSES, VERIFY_RESULTS, docStatusOf, FILE_TYPES, FILE_MAX_MB, MESSAGES,
};
