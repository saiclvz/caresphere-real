/**
 * Transition Review (18+): the 9 stages, the readiness assessment, the plan's standard tasks, the
 * pre-transition checklist and the aftercare follow-ups. Edit wording here; the rules are in
 * services/transitionWorkflow.js. Turning 18 creates a review; nothing here discharges anyone automatically.
 */
const STAGES = [
  { key: 'identify', label: 'Identify for review', help: 'The young person turned 18 and was flagged. Check the details, set the goals, then begin the assessment.' },
  { key: 'assessment', label: 'Assessment', help: "Transition readiness in six areas, the overall readiness and the young person's own views. A score is only a guide; the social worker decides the overall readiness." },
  { key: 'conference', label: 'Case conference', help: 'Who took part, what the assessment showed, strengths, concerns and the recommendation.' },
  { key: 'decision', label: 'Transition decision', help: 'The formal decision on the pathway. Recorded by an administrator, with a reason.', admin: true },
  { key: 'plan', label: 'Transition plan', help: 'Created when the transition is approved. Complete or mark each task not applicable.' },
  { key: 'preparation', label: 'Pre-transition preparation', help: 'Every item must be done (or not applicable, with a reason) before the transition is recorded.' },
  { key: 'discharge', label: 'Discharge / placement', help: "Records where the young person goes. The child's record is kept: their status and discharge history are updated, nothing is deleted.", admin: true },
  { key: 'aftercare', label: 'Aftercare monitoring', help: 'Follow-ups after the transition: week 1, month 1, month 3 and month 6, and any other contact.' },
  { key: 'closure', label: 'Case closure', help: 'Closes the review after the transition and aftercare. The records stay; the review becomes read-only.', admin: true },
];

const RATINGS = ['Not Assessed', 'Needs Improvement', 'Partially Ready', 'Ready'];
const OVERALL = ['Ready for Transition', 'Ready with Conditions', 'Not Yet Ready', 'Further Assessment Required'];

const CATEGORIES = [
  { key: 'emotional', label: 'A. Emotional readiness', items: [['emotional_stability', 'Emotional stability'], ['coping_skills', 'Coping skills'], ['decision_making', 'Decision making'], ['understanding', 'Understanding of transition']] },
  { key: 'life_skills', label: 'B. Life skills', items: [['hygiene', 'Personal hygiene'], ['cooking', 'Cooking'], ['laundry', 'Laundry'], ['cleaning', 'Cleaning'], ['time_management', 'Time management'], ['transportation', 'Transportation'], ['communication', 'Communication'], ['problem_solving', 'Problem solving']] },
  { key: 'education', label: 'C. Education / vocational readiness', items: [['current_education', 'Current education'], ['school_enrollment', 'School enrollment'], ['vocational_training', 'Vocational training'], ['employment_readiness', 'Employment readiness'], ['career_goals', 'Career goals']] },
  { key: 'health', label: 'D. Health readiness', items: [['medical', 'Medical status'], ['dental', 'Dental status'], ['psychosocial', 'Mental / psychosocial needs'], ['medication', 'Medication needs'], ['healthcare_access', 'Healthcare access']] },
  { key: 'family', label: 'E. Family / social support', items: [['biological_family', 'Biological family'], ['relatives', 'Relatives'], ['foster_kinship', 'Foster / kinship support'], ['trusted_adult', 'Trusted adult'], ['community', 'Community support'], ['environment_safety', 'Safety of proposed environment']] },
  { key: 'financial', label: 'F. Financial / livelihood readiness', items: [['income', 'Income'], ['employment', 'Employment'], ['budgeting', 'Budgeting'], ['savings', 'Savings'], ['livelihood_skills', 'Livelihood skills'], ['housing_affordability', 'Housing affordability']] },
];
const ITEM_KEYS = CATEGORIES.flatMap((c) => c.items.map(([k]) => k));
const CATEGORY_OF = Object.fromEntries(CATEGORIES.flatMap((c) => c.items.map(([k]) => [k, c.key])));

const CHILD_VOICE = [
  ['feelings', 'How do you feel about transitioning?'],
  ['where_live', 'Where would you like to live?'],
  ['worries', 'What are you worried about?'],
  ['support', 'What support do you need?'],
  ['goals', 'What are your goals after transition?'],
];

const MEETING_TYPES = ['In person', 'Online', 'Phone', 'Mixed'];
const PARTICIPANT_ROLES = ['Social Worker', 'House Parent / Caregiver', 'Young Person', 'Administrator', 'Psychologist / relevant professional', 'Other'];
const RECOMMENDATIONS = ['Proceed to Transition Planning', 'Transition with Conditions', 'Continue Preparation', 'Further Assessment Required'];

const PATHWAYS = ['Independent Living', 'Family Reunification', 'Kinship / Foster Care', 'Adoption / Permanent Family Placement', 'Another Appropriate Placement', 'Continue Residential Care'];
const DECISIONS = ['Approved', 'Approved with Conditions', 'Deferred', 'Continue Residential Care'];
const APPROVED = ['Approved', 'Approved with Conditions'];

const TASK_STATUSES = ['Pending', 'In Progress', 'Completed', 'Not Applicable'];
const PRIORITIES = ['Low', 'Medium', 'High'];
const STANDARD_TASKS = [
  ['ids', 'Secure identification documents', 'Valid IDs the young person will need (e.g. PhilSys, school or postal ID).', 'High'],
  ['birth_records', 'Birth certificate / required records', 'PSA birth certificate and other civil records.', 'High'],
  ['education', 'Education plan', 'School, college or training enrollment after transition.', 'Medium'],
  ['livelihood', 'Employment / livelihood plan', 'Work, apprenticeship or livelihood arrangement.', 'Medium'],
  ['housing', 'Housing arrangement', 'Where the young person will live, and that it is safe and affordable.', 'High'],
  ['life_skills', 'Life-skills preparation', 'Practice of the skills the assessment found need improvement.', 'Medium'],
  ['health', 'Health follow-up', 'Medical, dental and psychosocial follow-up after transition.', 'Medium'],
  ['financial', 'Financial preparation', 'Budget, savings and any financial support.', 'Medium'],
  ['family', 'Family preparation', 'Preparing the receiving family or support network.', 'Medium'],
  ['transport', 'Transportation preparation', 'How the young person will move and travel after transition.', 'Low'],
  ['aftercare', 'Aftercare plan', 'Who follows up after transition, and how to reach them.', 'High'],
];

const PREPARATION = [
  ['orientation', 'Young person orientation completed'],
  ['receiving', 'Receiving family / placement coordinated'],
  ['housing', 'Housing verified'],
  ['education_employment', 'Education/employment arrangement confirmed'],
  ['documents', 'Documents verified'],
  ['health', 'Health assessment completed'],
  ['safety', 'Safety plan completed'],
  ['financial', 'Financial/livelihood plan completed'],
  ['aftercare_schedule', 'Aftercare schedule created'],
  ['final_conference', 'Final case conference completed'],
];

const DESTINATIONS = ['Independent Living', 'Biological Family', 'Relative / Kinship', 'Foster Family', 'Another Facility', 'Other Appropriate Placement'];

const FOLLOWUPS = [['Week 1', 7], ['Month 1', 30], ['Month 3', 91], ['Month 6', 182]];
const CONTACT_TYPES = ['Home Visit', 'Office Visit', 'Phone Call', 'Video Call', 'School Visit', 'Community Visit', 'Other'];
const VISIT_FIELDS = [
  ['location', 'Location'], ['person_contacted', 'Person contacted'], ['housing_status', 'Housing status'], ['education_status', 'Education status'],
  ['employment_status', 'Employment status'], ['health_status', 'Health status'], ['financial_status', 'Financial status'], ['social_support', 'Social support'],
  ['safety_concerns', 'Safety concerns'], ['progress', 'Progress'], ['problems', 'Problems encountered'], ['interventions', 'Interventions provided'],
  ['next_steps', 'Next steps'], ['notes', 'Social worker notes'],
];

const OUTCOMES = ['Successfully transitioned', 'Transitioned with ongoing support', 'Returned to care', 'Lost contact', 'Other'];

/** Reminder windows (days). */
const REMIND = { assessmentOverdueDays: 14, taskDueSoonDays: 3, dischargeSoonDays: 7, planIncompleteDays: 14, followUpDueDays: 3 };

module.exports = {
  STAGES, RATINGS, OVERALL, CATEGORIES, ITEM_KEYS, CATEGORY_OF, CHILD_VOICE, MEETING_TYPES, PARTICIPANT_ROLES, RECOMMENDATIONS,
  PATHWAYS, DECISIONS, APPROVED, TASK_STATUSES, PRIORITIES, STANDARD_TASKS, PREPARATION, DESTINATIONS, FOLLOWUPS, CONTACT_TYPES,
  VISIT_FIELDS, OUTCOMES, REMIND,
};
