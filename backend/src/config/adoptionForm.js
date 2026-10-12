/**
 * The 9-page adoption application: one definition used by the server to validate and
 * sent to the browser (GET /api/adoptions/form-config) to build the form, so every rule
 * lives in one place.
 *
 * Conditions are plain data so the browser can use them too:
 *   when: { field: 'civil_status', in: ['Married'] }   -> shown (and required) only then
 *   when: [cond, cond]                                -> every condition must hold
 *   fields usable in conditions: any answer, application_type (the NACC adoption type), and
 *   adoptee_minor / adoptee_10_plus (worked out from adoptee_dob; a Regular adoption is for a minor)
 * A hidden field or document is never required ("Not applicable").
 *
 * Document requirements follow NACC's published RA 11642 documentary requirements (application of
 * adoptive applicants, and the checklist per adoption type). validity_months = how recent a document
 * must be, counted from the date the applicant enters as issued or taken.
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
  id_type: ["Passport", "Driver's license", 'UMID', 'PhilSys National ID', 'Postal ID', "Voter's ID", 'PRC ID', 'PhilHealth ID', 'Other'],
  citizenship: ['Filipino', 'Foreign national', 'Dual citizen'],
  yes_no: ['No', 'Yes'],
  pref_age_range: ['0 to 2 years', '3 to 5 years', '6 to 9 years', '10 to 13 years', '14 to 17 years', 'Any age'],
  pref_special_needs: ['No', 'Yes, mild or manageable needs', 'Yes, including significant needs'],
  pref_siblings: ['No', 'Yes, two siblings', 'Yes, three or more siblings'],
  pref_space: ['A room of their own', 'A shared room'],
};

/** Field groups shown as one box on the form. */
const FIELD_GROUPS = {
  address: { label: 'Address' },
  adoptee: { label: 'About the child' },
  preferences: { label: 'Preferences (optional)', note: 'For matching guidance only. They never decide a match alone, and only your social worker and the home\'s administrators see them.' },
};
const NOT_REGULAR = ['Stepparent', 'Relative', 'Relative_own_child', 'Adult'];

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
  citizenship: { page: 1, label: 'Citizenship', type: 'select', required: true, options: OPTIONS.citizenship },
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
  // Answers that decide which NACC documents apply.
  children_10_plus: { page: 2, label: 'Do you have marital or adopted children aged 10 or older?', type: 'select', required: true, options: OPTIONS.yes_no },
  nonmarital_children_10_plus: { page: 2, label: 'Do non-marital children aged 10 or older live with you (or are under your parental authority)?', type: 'select', required: true, options: OPTIONS.yes_no },
  has_adopted_before: { page: 2, label: 'Have you adopted a child before?', type: 'select', required: true, options: OPTIONS.yes_no },
  // "About the child": the child is already known in these categories (no matching).
  adoptee_name: { page: 2, label: 'Full name of the child or person you want to adopt', type: 'text', required: true, max: 150, group: 'adoptee',
    when: { field: 'application_type', in: NOT_REGULAR } },
  adoptee_dob: { page: 2, label: "Date of birth of the child or person you want to adopt", type: 'date', required: true, group: 'adoptee',
    when: { field: 'application_type', in: NOT_REGULAR } },
  adoptee_relationship: { page: 2, label: 'Your relationship to them', type: 'text', required: true, max: 100, group: 'adoptee',
    when: { field: 'application_type', in: NOT_REGULAR } },

  // ---- page 3: identity documents (the ID type; the files are in DOCUMENTS)
  id_type: { page: 3, label: 'Type of government-issued ID', type: 'select', required: true, options: OPTIONS.id_type },
  id_type_other: { page: 3, label: 'Type of ID', type: 'text', required: true, max: 100, when: { field: 'id_type', in: ['Other'] } },
  // As printed on the ID: checked against the format for the ID type and compared with page 1.
  id_number: { page: 3, label: 'ID number', type: 'idnumber', required: true, max: 40 },
  id_expiry: { page: 3, label: 'ID expiry date', type: 'date', required: true, future: true,
    when: { field: 'id_type', in: ["Passport", "Driver's license", 'PRC ID', 'Postal ID', 'Other'] } },
  id_name: { page: 3, label: 'Name exactly as printed on the ID', type: 'text', required: true, max: 150 },
  id_dob: { page: 3, label: 'Date of birth as printed on the ID', type: 'date', required: true },
  // ---- page 4: clearances (reference number and date issued; a scanned copy is optional)
  clearances: { page: 4, label: 'NBI, police or court clearances', type: 'clearances', required: true, maxRows: 6,
    when: { field: 'application_type', in: ['Regular', 'Stepparent', 'Relative', 'Adult'] } },

  // ---- page 8: reason for adoption
  reason_for_adoption: { page: 8, label: 'Reason for adoption', type: 'textarea', required: true, min: 50, max: 5000 },
  // Preferences (optional, Regular adoption): guidance for matching only. They never decide a match alone and
  // are seen only by the assigned social worker and administrators.
  pref_age_range: { page: 8, label: 'Preferred age range of the child', type: 'select', required: false, options: OPTIONS.pref_age_range, group: 'preferences',
    when: { field: 'application_type', in: ['Regular'] } },
  pref_special_needs: { page: 8, label: 'Open to a child with health or special needs?', type: 'select', required: false, options: OPTIONS.pref_special_needs, group: 'preferences',
    when: { field: 'application_type', in: ['Regular'] } },
  pref_siblings: { page: 8, label: 'Open to adopting brothers or sisters together?', type: 'select', required: false, options: OPTIONS.pref_siblings, group: 'preferences',
    when: { field: 'application_type', in: ['Regular'] } },
  pref_space: { page: 8, label: 'Space for the child at home', type: 'select', required: false, options: OPTIONS.pref_space, group: 'preferences',
    when: { field: 'application_type', in: ['Regular'] } },
};

/**
 * Document types. multiple = more than one file allowed. Files: PDF, PNG or JPG, up to 10 MB each.
 * required + when = conditional (required only when the conditions hold); validity_months + issued_label
 * = the applicant enters the date issued or taken, and the document expires after that many months.
 */
const DOCUMENTS = {
  // page 3: identity and civil status
  valid_id: { page: 3, label: 'Valid government-issued ID (front)', required: true, multiple: false, id_side: 'front' },
  // Required for card IDs, optional for passports: enforced at submit from the ID type rules (tbl_id_type_rules).
  valid_id_back: { page: 3, label: 'Valid government-issued ID (back)', required: false, multiple: false, id_side: 'back' },
  birth_certificate: { page: 3, label: 'PSA/SECPA birth certificate', required: true, multiple: true, hint: 'For every applicant.' },
  marriage_certificate: { page: 3, label: 'PSA/SECPA marriage certificate', required: true, multiple: false, when: { field: 'civil_status', in: ['Married'] } },
  cenomar: { page: 3, label: 'Certificate of No Marriage (CENOMAR), PSA/SECPA', required: true, multiple: false, when: { field: 'civil_status', in: ['Single'] } },
  spouse_death_certificate: { page: 3, label: "Death certificate of spouse", required: true, multiple: false, when: { field: 'civil_status', in: ['Widowed'] } },
  annulment_decree: { page: 3, label: 'Annulment decree or declaration of nullity, with Certificate of Finality', required: true, multiple: false,
    when: [{ field: 'civil_status', in: ['Divorced'] }, { field: 'citizenship', in: ['Filipino', 'Dual citizen'] }] },
  foreign_divorce_papers: { page: 3, label: 'Authenticated divorce papers, court decision and Certificate of Finality', required: true, multiple: false,
    when: [{ field: 'civil_status', in: ['Divorced'] }, { field: 'citizenship', in: ['Foreign national'] }] },
  legal_separation_decree: { page: 3, label: 'Decree of legal separation', required: true, multiple: false, when: { field: 'civil_status', in: ['Separated'] } },
  family_photos: { page: 3, label: 'Recent 5R photos of you, your family and your home (dated)', required: true, multiple: true,
    validity_months: 6, issued_label: 'Date the photos were taken' },
  // page 4: background checks and clearances
  // The clearance itself is checked by its reference number and date issued (page 4 answers). A scanned
  // copy is optional and is never treated as proof by itself.
  nbi_police_clearance: { page: 4, label: 'Scanned copy of your clearance (optional)', required: false, multiple: true,
    when: { field: 'application_type', in: ['Regular', 'Stepparent', 'Relative', 'Adult'] } },
  foreign_police_clearance: { page: 4, label: 'Police clearance from every country you lived in for more than 12 months in the past 15 years', required: true, multiple: true,
    when: { field: 'citizenship', in: ['Foreign national'] } },
  // page 5: financial capacity
  // Financial capacity: NACC lists it for Regular, Stepparent and Relative adoptions.
  employment_verification: { page: 5, label: 'Employment verification letter', required: true, multiple: false,
    when: [{ field: 'employment_status', in: ['Employed', 'Overseas worker'] }, { field: 'application_type', in: ['Regular', 'Stepparent', 'Relative'] }] },
  business_permit: { page: 5, label: 'Business registration or permit', required: true, multiple: false,
    when: [{ field: 'employment_status', in: ['Self-employed'] }, { field: 'application_type', in: ['Regular', 'Stepparent', 'Relative'] }] },
  proof_of_income: { page: 5, label: 'Proof of income source', required: false, multiple: true, when: { field: 'employment_status', in: NOT_EARNING } },
  tax_returns: { page: 5, label: 'Latest income tax return (ITR)', required: false, multiple: true },
  bank_statements: { page: 5, label: 'Bank certificate or statements', required: false, multiple: true },
  property_ownership: { page: 5, label: 'Proof of property ownership', required: false, multiple: false, when: { field: 'housing', in: ['Owned'] } },
  lease_agreement: { page: 5, label: 'Rental lease agreement', required: false, multiple: false, when: { field: 'housing', in: ['Rented'] } },
  // page 6: health
  // NACC lists the medical evaluation for Regular and Relative adoptions.
  physician_report: { page: 6, label: 'Medical evaluation with test results and medical certificate (licensed physician)', required: true, multiple: false,
    validity_months: 6, issued_label: 'Date of the medical certificate', when: { field: 'application_type', in: ['Regular', 'Relative'] } },
  mental_health_evaluation: { page: 6, label: 'Psychological evaluation report', required: false, multiple: false,
    validity_months: 24, issued_label: 'Date of the report', hint: 'Only if the social worker recommends it.' },
  // page 7: references, consents and other documents
  reference_letters: { page: 7, label: 'Character reference letters from three non-related people (with contact details and date)', required: true, multiple: true,
    when: { field: 'application_type', in: ['Regular', 'Stepparent', 'Relative', 'Adult'] } },
  spouse_consent: { page: 7, label: 'Written consent of your spouse', required: true, multiple: false, when: { field: 'civil_status', in: ['Married'] } },
  children_consent: { page: 7, label: 'Written consent of your marital and adopted children aged 10 or older', required: true, multiple: true,
    when: { field: 'children_10_plus', in: ['Yes'] } },
  nonmarital_children_consent: { page: 7, label: 'Written consent of non-marital children aged 10 or older living with you', required: true, multiple: true,
    when: { field: 'nonmarital_children_10_plus', in: ['Yes'] } },
  adoptee_consent: { page: 7, label: 'Written consent of the child or person to be adopted (10 years or older)', required: true, multiple: false,
    when: [{ field: 'application_type', in: NOT_REGULAR }, { field: 'adoptee_10_plus', in: ['Yes'] }] },
  biological_parent_consent: { page: 7, label: "Written consent of the child's biological parent(s) or the person exercising parental authority", required: true, multiple: true,
    when: [{ field: 'application_type', in: ['Stepparent', 'Relative', 'Relative_own_child'] }, { field: 'adoptee_minor', in: ['Yes'] }] },
  child_care_plan: { page: 7, label: 'Child care plan with at least three temporary custodians, in order of preference', required: true, multiple: false,
    when: [{ field: 'application_type', in: ['Regular', 'Relative'] }, { field: 'adoptee_minor', in: ['Yes'] }] },
  proof_treated_as_own: { page: 7, label: 'Proof the adoptee was treated as your own child for at least three years before turning 18 (e.g. barangay certification, old photos)', required: true, multiple: true,
    when: { field: 'application_type', in: ['Adult'] } },
  previous_adoption_finality: { page: 7, label: 'Certificate of Finality of your previous adoption', required: true, multiple: false,
    when: { field: 'has_adopted_before', in: ['Yes'] } },
  residency_certificate: { page: 7, label: 'Certificate of residency in the Philippines for at least five years (Bureau of Immigration or DFA)', required: true, multiple: false,
    when: { field: 'citizenship', in: ['Foreign national'] } },
  foreign_law_certification: { page: 7, label: "Certification that your country recognises the Order of Adoption and allows the child's entry", required: true, multiple: false,
    when: { field: 'citizenship', in: ['Foreign national'] } },
  dual_citizen_undertaking: { page: 7, label: 'Notarized Undertaking and Oath for applicants residing abroad or with foreign citizenship', required: true, multiple: false,
    when: { field: 'citizenship', in: ['Dual citizen'] } },
  dual_citizen_oath: { page: 7, label: 'Oath of Allegiance and Identification Certificate', required: true, multiple: false, when: { field: 'citizenship', in: ['Dual citizen'] } },
  dual_citizen_order: { page: 7, label: 'Order of Approval on citizenship retention and re-acquisition (RA 9225)', required: true, multiple: false,
    when: { field: 'citizenship', in: ['Dual citizen'] } },
  application_undertaking_form: { page: 7, label: 'NACC Application and Undertaking Form (signed)', required: true, multiple: false,
    hint: 'The signed NACC form. This online application does not replace it.' },
  // The child or person to be adopted, when the applicant already knows them (all types except Regular).
  // For a Regular adoption the home holds the child's documents (Social Case Study Report, CDCLAA and the
  // child documents under STAGE_DOCUMENTS), so they are not asked from the applicant.
  adoptee_birth_certificate: { page: 7, label: "Adoptee's PSA/SECPA birth certificate (or foundling certificate)", required: true, multiple: false,
    when: { field: 'application_type', in: NOT_REGULAR } },
  adoptee_medical_evaluation: { page: 7, label: "Adoptee's medical evaluation", required: true, multiple: false,
    validity_months: 6, issued_label: 'Date of the medical evaluation', when: [{ field: 'application_type', in: NOT_REGULAR }, { field: 'adoptee_minor', in: ['Yes'] }] },
  adoptee_psychological_evaluation: { page: 7, label: "Adoptee's psychological evaluation (5 years or older)", required: true, multiple: false,
    validity_months: 24, issued_label: 'Date of the report', when: [{ field: 'application_type', in: NOT_REGULAR }, { field: 'adoptee_minor', in: ['Yes'] }, { field: 'adoptee_5_plus', in: ['Yes'] }] },
  adoptee_photos: { page: 7, label: "Recent photos of the adoptee", required: true, multiple: true,
    validity_months: 6, issued_label: 'Date the photos were taken', when: { field: 'application_type', in: NOT_REGULAR } },
  birth_parent_documents: { page: 7, label: "Biological parent documents (e.g. death certificate), if a parent has died or can't be found", required: false, multiple: true,
    when: { field: 'application_type', in: ['Stepparent', 'Relative'] } },
  preadoption_training: { page: 7, label: 'Adoption training certificates', required: false, multiple: true },
  other_supporting: { page: 7, label: 'Other supporting document', required: false, multiple: true },
};

/** Statuses of an uploaded document, set by Admin or Staff review. "Expired" is worked out, not stored. */
const DOCUMENT_STATUSES = ['Submitted', 'Under validation', 'Verified', 'Rejected', 'Requires correction', 'Manual verification required'];

const PAGES = [
  { n: 1, title: 'Applicant information' },
  { n: 2, title: 'Family and household' },
  { n: 3, title: 'Identity documents' },
  { n: 4, title: 'Background checks and clearances', note: 'Enter the reference number and date issued for your clearance, and your spouse\'s if you are married. The home verifies each one; no screenshot is needed.' },
  { n: 5, title: 'Financial information' },
  { n: 6, title: 'Health and medical evaluation' },
  { n: 7, title: 'Assessment and references',
    info: 'The home study report is written by a licensed social worker after a home visit. The home schedules it after you submit. There is nothing to upload for it.' },
  { n: 8, title: 'Reason for adoption' },
  { n: 9, title: 'Review and consent' },
];

/**
 * NACC adoption types, chosen when the application starts. track = the workflow it follows:
 * Regular goes through matching and trial custody; the others (the child is already known) skip them.
 */
const APPLICATION_TYPES = {
  Regular: { label: 'Regular (unrelated child)', short: 'Regular', relationship: 'Unrelated', track: 'Regular', hint: 'Adopting a child in the care of the home who is not related to you.' },
  Stepparent: { label: "Stepparent (your spouse's child)", short: 'Stepparent', relationship: "Spouse's child", track: 'Relative', hint: "Adopting your spouse's child. Matching and trial custody are skipped." },
  Relative: { label: 'Relative', short: 'Relative', track: 'Relative', hint: 'Adopting a relative within the fourth degree. Matching and trial custody are skipped.' },
  Relative_own_child: { label: 'Your own non-marital child', short: 'Own child', relationship: 'Own non-marital child', track: 'Relative', hint: 'Adopting your own child born outside marriage. Matching and trial custody are skipped.' },
  Adult: { label: 'Adult (18 or older)', short: 'Adult', track: 'Relative', hint: 'Adopting an adult you treated as your own child before they turned 18.' },
};
const trackOf = (type) => APPLICATION_TYPES[type]?.track || 'Regular';

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
  forum_certificate: { label: 'Adoption forum certificate', uploaders: ['Donor', 'Admin'], multiple: false, group: 'applicant' },
  case_study_report: { label: 'Social Case Study Report', uploaders: ['Staff', 'Admin'], multiple: false, protected: 'case_study', group: 'child' },
  monitoring_report: { label: 'Monthly monitoring report', uploaders: ['Staff', 'Admin'], multiple: true, protected: 'monitoring_report', group: 'post_placement' },
  publication_proof: { label: 'Proof of publication', uploaders: ['Staff', 'Admin'], multiple: false, group: 'legal' },
  // The matched child's documents (Regular adoptions). Required before "Petition filed"; the psychological
  // evaluation only when the child is 5 or older.
  child_birth_certificate: { label: "Child's PSA/SECPA birth certificate or foundling certificate", uploaders: ['Staff', 'Admin'], multiple: false, tracks: ['Regular'], petition: true, group: 'child' },
  child_medical_evaluation: { label: "Child's medical evaluation and history", uploaders: ['Staff', 'Admin'], multiple: false, tracks: ['Regular'], petition: true, group: 'child' },
  child_psychological_evaluation: { label: "Child's psychological evaluation (5 years or older)", uploaders: ['Staff', 'Admin'], multiple: false, tracks: ['Regular'], petition: 'age5', group: 'child' },
  child_photos: { label: "Recent photos of the child", uploaders: ['Staff', 'Admin'], multiple: true, tracks: ['Regular'], petition: true, group: 'child' },
  child_consent: { label: "Child's written consent (10 years or older)", uploaders: ['Staff', 'Admin'], multiple: false, tracks: ['Regular'], petition: 'age10', group: 'child' },
  order_of_adoption: { label: 'Order of Adoption', uploaders: ['Admin'], multiple: false, protected: 'order_of_adoption', group: 'legal' },
  certificate_of_finality: { label: 'Certificate of Finality', uploaders: ['Admin'], multiple: false, protected: 'certificate_of_finality', group: 'legal' },
};

/**
 * Groups on the staff Documents tab. Every application document (DOCUMENTS) is an applicant document;
 * the stage documents say their group above. Post-placement documents are listed once trial custody starts.
 */
const DOCUMENT_GROUPS = [
  { key: 'applicant', label: 'Applicant documents', hint: 'Submitted by the applicant.' },
  { key: 'child', label: 'Child documents', hint: 'Uploaded by the home.' },
  { key: 'legal', label: 'Case and legal documents', hint: 'Uploaded by the home.' },
  { key: 'post_placement', label: 'Post-placement', hint: 'From the start of trial custody.' },
];

const FILE_RULES = { types: ['application/pdf', 'image/png', 'image/jpeg'], extensions: ['pdf', 'png', 'jpg'], maxBytes: 10 * 1024 * 1024, maxFilesPerType: 10 };

/** Whole years from a YYYY-MM-DD date to today, or null. */
function yearsSince(date) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date || ''))) return null;
  const [y, m, d] = String(date).split('-').map(Number);
  const now = new Date();
  let age = now.getFullYear() - y;
  if (now.getMonth() + 1 < m || (now.getMonth() + 1 === m && now.getDate() < d)) age -= 1;
  return age;
}

/**
 * The answers plus what conditions need: the adoption type and facts worked out from adoptee_dob.
 * A Regular adoption is for a child in care (a minor whose age is matched later).
 */
function answersFor(data, applicationType) {
  const type = applicationType || data?.application_type || 'Regular';
  const age = type === 'Regular' ? null : yearsSince(data?.adoptee_dob);
  return {
    ...(data || {}), application_type: type,
    adoptee_minor: type === 'Regular' ? 'Yes' : age === null ? '' : age < 18 ? 'Yes' : 'No',
    adoptee_10_plus: age === null ? '' : age >= 10 ? 'Yes' : 'No',
    adoptee_5_plus: age === null ? '' : age >= 5 ? 'Yes' : 'No',
  };
}

/** True when a field or document is shown for these answers (every condition must hold). */
function isVisible(def, data) {
  if (!def.when) return true;
  const conds = Array.isArray(def.when) ? def.when : [def.when];
  const a = data && 'adoptee_minor' in data ? data : answersFor(data);
  return conds.every((c) => c.in.includes(a?.[c.field]));
}

/**
 * Required, Conditional, Optional or Not applicable, for these answers. A document needed for every
 * case of the chosen adoption type is Required; one that depends on the applicant's answers is Conditional.
 */
function requirementOf(def, data) {
  if (!isVisible(def, data)) return 'Not applicable';
  // The back of the ID follows the ID type rule (Settings > ID types): required for cards, optional for a passport.
  if (def.id_side === 'back') {
    const rule = data?.id_type ? require('../services/idTypes').cachedRule(data.id_type) : null;
    return !data?.id_type || !rule || rule.needsBack ? 'Required' : 'Optional';
  }
  if (!def.required) return 'Optional';
  const conds = def.when ? (Array.isArray(def.when) ? def.when : [def.when]) : [];
  return conds.some((c) => c.field !== 'application_type') ? 'Conditional' : 'Required';
}

/** The date a document expires (YYYY-MM-DD), from the date issued and its validity, or null. */
function expiresOn(def, issuedDate) {
  if (!def?.validity_months || !/^\d{4}-\d{2}-\d{2}$/.test(String(issuedDate || '').slice(0, 10))) return null;
  const d = new Date(`${String(issuedDate).slice(0, 10)}T00:00:00`);
  d.setMonth(d.getMonth() + def.validity_months);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
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
    pages: PAGES, fields: FIELDS, field_groups: FIELD_GROUPS, documents: DOCUMENTS, options: OPTIONS,
    address: { ncr: NCR, provinces: PROVINCES, city_lists: CITY_LISTS, other_city: OTHER_CITY },
    consent_text: CONSENT_TEXT, consent_version: CONSENT_VERSION, privacy_notice: PRIVACY_NOTICE,
    application_types: APPLICATION_TYPES, stage_documents: STAGE_DOCUMENTS, document_groups: DOCUMENT_GROUPS, file_rules: FILE_RULES, document_statuses: DOCUMENT_STATUSES,
  };
}

/**
 * Retired document types (removed by decision). They appear nowhere: files uploaded under them are
 * archived by migration 028 (hidden from every screen and API, no view or download) until Admin disposes
 * of them in Data protection. Requests for them are not shown or counted. New uploads are refused.
 */
const RETIRED_DOC_TYPES = ['divorce_or_death_certificate', 'child_abuse_clearance', 'fingerprint_clearance'];

module.exports = {
  RETIRED_DOC_TYPES, FIELDS, DOCUMENTS, STAGE_DOCUMENTS, DOCUMENT_GROUPS, PAGES, OPTIONS, CONSENT_TEXT, CONSENT_VERSION, PRIVACY_NOTICE, APPLICATION_TYPES, FILE_RULES,
  OTHER_CITY, isVisible, isRequired, formConfig, answersFor, requirementOf, expiresOn, trackOf, DOCUMENT_STATUSES, NOT_REGULAR,
};
