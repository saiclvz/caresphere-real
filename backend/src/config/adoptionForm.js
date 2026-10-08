/**
 * The 9-page adoption application: one definition used by the server to validate and
 * sent to the browser (GET /api/adoptions/form-config) to build the form, so every rule
 * lives in one place.
 *
 * Conditions are plain data so the browser can use them too:
 *   when: { field: 'civil_status', in: ['Married'] }   -> shown (and required) only then
 * A hidden field or document is never required.
 */
const { NCR, PROVINCES, CITY_LISTS } = require('./phAddress');

const OTHER_CITY = '__other__';
const EMPLOYED = ['Employed', 'Self-employed', 'Overseas worker'];
const NOT_EARNING = ['Retired', 'Not employed'];

const OPTIONS = {
  civil_status: ['Single', 'Married', 'Widowed', 'Divorced', 'Separated'],
  employment_status: ['Employed', 'Self-employed', 'Overseas worker', 'Retired', 'Not employed'],
  income_source: ['Pension', 'Remittance', 'Savings', 'Spouse income'],
  housing: ['Owned', 'Rented', 'Living with relatives', 'Other'],
  id_type: ["Passport", "Driver's license", 'UMID', 'PhilSys National ID', 'Postal ID', "Voter's ID", 'PRC ID', 'Other'],
};

/**
 * Field types: text, email, phone, date, zip, select, textarea, province, city, household.
 * max = maximum length for text values.
 */
const FIELDS = {
  // ---- page 1: applicant information
  legal_name: { page: 1, label: 'Legal name', type: 'text', required: true, max: 150 },
  date_of_birth: { page: 1, label: 'Date of birth', type: 'date', required: true, minAge: 25 },
  contact_number: { page: 1, label: 'Contact number', type: 'phone', required: true, placeholder: '09XX XXX XXXX' },
  email: { page: 1, label: 'Email', type: 'email', required: true, max: 100 },
  house_unit: { page: 1, label: 'House / unit no. and building', type: 'text', required: true, max: 120, group: 'address' },
  street: { page: 1, label: 'Street', type: 'text', required: true, max: 120, group: 'address' },
  subdivision: { page: 1, label: 'Subdivision / village', type: 'text', required: false, max: 120, group: 'address' },
  barangay: { page: 1, label: 'Barangay', type: 'text', required: true, max: 120, group: 'address' },
  province: { page: 1, label: 'Province', type: 'province', required: true, group: 'address' },
  city: { page: 1, label: 'Municipality / city', type: 'city', required: true, max: 100, group: 'address' },
  postal_code: { page: 1, label: 'Postal (ZIP) code', type: 'zip', required: true, group: 'address' },
  civil_status: { page: 1, label: 'Civil status', type: 'select', required: true, options: OPTIONS.civil_status },
  employment_status: { page: 1, label: 'Employment status', type: 'select', required: true, options: OPTIONS.employment_status },
  occupation: { page: 1, label: 'Occupation', type: 'text', required: true, max: 150, when: { field: 'employment_status', in: EMPLOYED } },
  employer: { page: 1, label: 'Employer or business name', type: 'text', required: true, max: 150, when: { field: 'employment_status', in: EMPLOYED } },
  position: { page: 1, label: 'Position', type: 'text', required: true, max: 150, when: { field: 'employment_status', in: EMPLOYED } },
  employment_length: { page: 1, label: 'Length of employment', type: 'text', required: true, max: 60, placeholder: 'e.g. 3 years', when: { field: 'employment_status', in: EMPLOYED } },
  income_source: { page: 1, label: 'Source of income', type: 'select', required: true, options: OPTIONS.income_source, when: { field: 'employment_status', in: NOT_EARNING } },

  // ---- page 2: family and household
  // Shown to everyone ("if any"), required only for married applicants.
  spouse_details: { page: 2, label: 'Spouse / co-applicant details', type: 'textarea', required: false, max: 3000,
    requiredWhen: { field: 'civil_status', in: ['Married'] }, optionalLabel: 'Spouse / co-applicant details (if any)' },
  household_members: { page: 2, label: 'Household members', type: 'household', required: false, maxRows: 20 },
  housing: { page: 2, label: 'Housing', type: 'select', required: true, options: OPTIONS.housing },
  living_conditions: { page: 2, label: 'Living conditions', type: 'textarea', required: true, max: 3000 },
  caregiving_experience: { page: 2, label: 'Caregiving experience', type: 'textarea', required: true, max: 3000 },

  // ---- page 3: identity documents (the ID type; the files are in DOCUMENTS)
  id_type: { page: 3, label: 'Type of government-issued ID', type: 'select', required: true, options: OPTIONS.id_type },
  id_type_other: { page: 3, label: 'Type of ID', type: 'text', required: true, max: 100, when: { field: 'id_type', in: ['Other'] } },

  // ---- page 8: reason for adoption
  reason_for_adoption: { page: 8, label: 'Reason for adoption', type: 'textarea', required: true, max: 5000 },
};

/** Document types. multiple = more than one file allowed. Files: PDF, PNG or JPG, up to 10 MB each. */
const DOCUMENTS = {
  // page 3
  valid_id: { page: 3, label: 'Valid government-issued ID', required: true, multiple: false },
  birth_certificate: { page: 3, label: 'Birth certificate', required: true, multiple: true, hint: 'For every applicant.' },
  marriage_certificate: { page: 3, label: 'Marriage certificate', required: true, multiple: false, when: { field: 'civil_status', in: ['Married'] } },
  divorce_or_death_certificate: { page: 3, label: 'Divorce decree or death certificate', required: true, multiple: false,
    when: { field: 'civil_status', in: ['Widowed', 'Divorced', 'Separated'] } },
  family_photos: { page: 3, label: 'Family photographs', required: false, multiple: true },
  // page 4 (one set per adult in the household)
  nbi_police_clearance: { page: 4, label: 'NBI or police clearance', required: true, multiple: true },
  child_abuse_clearance: { page: 4, label: 'Child abuse clearance', required: true, multiple: true },
  fingerprint_clearance: { page: 4, label: 'Fingerprint clearance record', required: false, multiple: true },
  // page 5
  employment_verification: { page: 5, label: 'Employment verification letter', required: true, multiple: false,
    when: { field: 'employment_status', in: ['Employed', 'Overseas worker'] } },
  business_permit: { page: 5, label: 'Business registration or permit', required: true, multiple: false,
    when: { field: 'employment_status', in: ['Self-employed'] } },
  proof_of_income: { page: 5, label: 'Proof of income source', required: false, multiple: true, when: { field: 'employment_status', in: NOT_EARNING } },
  tax_returns: { page: 5, label: 'Tax returns (most recent 1 to 3 years)', required: false, multiple: true },
  bank_statements: { page: 5, label: 'Bank statements', required: false, multiple: true },
  property_ownership: { page: 5, label: 'Proof of property ownership', required: false, multiple: false, when: { field: 'housing', in: ['Owned'] } },
  lease_agreement: { page: 5, label: 'Rental lease agreement', required: false, multiple: false, when: { field: 'housing', in: ['Rented'] } },
  // page 6
  physician_report: { page: 6, label: "Physician's report", required: true, multiple: false },
  mental_health_evaluation: { page: 6, label: 'Mental health evaluation', required: false, multiple: false, hint: 'Only if required for your application.' },
  // page 7
  reference_letters: { page: 7, label: 'Reference letters', required: true, multiple: true },
  preadoption_training: { page: 7, label: 'Preadoption training certificates', required: false, multiple: true },
  other_supporting: { page: 7, label: 'Other supporting document', required: false, multiple: true },
};

const PAGES = [
  { n: 1, title: 'Applicant information' },
  { n: 2, title: 'Family and household' },
  { n: 3, title: 'Identity documents' },
  { n: 4, title: 'Background checks and clearances', note: 'One set per adult in the household. You can add more than one file.' },
  { n: 5, title: 'Financial information' },
  { n: 6, title: 'Health and medical evaluation' },
  { n: 7, title: 'Assessment and references',
    info: 'The home study report is written by a licensed social worker after a home visit. The home schedules it after you submit. There is nothing to upload for it.' },
  { n: 8, title: 'Reason for adoption' },
  { n: 9, title: 'Review and consent' },
];

/** Chosen when the application starts. Relative/Stepchild skips Matching and Trial custody. */
const APPLICATION_TYPES = {
  Regular: { label: 'Regular (unrelated child)', hint: 'Adopting a child in the care of the home who is not related to you.' },
  Relative: { label: 'Relative or stepchild', hint: 'Adopting a relative or your spouse\'s child. Matching and trial custody are skipped.' },
};

/**
 * Privacy notice shown before the consent box (RA 10173). Bump the version when the text
 * changes: each application stores the version the applicant agreed to.
 */
const PRIVACY_NOTICE = {
  version: 'PN-2026-1',
  title: 'Privacy notice',
  sections: [
    { heading: 'Why we collect your data', text: 'To evaluate your adoption application, carry out the home study, and work with RACCO, the NACC and the civil registry as RA 11642 requires.' },
    { heading: 'Who can see it', text: 'Only authorized staff and administrators of the home who handle your case. Adoption records are confidential under RA 11642 Section 39. They are shared with RACCO, the NACC or the civil registry only as the law requires, and every release is recorded.' },
    { heading: 'How long we keep it', text: 'Adoption records are kept permanently as the law requires and are never deleted from the system. Withdrawn or declined applications are kept on file and archived.' },
    { heading: 'Your rights', text: 'You can ask to see or correct your data from My applications. You can also contact the home\'s Data Protection Officer.' },
  ],
};
const CONSENT_VERSION = 'CONSENT-2026-1';

const CONSENT_TEXT = 'I declare that the information I have provided is true and accurate. I consent to the home collecting and processing my personal data and documents for evaluating this application, in line with the Data Privacy Act of 2012 (RA 10173). I understand that submitting an application does not guarantee approval or finalize an adoption.';

/**
 * Workflow documents (not part of the 9 pages). uploaders = roles that may upload;
 * protected = record type for the Protected record QR and token rules (view needs a token for Staff).
 */
const STAGE_DOCUMENTS = {
  forum_certificate: { label: 'Adoption forum certificate', uploaders: ['Donor', 'Admin'], multiple: false },
  case_study_report: { label: 'Social Case Study Report', uploaders: ['Staff', 'Admin'], multiple: false, protected: 'case_study' },
  monitoring_report: { label: 'Monthly monitoring report', uploaders: ['Staff', 'Admin'], multiple: true, protected: 'monitoring_report' },
  publication_proof: { label: 'Proof of publication', uploaders: ['Staff', 'Admin'], multiple: false },
  order_of_adoption: { label: 'Order of Adoption', uploaders: ['Admin'], multiple: false, protected: 'order_of_adoption' },
  certificate_of_finality: { label: 'Certificate of Finality', uploaders: ['Admin'], multiple: false, protected: 'certificate_of_finality' },
};

const FILE_RULES = { types: ['application/pdf', 'image/png', 'image/jpeg'], extensions: ['pdf', 'png', 'jpg'], maxBytes: 10 * 1024 * 1024, maxFilesPerType: 10 };

/** True when a field or document with this condition is shown for the given answers. */
function isVisible(def, data) {
  if (!def.when) return true;
  return def.when.in.includes(data?.[def.when.field]);
}

/** True when a visible field must be filled in (required, or required only under a condition). */
function isRequired(def, data) {
  if (!isVisible(def, data)) return false;
  if (def.required) return true;
  return Boolean(def.requiredWhen && def.requiredWhen.in.includes(data?.[def.requiredWhen.field]));
}

/** Everything the browser needs to build the form. */
function formConfig() {
  return {
    pages: PAGES, fields: FIELDS, documents: DOCUMENTS, options: OPTIONS,
    address: { ncr: NCR, provinces: PROVINCES, city_lists: CITY_LISTS, other_city: OTHER_CITY },
    consent_text: CONSENT_TEXT, consent_version: CONSENT_VERSION, privacy_notice: PRIVACY_NOTICE,
    application_types: APPLICATION_TYPES, stage_documents: STAGE_DOCUMENTS, file_rules: FILE_RULES,
  };
}

module.exports = {
  FIELDS, DOCUMENTS, STAGE_DOCUMENTS, PAGES, OPTIONS, CONSENT_TEXT, CONSENT_VERSION, PRIVACY_NOTICE, APPLICATION_TYPES, FILE_RULES,
  OTHER_CITY, isVisible, isRequired, formConfig,
};
