/**
 * What Staff see on an adoption application, section by section. Sensitive sections are sent
 * only to Admin, or to the assigned Staff member during an unlock session (purpose + QR +
 * single-use Token ID). Edit `sensitive` to change what is locked. While locked, Staff get
 * only the non-sensitive rows, and the applicant's name is masked (e.g. "J. L.").
 */
const ADOPTION_PAGE_SECTIONS = [
  { key: 'reference', label: 'Reference number', sensitive: false },
  { key: 'status', label: 'Status', sensitive: false },
  { key: 'submitted', label: 'Submission date', sensitive: false },
  { key: 'assigned_staff', label: 'Assigned staff', sensitive: false },
  { key: 'qr', label: 'Application QR (link and reference only)', sensitive: false },
  { key: 'applicant_identity', label: 'Applicant name, contact and application type', sensitive: true },
  { key: 'consent', label: 'Consent details', sensitive: true },
  { key: 'matched_child', label: 'Matched child', sensitive: true },
  { key: 'milestones', label: 'Milestones and deadlines', sensitive: true },
  { key: 'workflow_documents', label: 'Workflow documents (titles included)', sensitive: true },
  { key: 'application_pages', label: 'Application pages 1 to 8 and their documents', sensitive: true },
  { key: 'document_requests', label: 'Document requests', sensitive: true },
  { key: 'interviews', label: 'Interviews and home study', sensitive: true },
  { key: 'status_history', label: 'Status history and remarks', sensitive: true },
  { key: 'internal_notes', label: 'Internal notes', sensitive: true },
  { key: 'legacy', label: 'Earlier form data', sensitive: true },
];

/** Child record sections opened with the same flow (health keeps its own access token underneath). */
const CHILD_SECTIONS = [
  { key: 'health', label: 'Health record and case files' },
  { key: 'adoption_legal', label: 'Adoption legal records (CDCLAA details)' },
];

const SENSITIVE_ADOPTION = ADOPTION_PAGE_SECTIONS.filter((s) => s.sensitive);

/** "Juana Dela Cruz" -> "J. D. C." */
const maskName = (name) => String(name || '').trim().split(/\s+/).filter(Boolean).map((w) => `${w[0].toUpperCase()}.`).join(' ') || 'Applicant';

module.exports = { ADOPTION_PAGE_SECTIONS, SENSITIVE_ADOPTION, CHILD_SECTIONS, maskName };
