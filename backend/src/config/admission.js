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
const STATUSES = ['Draft', 'Pending Approval', 'Needs Correction', 'Admitted', 'Declined'];
/** The creator (and Admin) may change the admission only in these. */
const EDITABLE = ['Draft', 'Needs Correction'];
/** Still an admission (not decided): the creator keeps their temporary admission access. */
const OPEN = ['Draft', 'Pending Approval', 'Needs Correction'];
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
 */
const CHECKLIST = [
  { key: 'referral_letter', label: 'Referral letter or endorsement' },
  { key: 'social_case_study', label: 'Social Case Study Report (SCSR)' },
  { key: 'birth_certificate', label: 'Birth certificate (PSA) or foundling certificate' },
  { key: 'medical_certificate', label: 'Medical certificate or health assessment', level: 'sensitive' },
  { key: 'police_report', label: 'Police or barangay report (found, abandoned or rescued child)' },
  { key: 'court_order', label: 'Court order or commitment papers' },
  { key: 'parent_consent', label: 'Deed of voluntary commitment or consent of parent/guardian' },
  { key: 'school_records', label: 'School records' },
  { key: 'other', label: 'Other documents' },
];
const CHECK_STATUSES = ['Received', 'To follow', 'Not applicable'];
const FILE_TYPES = ['pdf', 'jpg', 'png'];
const FILE_MAX_MB = 10;

const MESSAGES = {
  submitted: 'Admission submitted successfully. Waiting for Admin approval.',
  approved: 'Admission approved. Child is now Admitted.',
  returned: 'Admission returned for correction. The staff member who created it was notified.',
  declined: 'Admission declined. The record is kept.',
  saved: 'Progress saved.',
  created: 'Admission started. Your progress is saved; continue with the next step.',
};

module.exports = {
  STATUSES, EDITABLE, OPEN, CHILD_STATUS, STEPS, REFERRAL_SOURCES, RELATIONSHIPS, GUARDIAN_STATUS, MAX_GUARDIANS,
  CHECKLIST, CHECK_STATUSES, FILE_TYPES, FILE_MAX_MB, MESSAGES,
};
