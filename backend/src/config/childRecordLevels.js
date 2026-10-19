/**
 * Child record access levels. ONE place maps every field and page section to a level; the server's policy
 * (services/childAccess.js) uses it to decide what it sends, so the browser never receives a locked field.
 * The database copy (tbl_child_field_levels, seeded by migration 032) wins when it has a row for the field;
 * this file is the fallback, so a new field only needs a line here (and optionally a row in the table).
 *
 *   directory  Level 1: case number, first name + last initial, status, case worker, dates. Admin and Staff with
 *              the Children duty. Used for lists, search, meals and routines, and the duplicate check.
 *   care_card  Part of level 1 access: the minimum needed for daily care (setting: Staff with the Children duty,
 *              or Staff on shift only). Edited only by the assigned case worker and Admin.
 *   core       Level 2: full name, date of birth, family and guardian, background and care, case files,
 *              placement history. Admin, the assigned case worker (primary, backup, temporary cover), and the
 *              registering Staff member during the initial window.
 *   sensitive  Level 3: health, medical and psychological documents, adoption, Transition Review. Admin (no token)
 *              and assigned Staff through the existing purpose step + QR token + 3-minute session.
 */
const LEVELS = ['directory', 'care_card', 'core', 'sensitive'];
const RANK = { none: 0, directory: 1, care_card: 2, core: 3, sensitive: 4 };

const FIELDS = {
  child_id: 'directory', display_name: 'directory', status: 'directory', admission_status: 'directory', case_worker: 'directory', created_at: 'directory', updated_at: 'directory',
  photo: 'care_card', allergies: 'care_card', dietary: 'care_card', daily_medications: 'care_card', emergency_contact: 'care_card',
  routine_notes: 'care_card', special_needs: 'care_card',
  first_name: 'core', last_name: 'core', full_name: 'core', dob: 'core', age: 'core', gender: 'core', admission_date: 'core',
  urgent_needs: 'core', public_bio: 'core', is_public: 'core', available_for_adoption: 'core', placement_status: 'core',
  guardian_family_info: 'core', background_care_info: 'core', discharge_history: 'core', transition_flag: 'core',
  admission_referral: 'core', admission_family: 'core', admission_documents: 'core',
  health: 'sensitive', medical_documents: 'sensitive', admission_medical_documents: 'sensitive', adoption: 'sensitive', cdclaa: 'sensitive', transition: 'sensitive',
};

/** Page sections (tabs) and the level each needs. "access" is Admin and the case worker only. */
const SECTIONS = {
  overview: 'directory', care_card: 'care_card', profile: 'core', case_files: 'core',
  health: 'sensitive', adoption: 'sensitive', transition: 'sensitive', access: 'case_worker',
};

/** Columns of tbl_children that belong to each level when a row is shaped for a viewer. */
const ROW_FIELDS = {
  directory: ['child_id', 'status', 'admission_status', 'created_at', 'updated_at', 'assigned_staff_id', 'assigned_staff_name'],
  care_card: ['has_photo', 'profile_photo_url'],
  core: ['first_name', 'last_name', 'full_name', 'gender', 'dob', 'age', 'admission_date', 'urgent_needs', 'public_bio', 'is_public',
    'available_for_adoption', 'placement_status', 'transition_flag', 'transition_status', 'transition_review_id', 'cdclaa_verified',
    'cdclaa_verified_at', 'cdclaa_number', 'cdclaa_date', 'public_ref', 'has_health_record', 'discharge_history'],
};

const ASSIGNMENT_TYPES = { primary: 'Primary case worker', backup: 'Backup', temporary: 'Temporary cover' };
const MONITORING_ORGS = ['NACC', 'DSWD', 'Other'];
const PRIVACY_TOPICS = ['Someone saw a record they should not have', 'A record was shared or printed', 'Wrong access or a missing lock', 'Other'];
const DENIED = 'ACCESS DENIED – You are not authorized to view this information.';

/** Settings (tbl_settings), with defaults and limits. Changed only by Admin; every change logged with old and new values. */
const SETTINGS = {
  child_access_mode: { def: 'log_only', options: ['log_only', 'enforce'], label: 'Rollout mode' },
  child_care_card_visibility: { def: 'children_duty', options: ['children_duty', 'on_shift'], label: 'Care card visible to' },
  child_care_card_review_days: { def: 90, min: 7, max: 365, label: 'Care card review reminder (days)' },
  child_default_case_worker_id: { def: '', label: 'Default case worker' },
  // Admission (migration 036)
  admission_required_documents: { def: 'referral_letter,birth_certificate', label: 'Required admission documents', list: true },
  admission_stale_draft_days: { def: 30, min: 3, max: 365, label: 'Unfinished admission flagged after (days)' },
};

module.exports = { LEVELS, RANK, FIELDS, SECTIONS, ROW_FIELDS, ASSIGNMENT_TYPES, MONITORING_ORGS, PRIVACY_TOPICS, DENIED, SETTINGS };
