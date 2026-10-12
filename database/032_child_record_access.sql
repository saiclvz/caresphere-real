-- Migration 032 - Three-level access to child records (Directory, Core record, Highly sensitive)
--
-- Adds only new tables and settings. Nothing existing is changed or deleted:
-- * tbl_record_assignments: ONE assignment list for children, adoption applications and transition reviews
--   (primary case worker, backup, temporary cover with start and end dates). Rows are never deleted: ending an
--   assignment sets ended_at. The existing assigned_staff_id columns stay and keep showing the active primary.
-- * tbl_child_initial_access: the registering Staff member's temporary core access (7 days by default).
-- * tbl_child_access_requests: "Request access" from a locked child page, and Admin's decision.
-- * tbl_emergency_access: break-glass access to the Care card (30 minutes by default) and Admin's review.
-- * tbl_monitoring_sessions (+ _records): read-only monitoring visits (NACC, DSWD, other reviewers).
-- * tbl_care_cards: the minimum-necessary daily care information (encrypted at rest).
-- * tbl_child_field_levels: which level each field and section belongs to (seeded below; easy to extend).
-- * tbl_child_access_shadow: "Would be blocked" counts while the rollout mode is Log only.
-- * tbl_reassignment_flags: records marked "needs reassignment" (deactivated account, lost duty, ended cover).
-- * tbl_privacy_concerns: "Report a privacy concern" from Staff.
-- Deleting a child (Admin, only when it has no history to keep) also removes its assignments, Care card and
-- initial-access row; emergency access, access requests and monitoring visits count as history and block it.
-- Existing case workers become primary assignments only when you run scripts/migrateChildAccess.js (reviewable,
-- dry run by default). Until then the old assigned_staff_id still counts, so nobody loses access.
-- Safe to run more than once. Rollback: database/rollback/032_child_record_access_rollback.sql
USE caresphere_db;

CREATE TABLE IF NOT EXISTS tbl_record_assignments (
    assignment_id   INT AUTO_INCREMENT PRIMARY KEY,
    record_type     ENUM('child', 'adoption_application', 'transition_review') NOT NULL,
    record_id       VARCHAR(50) NOT NULL COMMENT 'child_id, application_id or review_id as text',
    child_id        VARCHAR(50) NULL,
    application_id  INT NULL,
    review_id       INT NULL,
    user_id         INT NOT NULL,
    assignment_type ENUM('primary', 'backup', 'temporary') NOT NULL DEFAULT 'primary',
    starts_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    ends_at         DATETIME NULL COMMENT 'required for temporary cover',
    assigned_by     INT NULL COMMENT 'NULL = automatic (default case worker, migration)',
    assigned_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    source          ENUM('admin', 'default_case_worker', 'migration', 'access_request') NOT NULL DEFAULT 'admin',
    note            VARCHAR(255) NULL,
    ended_at        DATETIME NULL,
    ended_by        INT NULL,
    end_reason      VARCHAR(40) NULL COMMENT 'reassigned, unassigned, cover_ended, account_deactivated, duty_removed',
    INDEX idx_ra_record (record_type, record_id, ended_at),
    INDEX idx_ra_user (user_id, ended_at),
    INDEX idx_ra_ends (assignment_type, ends_at),
    CONSTRAINT fk_ra_child FOREIGN KEY (child_id) REFERENCES tbl_children(child_id) ON DELETE CASCADE,
    CONSTRAINT fk_ra_application FOREIGN KEY (application_id) REFERENCES tbl_adoption_applications(application_id),
    CONSTRAINT fk_ra_review FOREIGN KEY (review_id) REFERENCES tbl_transition_reviews(review_id),
    CONSTRAINT fk_ra_user FOREIGN KEY (user_id) REFERENCES tbl_users(user_id),
    CONSTRAINT fk_ra_assigned_by FOREIGN KEY (assigned_by) REFERENCES tbl_users(user_id),
    CONSTRAINT fk_ra_ended_by FOREIGN KEY (ended_by) REFERENCES tbl_users(user_id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS tbl_child_initial_access (
    child_id    VARCHAR(50) PRIMARY KEY,
    user_id     INT NOT NULL,
    starts_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    ends_at     DATETIME NOT NULL,
    ended_at    DATETIME NULL,
    end_reason  VARCHAR(40) NULL COMMENT 'expired, case_worker_assigned, intake_complete, account_deactivated',
    INDEX idx_cia_user (user_id, ended_at),
    CONSTRAINT fk_cia_child FOREIGN KEY (child_id) REFERENCES tbl_children(child_id) ON DELETE CASCADE,
    CONSTRAINT fk_cia_user FOREIGN KEY (user_id) REFERENCES tbl_users(user_id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS tbl_child_access_requests (
    request_id    INT AUTO_INCREMENT PRIMARY KEY,
    child_id      VARCHAR(50) NOT NULL,
    requested_by  INT NOT NULL,
    reason_enc    TEXT NOT NULL COMMENT 'AES-256-GCM ciphertext',
    status        ENUM('Pending', 'Approved', 'Denied', 'Withdrawn') NOT NULL DEFAULT 'Pending',
    decision      ENUM('assigned', 'temporary_cover', 'denied') NULL,
    decided_by    INT NULL,
    decided_at    DATETIME NULL,
    decision_note VARCHAR(500) NULL,
    assignment_id INT NULL,
    created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_car_child (child_id, status),
    INDEX idx_car_user (requested_by, status),
    CONSTRAINT fk_car_child FOREIGN KEY (child_id) REFERENCES tbl_children(child_id),
    CONSTRAINT fk_car_user FOREIGN KEY (requested_by) REFERENCES tbl_users(user_id),
    CONSTRAINT fk_car_decider FOREIGN KEY (decided_by) REFERENCES tbl_users(user_id),
    CONSTRAINT fk_car_assignment FOREIGN KEY (assignment_id) REFERENCES tbl_record_assignments(assignment_id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS tbl_emergency_access (
    emergency_id  INT AUTO_INCREMENT PRIMARY KEY,
    child_id      VARCHAR(50) NOT NULL,
    user_id       INT NOT NULL,
    reason        ENUM('Medical emergency', 'Missing or injured child', 'Covering the shift', 'Other') NOT NULL,
    note_enc      TEXT NULL COMMENT 'AES-256-GCM ciphertext',
    started_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    expires_at    DATETIME NOT NULL,
    ended_at      DATETIME NULL,
    reviewed_by   INT NULL,
    reviewed_at   DATETIME NULL,
    result        ENUM('Justified', 'Not justified') NULL,
    review_note   VARCHAR(500) NULL,
    INDEX idx_ea_child (child_id, expires_at),
    INDEX idx_ea_user (user_id, started_at),
    INDEX idx_ea_review (result, started_at),
    CONSTRAINT fk_ea_child FOREIGN KEY (child_id) REFERENCES tbl_children(child_id),
    CONSTRAINT fk_ea_user FOREIGN KEY (user_id) REFERENCES tbl_users(user_id),
    CONSTRAINT fk_ea_reviewer FOREIGN KEY (reviewed_by) REFERENCES tbl_users(user_id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS tbl_monitoring_sessions (
    monitoring_id  INT AUTO_INCREMENT PRIMARY KEY,
    admin_id       INT NOT NULL,
    reviewer_name  VARCHAR(150) NOT NULL,
    reviewer_org   VARCHAR(60) NOT NULL,
    session_jti    VARCHAR(64) NULL COMMENT 'the Admin sign-in it belongs to',
    started_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    expires_at     DATETIME NOT NULL,
    ended_at       DATETIME NULL,
    end_reason     VARCHAR(30) NULL COMMENT 'ended, expired, signed_out',
    INDEX idx_ms_admin (admin_id, ended_at),
    CONSTRAINT fk_ms_admin FOREIGN KEY (admin_id) REFERENCES tbl_users(user_id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS tbl_monitoring_records (
    monitoring_id  INT NOT NULL,
    child_id       VARCHAR(50) NOT NULL,
    first_opened_at DATETIME NULL,
    open_count     INT NOT NULL DEFAULT 0,
    PRIMARY KEY (monitoring_id, child_id),
    INDEX idx_mr_child (child_id),
    CONSTRAINT fk_mr_session FOREIGN KEY (monitoring_id) REFERENCES tbl_monitoring_sessions(monitoring_id),
    CONSTRAINT fk_mr_child FOREIGN KEY (child_id) REFERENCES tbl_children(child_id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS tbl_care_cards (
    child_id               VARCHAR(50) PRIMARY KEY,
    allergies_enc          TEXT NULL COMMENT 'AES-256-GCM ciphertext',
    dietary_enc            TEXT NULL,
    daily_medications_enc  TEXT NULL COMMENT 'medications given daily, with the schedule',
    emergency_contact_enc  TEXT NULL,
    routine_notes_enc      TEXT NULL,
    special_needs_enc      TEXT NULL,
    last_reviewed_at       DATETIME NULL,
    last_reviewed_by       INT NULL,
    updated_at             DATETIME NULL,
    updated_by             INT NULL,
    review_reminded_at     DATETIME NULL,
    CONSTRAINT fk_cc_child FOREIGN KEY (child_id) REFERENCES tbl_children(child_id) ON DELETE CASCADE,
    CONSTRAINT fk_cc_reviewer FOREIGN KEY (last_reviewed_by) REFERENCES tbl_users(user_id),
    CONSTRAINT fk_cc_updater FOREIGN KEY (updated_by) REFERENCES tbl_users(user_id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS tbl_child_field_levels (
    field_key   VARCHAR(60) PRIMARY KEY,
    section     VARCHAR(30) NOT NULL,
    level       ENUM('directory', 'care_card', 'core', 'sensitive') NOT NULL,
    label       VARCHAR(100) NOT NULL
) ENGINE=InnoDB;

-- Seed (INSERT IGNORE: a level you changed by hand is kept). A new field: add a row here and in
-- backend/src/config/childRecordLevels.js (the code falls back to that file when a row is missing).
INSERT IGNORE INTO tbl_child_field_levels (field_key, section, level, label) VALUES
  ('child_id', 'overview', 'directory', 'Case number'),
  ('display_name', 'overview', 'directory', 'First name and last initial'),
  ('status', 'overview', 'directory', 'Status'),
  ('case_worker', 'overview', 'directory', 'Assigned case worker'),
  ('created_at', 'overview', 'directory', 'Date added'),
  ('updated_at', 'overview', 'directory', 'Last activity'),
  ('photo', 'care_card', 'care_card', 'Photo (identification)'),
  ('allergies', 'care_card', 'care_card', 'Allergies'),
  ('dietary', 'care_card', 'care_card', 'Dietary restrictions'),
  ('daily_medications', 'care_card', 'care_card', 'Daily medications and schedule'),
  ('emergency_contact', 'care_card', 'care_card', 'Emergency contact'),
  ('routine_notes', 'care_card', 'care_card', 'Daily routine notes'),
  ('special_needs', 'care_card', 'care_card', 'Special care needs'),
  ('first_name', 'profile', 'core', 'First name'),
  ('last_name', 'profile', 'core', 'Last name'),
  ('full_name', 'profile', 'core', 'Full name'),
  ('dob', 'profile', 'core', 'Date of birth'),
  ('age', 'profile', 'core', 'Age'),
  ('gender', 'profile', 'core', 'Gender'),
  ('admission_date', 'profile', 'core', 'Admission date'),
  ('urgent_needs', 'profile', 'core', 'Needs donors can see'),
  ('public_bio', 'profile', 'core', 'Public bio'),
  ('is_public', 'profile', 'core', 'Shown on donor portal'),
  ('available_for_adoption', 'profile', 'core', 'Available for adoption'),
  ('placement_status', 'case_files', 'core', 'Placement status'),
  ('guardian_family_info', 'case_files', 'core', 'Family and guardian information'),
  ('background_care_info', 'case_files', 'core', 'Background and care information'),
  ('discharge_history', 'case_files', 'core', 'Placement and discharge history'),
  ('transition_flag', 'profile', 'core', 'Transition Review flag (18+)'),
  ('health', 'health', 'sensitive', 'Health records'),
  ('medical_documents', 'health', 'sensitive', 'Medical and psychological documents'),
  ('adoption', 'adoption', 'sensitive', 'Adoption records'),
  ('cdclaa', 'adoption', 'sensitive', 'CDCLAA and sealed records'),
  ('transition', 'transition', 'sensitive', 'Transition Review');

CREATE TABLE IF NOT EXISTS tbl_child_access_shadow (
    user_id      INT NOT NULL,
    child_id     VARCHAR(50) NOT NULL,
    level        VARCHAR(20) NOT NULL COMMENT 'care_card, core, ... what would have been refused',
    day          DATE NOT NULL,
    hits         INT NOT NULL DEFAULT 1,
    last_action  VARCHAR(80) NULL,
    last_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id, child_id, level, day),
    INDEX idx_cas_child (child_id),
    CONSTRAINT fk_cas_user FOREIGN KEY (user_id) REFERENCES tbl_users(user_id),
    CONSTRAINT fk_cas_child FOREIGN KEY (child_id) REFERENCES tbl_children(child_id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS tbl_reassignment_flags (
    flag_id      INT AUTO_INCREMENT PRIMARY KEY,
    record_type  ENUM('child', 'adoption_application', 'transition_review') NOT NULL,
    record_id    VARCHAR(50) NOT NULL,
    user_id      INT NULL COMMENT 'the staff member who lost access',
    reason       VARCHAR(40) NOT NULL COMMENT 'account_deactivated, duty_removed, unassigned, cover_ended, no_case_worker',
    flagged_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    cleared_at   DATETIME NULL,
    cleared_by   INT NULL,
    INDEX idx_rf_record (record_type, record_id, cleared_at),
    INDEX idx_rf_user (user_id),
    CONSTRAINT fk_rf_user FOREIGN KEY (user_id) REFERENCES tbl_users(user_id),
    CONSTRAINT fk_rf_cleared FOREIGN KEY (cleared_by) REFERENCES tbl_users(user_id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS tbl_privacy_concerns (
    concern_id   INT AUTO_INCREMENT PRIMARY KEY,
    reported_by  INT NOT NULL,
    topic        VARCHAR(60) NOT NULL,
    details_enc  TEXT NOT NULL COMMENT 'AES-256-GCM ciphertext',
    status       ENUM('Open', 'Reviewed') NOT NULL DEFAULT 'Open',
    created_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    reviewed_by  INT NULL,
    reviewed_at  DATETIME NULL,
    INDEX idx_pc_status (status, created_at),
    CONSTRAINT fk_pc_user FOREIGN KEY (reported_by) REFERENCES tbl_users(user_id),
    CONSTRAINT fk_pc_reviewer FOREIGN KEY (reviewed_by) REFERENCES tbl_users(user_id)
) ENGINE=InnoDB;

-- Settings (INSERT IGNORE keeps a value you already changed). The rollout starts in "Log only".
INSERT IGNORE INTO tbl_settings (setting_key, setting_value) VALUES
  ('child_access_mode', 'log_only'),
  ('child_initial_access_days', '7'),
  ('child_emergency_minutes', '30'),
  ('child_emergency_uses_per_day', '3'),
  ('child_care_card_visibility', 'children_duty'),
  ('child_care_card_review_days', '90'),
  ('child_default_case_worker_id', '');
