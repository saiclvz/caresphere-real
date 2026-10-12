/**
 * Philippine administrative adoption workflow (RA 11642), as CareSphere records it.
 * CareSphere is the child-caring home: it records outcomes from RACCO, NACC and the civil
 * registry, it does not replace them. Allowed transitions are enforced on the server.
 *
 * Roles per step: OPS = Admin and Staff (social worker), ADMIN = Admin only.
 * Relative/Stepchild applications skip the Matching phase (Child matched, Trial custody).
 */
const OPS = ['Admin', 'Staff'];
const ADMIN = ['Admin'];

const PHASES = [
  { key: 'preparation', label: 'Preparation' },
  { key: 'matching', label: 'Matching' },
  { key: 'petition', label: 'Petition' },
  { key: 'finalization', label: 'Finalization' },
];

/**
 * Every status: its phase, and plain-language text for the applicant (what is happening,
 * and the next step). Applicants never see internal notes, case study contents or Finalize.
 */
const STAGES = {
  Draft: { phase: null, donor: 'Your application is a draft and has not been sent yet.', next: 'Finish the 9 pages and submit your application.' },
  Submitted: { phase: 'preparation', donor: 'The home has received your application.', next: 'Attend the adoption forum, then upload your forum certificate.' },
  'Documents requested': { phase: 'preparation', donor: 'The home needs more documents from you.', next: 'Upload the requested documents from this page.' },
  'Forum attended': { phase: 'preparation', donor: 'Your forum certificate has been checked.', next: 'A social worker will schedule your home study.' },
  'Home study scheduled': { phase: 'preparation', donor: 'Your home study visit is scheduled.', next: 'Be at home for the visit on the scheduled date.' },
  'Case study completed': { phase: 'preparation', donor: 'The social worker has finished your home study.', next: 'The home will decide if you are cleared for matching.' },
  'Cleared for matching': { phase: 'preparation', donor: 'You are cleared to continue.', next: 'The home will contact you about the next step.' },
  // The applicant sees no child details before the home discloses them (at trial custody).
  'Child matched': { phase: 'matching', donor: 'A possible match is being reviewed.', next: 'The home will contact you about the next steps.', donorLabel: 'Possible match being reviewed' },
  'Trial custody': { phase: 'matching', donor: 'Trial custody is in progress.', next: 'A social worker will visit for monthly monitoring.' },
  'Trial custody completed': { phase: 'matching', donor: 'Trial custody is complete.', next: 'The home will file the adoption petition.' },
  'Placement ended': { phase: 'matching', donor: 'The placement has ended.', next: 'The home will contact you about what happens next.' },
  'Petition filed': { phase: 'petition', donor: 'Your adoption petition has been filed.', next: 'The petition will be published as the law requires.' },
  Published: { phase: 'petition', donor: 'The petition has been published.', next: 'Attend the mandatory appearance when you are notified.' },
  'Mandatory appearance done': { phase: 'petition', donor: 'Your mandatory appearance is recorded.', next: 'The case will be endorsed to the NACC.' },
  'Endorsed to NACC': { phase: 'petition', donor: 'Your case has been endorsed to the NACC.', next: 'Wait for the NACC decision.' },
  'Awaiting NACC decision': { phase: 'finalization', donor: 'The NACC is reviewing your case.', next: 'The home will tell you when there is a decision.' },
  'Order of Adoption issued': { phase: 'finalization', donor: 'The Order of Adoption has been issued.', next: 'The civil registry record will be updated.' },
  'Civil registry updated': { phase: 'finalization', donor: 'The civil registry record has been updated.', next: 'The home will close your case.' },
  Closed: { phase: 'finalization', donor: 'Your adoption case is complete and closed.', next: null },
  Declined: { phase: null, donor: 'Your application was not approved.', next: 'See the remark from the home for details. You may apply again.' },
  Withdrawn: { phase: null, donor: 'You withdrew this application. It stays on file.', next: 'You can start a new application at any time.' },
};
const STATUSES = Object.keys(STAGES);

const PREPARATION = ['Submitted', 'Documents requested', 'Forum attended', 'Home study scheduled', 'Case study completed'];
// Can be set again while already in that status (request more documents, reschedule).
const REPEATABLE = ['Documents requested', 'Home study scheduled'];
const prep = [
  { to: 'Documents requested', roles: OPS }, { to: 'Forum attended', roles: OPS }, { to: 'Home study scheduled', roles: OPS },
  { to: 'Case study completed', roles: OPS }, { to: 'Cleared for matching', roles: ADMIN }, { to: 'Declined', roles: ADMIN },
];
const DECLINE = { to: 'Declined', roles: ADMIN };

const TRANSITIONS = {
  ...Object.fromEntries(PREPARATION.map((s) => [s, prep.filter((t) => t.to !== s || REPEATABLE.includes(t.to))])),
  'Cleared for matching': [
    { to: 'Child matched', roles: ADMIN, types: ['Regular'], via: 'matching' },
    { to: 'Petition filed', roles: OPS, types: ['Relative'] },
    { to: 'Documents requested', roles: OPS }, DECLINE,
  ],
  'Child matched': [{ to: 'Trial custody', roles: ADMIN }, { to: 'Placement ended', roles: ADMIN }, DECLINE],
  'Trial custody': [{ to: 'Trial custody completed', roles: ADMIN }, { to: 'Placement ended', roles: ADMIN }, DECLINE],
  'Placement ended': [{ to: 'Child matched', roles: ADMIN, via: 'matching' }, DECLINE],
  'Trial custody completed': [{ to: 'Petition filed', roles: OPS }, DECLINE],
  'Petition filed': [{ to: 'Published', roles: OPS }, DECLINE],
  Published: [{ to: 'Mandatory appearance done', roles: OPS }, DECLINE],
  'Mandatory appearance done': [{ to: 'Endorsed to NACC', roles: OPS }, DECLINE],
  'Endorsed to NACC': [{ to: 'Awaiting NACC decision', roles: OPS }, DECLINE],
  'Awaiting NACC decision': [{ to: 'Order of Adoption issued', roles: ADMIN }, DECLINE],
  'Order of Adoption issued': [{ to: 'Civil registry updated', roles: OPS }],
  'Civil registry updated': [{ to: 'Closed', roles: ADMIN }],
};

/** Decision 2: one active application per donor (Draft up to Civil registry updated). */
const INACTIVE = ['Declined', 'Withdrawn', 'Closed'];
const ACTIVE = STATUSES.filter((s) => !INACTIVE.includes(s));
/** Read-only statuses (the QR link still opens them). */
const FINAL = ['Closed', 'Declined', 'Withdrawn'];
/** Decision 4: donors can withdraw before the Order of Adoption. */
const AFTER_ORDER = ['Order of Adoption issued', 'Civil registry updated', 'Closed'];
const WITHDRAWABLE = STATUSES.filter((s) => !AFTER_ORDER.includes(s) && !['Declined', 'Withdrawn'].includes(s));
/** The child is placed with the applicant in these statuses. */
const PLACED = ['Child matched', 'Trial custody', 'Trial custody completed'];

const TRIAL_MONTHS = 6;
const NACC_DECISION_DAYS = 60;
const DUE_SOON_DAYS = 14;
const MONITORING_INTERVAL_DAYS = 30;

/** Transitions this user may make from the current status for this application type. */
/** Every NACC adoption type follows the Regular track or the Relative track (no matching). */
const trackOf = (type) => require('./adoptionForm').trackOf(type);

function allowedTargets(status, type, role) {
  const track = trackOf(type);
  return (TRANSITIONS[status] || [])
    // "Child matched" is recorded by approving a match (services/matching.js), not through Update status.
    .filter((t) => t.roles.includes(role) && (!t.types || t.types.includes(track)) && !t.via)
    .map((t) => t.to);
}

function transition(status, type, to) {
  const track = trackOf(type);
  return (TRANSITIONS[status] || []).find((t) => t.to === to && (!t.types || t.types.includes(track))) || null;
}

/** Moving to these needs every required document Verified and unexpired (the application is complete). */
// From the home study on, every required document must be verified (no stage after it can be reached without it).
const DOCUMENTS_COMPLETE_FOR = ['Home study scheduled', 'Cleared for matching', 'Petition filed'];

/**
 * The staff page's stage bar. A stage is done when its milestone is recorded, current when the
 * application's status is in it. Matching and Trial custody are skipped on the Relative track.
 */
const PROGRESS_STAGES = [
  { key: 'inquiry', label: 'Inquiry', statuses: ['Submitted'] },
  { key: 'forum', label: 'Forum', statuses: ['Forum attended'] },
  { key: 'documents', label: 'Documents', statuses: ['Documents requested'] },
  { key: 'assessment', label: 'Assessment', statuses: ['Home study scheduled', 'Case study completed', 'Cleared for matching'] },
  { key: 'matching', label: 'Matching', statuses: ['Child matched'], tracks: ['Regular'] },
  { key: 'trial', label: 'Trial custody', statuses: ['Trial custody', 'Trial custody completed', 'Placement ended'], tracks: ['Regular'] },
  { key: 'petition', label: 'Petition', statuses: ['Petition filed', 'Published', 'Mandatory appearance done', 'Endorsed to NACC', 'Awaiting NACC decision'] },
  { key: 'order', label: 'Order', statuses: ['Order of Adoption issued', 'Civil registry updated', 'Closed'] },
];

/** For the 4-phase tracker: index of the current phase (0-3), or -1 for draft/declined/withdrawn. */
function phaseIndex(status) {
  const phase = STAGES[status]?.phase;
  return phase ? PHASES.findIndex((p) => p.key === phase) : -1;
}

/** The status as the applicant sees it. */
const donorLabel = (status) => STAGES[status]?.donorLabel || status;

module.exports = {
  donorLabel,
  DOCUMENTS_COMPLETE_FOR, trackOf, PROGRESS_STAGES,
  OPS, ADMIN, PHASES, STAGES, STATUSES, TRANSITIONS, PREPARATION, ACTIVE, INACTIVE, FINAL, WITHDRAWABLE, AFTER_ORDER, PLACED,
  TRIAL_MONTHS, NACC_DECISION_DAYS, DUE_SOON_DAYS, MONITORING_INTERVAL_DAYS, allowedTargets, transition, phaseIndex,
};
