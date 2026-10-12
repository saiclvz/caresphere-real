-- Migration 029 - the adoption case in 17 stages (staff case page stepper)
--
-- Adds only adoption-specific records. Children, users, documents, notes, notifications and the audit log
-- are the existing tables; every record here points to an existing application (and child) by its key.
-- * tbl_adoption_stage_records: one record per case and stage (forum, PAP application, assessment and home
--   study, placement, petition and appearance, RACCO review, NACC decision, Order, Certificate of Finality,
--   civil identity, civil registration). The answers are stored encrypted.
-- * tbl_adoption_stage_entries: repeated records (placement monitoring visits, post-adoption follow-ups).
--   Append-only: a correction is a new entry.
-- * tbl_child_adoption_eligibility: the child's adoption eligibility, one per existing child.
-- * tbl_adoption_record_versions: every saved version of a record (history is never overwritten).
-- * tbl_adoption_stage_events: the case timeline (append-only).
-- * tbl_adoption_applications: who opened a walk-in case, and the existing child the case is for.
-- * tbl_adoption_matches: the matching recommendation type.
-- No existing data is changed or deleted. Safe to run more than once.
-- Rollback: database/rollback/029_adoption_stages_rollback.sql
USE caresphere_db;

ALTER TABLE tbl_adoption_applications
  ADD COLUMN IF NOT EXISTS created_by_staff INT NULL,
  ADD COLUMN IF NOT EXISTS target_child_id  VARCHAR(50) NULL;
ALTER TABLE tbl_adoption_applications
  ADD CONSTRAINT fk_adoption_target_child FOREIGN KEY IF NOT EXISTS (target_child_id) REFERENCES tbl_children(child_id),
  ADD CONSTRAINT fk_adoption_created_by_staff FOREIGN KEY IF NOT EXISTS (created_by_staff) REFERENCES tbl_users(user_id);

ALTER TABLE tbl_adoption_matches
  ADD COLUMN IF NOT EXISTS recommendation_type ENUM('Potential match', 'Not recommended', 'Further assessment') NULL AFTER status;

CREATE TABLE IF NOT EXISTS tbl_adoption_stage_records (
    record_id       INT AUTO_INCREMENT PRIMARY KEY,
    application_id  INT NOT NULL,
    stage_key       VARCHAR(30) NOT NULL,
    data_enc        MEDIUMTEXT NOT NULL COMMENT 'AES-256-GCM ciphertext (JSON answers)',
    result          VARCHAR(60) NULL COMMENT 'the outcome field (result, recommendation or decision), for checks',
    updated_by      INT NOT NULL,
    created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uq_stage_record (application_id, stage_key),
    CONSTRAINT fk_stage_record_app FOREIGN KEY (application_id) REFERENCES tbl_adoption_applications(application_id),
    CONSTRAINT fk_stage_record_user FOREIGN KEY (updated_by) REFERENCES tbl_users(user_id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS tbl_adoption_stage_entries (
    entry_id        INT AUTO_INCREMENT PRIMARY KEY,
    application_id  INT NOT NULL,
    stage_key       VARCHAR(30) NOT NULL,
    kind            VARCHAR(20) NOT NULL,
    round_label     VARCHAR(30) NULL COMMENT 'post-adoption follow-up round (one each); NULL for visits',
    entry_date      DATE NOT NULL,
    data_enc        MEDIUMTEXT NOT NULL COMMENT 'AES-256-GCM ciphertext (JSON answers)',
    created_by      INT NOT NULL,
    created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uq_stage_entry_round (application_id, stage_key, round_label),
    INDEX idx_stage_entries (application_id, stage_key),
    CONSTRAINT fk_stage_entry_app FOREIGN KEY (application_id) REFERENCES tbl_adoption_applications(application_id),
    CONSTRAINT fk_stage_entry_user FOREIGN KEY (created_by) REFERENCES tbl_users(user_id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS tbl_child_adoption_eligibility (
    child_id        VARCHAR(50) PRIMARY KEY,
    status          ENUM('Pending', 'Eligible', 'Eligible with conditions', 'Further assessment required', 'Not eligible') NOT NULL DEFAULT 'Pending',
    data_enc        MEDIUMTEXT NOT NULL COMMENT 'AES-256-GCM ciphertext (JSON answers)',
    updated_by      INT NOT NULL,
    updated_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT fk_child_eligibility_child FOREIGN KEY (child_id) REFERENCES tbl_children(child_id),
    CONSTRAINT fk_child_eligibility_user FOREIGN KEY (updated_by) REFERENCES tbl_users(user_id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS tbl_adoption_record_versions (
    version_id      INT AUTO_INCREMENT PRIMARY KEY,
    scope           ENUM('stage', 'eligibility') NOT NULL,
    application_id  INT NULL,
    child_id        VARCHAR(50) NULL,
    stage_key       VARCHAR(30) NULL,
    data_enc        MEDIUMTEXT NOT NULL,
    saved_by        INT NOT NULL,
    saved_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_record_versions_app (application_id, stage_key),
    INDEX idx_record_versions_child (child_id),
    CONSTRAINT fk_record_versions_app FOREIGN KEY (application_id) REFERENCES tbl_adoption_applications(application_id),
    CONSTRAINT fk_record_versions_child FOREIGN KEY (child_id) REFERENCES tbl_children(child_id),
    CONSTRAINT fk_record_versions_user FOREIGN KEY (saved_by) REFERENCES tbl_users(user_id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS tbl_adoption_stage_events (
    event_id        INT AUTO_INCREMENT PRIMARY KEY,
    application_id  INT NOT NULL,
    stage_key       VARCHAR(30) NOT NULL,
    action          VARCHAR(40) NOT NULL,
    summary         VARCHAR(255) NOT NULL COMMENT 'plain wording, no names or sensitive values',
    actor_id        INT NULL,
    created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_stage_events (application_id, created_at),
    CONSTRAINT fk_stage_events_app FOREIGN KEY (application_id) REFERENCES tbl_adoption_applications(application_id)
) ENGINE=InnoDB;
