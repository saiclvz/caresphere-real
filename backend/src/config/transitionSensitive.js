/**
 * Transition Review (18+): what Staff may see. Sensitive sections are sent only to Admin, or to the
 * child's assigned case worker during an unlock session (purpose + QR + single-use Token ID).
 * `fields` lists the review/child fields each section holds. Edit `sensitive` to change locking.
 * While locked, Staff get only the case number, age, flagged date, status and a masked name.
 */
const TRANSITION_SECTIONS = [
  { key: 'child_information', label: 'Child information', sensitive: true, fields: ['full_name', 'gender', 'dob', 'child_status'] },
  { key: 'educational_skills', label: 'Educational skills', sensitive: true, fields: ['education_goal', 'vocational_goal'] },
  { key: 'documents', label: 'Documents', sensitive: true, fields: [] },
  { key: 'exit_plan', label: 'Exit plan from the welfare home', sensitive: true, fields: ['housing_goal'] },
  { key: 'staff_remarks', label: 'Staff remarks', sensitive: true, fields: ['updated_by_name', 'updated_at'] },
  { key: 'goals_notes', label: 'Goals and case notes', sensitive: true, fields: ['notes'] },
  { key: 'data_rights', label: 'Young person informed of this review and their data rights', sensitive: true, fields: ['informed_at', 'informed_by'] },
];

module.exports = { TRANSITION_SECTIONS, LOCKED_TRANSITION: TRANSITION_SECTIONS.filter((s) => s.sensitive) };
