-- Migration 010 - Adoption under RA 11642: stages, CDCLAA, placement, security and privacy
--
-- BACK UP FIRST: phpMyAdmin > caresphere_db > Export > Quick > SQL > Go.
-- The first run also copies the adoption tables into *_backup_v3 tables.
--
-- Status mapping from the v3 workflow (old v2 data is converted by 009 first):
--   Submitted -> Submitted, Under review -> Submitted, Interview scheduled -> Home study scheduled,
--   Documents requested -> Documents requested, Approved -> Cleared for matching,
--   Approved + finalized -> Order of Adoption issued (finalized), Declined / Withdrawn / Draft unchanged.
-- Every existing application becomes type Regular.
--
-- Also adds: CDCLAA fields and placement status on children (status stays Active so
-- donation features are unaffected), sealed birth records, protected records with
-- access tokens, confidentiality undertakings, release of information, data subject
-- requests, a security incident log, security events, document SHA-256 hashes,
-- per-account login lockout, idle-session tracking, and triggers that make the audit
-- log and security events impossible to edit or delete.
--
-- Safe to run any number of times (npm run migrate re-runs every file).
-- After the SQL files, `npm run migrate` also encrypts sensitive applicant fields
-- (scripts/encryptAdoptionData.js).
-- Rollback: database/rollback/010_adoption_ra11642_rollback.sql
USE caresphere_db;

DROP PROCEDURE IF EXISTS cs10_if_no_table;
CREATE PROCEDURE cs10_if_no_table(IN p_table VARCHAR(64), IN p_sql TEXT)
BEGIN
  DECLARE n INT DEFAULT 0;
  SELECT COUNT(*) INTO n FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = p_table;
  IF n = 0 THEN
    SET @cs_sql = p_sql;
    PREPARE cs_stmt FROM @cs_sql; EXECUTE cs_stmt; DEALLOCATE PREPARE cs_stmt;
  END IF;
END;

-- ---------------------------------------------------------------- 0. backups (first run only)
-- The marker: application_type does not exist yet.
DROP PROCEDURE IF EXISTS cs10_backup;
CREATE PROCEDURE cs10_backup()
BEGIN
  DECLARE n INT DEFAULT 0;
  SELECT COUNT(*) INTO n FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'tbl_adoption_applications' AND COLUMN_NAME = 'application_type';
  IF n = 0 THEN
    CREATE TABLE IF NOT EXISTS tbl_adoption_applications_backup_v3 LIKE tbl_adoption_applications;
    INSERT IGNORE INTO tbl_adoption_applications_backup_v3 SELECT * FROM tbl_adoption_applications;
    CREATE TABLE IF NOT EXISTS tbl_applicant_details_backup_v3 LIKE tbl_applicant_details;
    INSERT IGNORE INTO tbl_applicant_details_backup_v3 SELECT * FROM tbl_applicant_details;
    CREATE TABLE IF NOT EXISTS tbl_household_members_backup_v3 LIKE tbl_household_members;
    INSERT IGNORE INTO tbl_household_members_backup_v3 SELECT * FROM tbl_household_members;
    CREATE TABLE IF NOT EXISTS tbl_applicant_spouse_backup_v3 LIKE tbl_applicant_spouse;
    INSERT IGNORE INTO tbl_applicant_spouse_backup_v3 SELECT * FROM tbl_applicant_spouse;
    CREATE TABLE IF NOT EXISTS tbl_adoption_documents_backup_v3 LIKE tbl_adoption_documents;
    INSERT IGNORE INTO tbl_adoption_documents_backup_v3 SELECT * FROM tbl_adoption_documents;
  END IF;
END;
CALL cs10_backup();
DROP PROCEDURE IF EXISTS cs10_backup;

-- ---------------------------------------------------------------- 1. applications: type, stages, dates
ALTER TABLE tbl_adoption_applications
  ADD COLUMN IF NOT EXISTS application_type ENUM('Regular', 'Relative') NOT NULL DEFAULT 'Regular' AFTER applicant_id,
  ADD COLUMN IF NOT EXISTS forum_verified_at DATETIME NULL,
  ADD COLUMN IF NOT EXISTS case_study_completed_at DATETIME NULL,
  ADD COLUMN IF NOT EXISTS cleared_at DATETIME NULL,
  ADD COLUMN IF NOT EXISTS matched_at DATETIME NULL,
  ADD COLUMN IF NOT EXISTS trial_start DATE NULL,
  ADD COLUMN IF NOT EXISTS trial_end DATE NULL,
  ADD COLUMN IF NOT EXISTS trial_completed_at DATETIME NULL,
  ADD COLUMN IF NOT EXISTS placement_ended_at DATETIME NULL,
  ADD COLUMN IF NOT EXISTS petition_date DATE NULL,
  ADD COLUMN IF NOT EXISTS racco_office VARCHAR(150) NULL,
  ADD COLUMN IF NOT EXISTS published_at DATETIME NULL,
  ADD COLUMN IF NOT EXISTS appearance_date DATE NULL,
  ADD COLUMN IF NOT EXISTS endorsed_date DATE NULL,
  ADD COLUMN IF NOT EXISTS nacc_deadline DATE NULL,
  ADD COLUMN IF NOT EXISTS order_number VARCHAR(80) NULL,
  ADD COLUMN IF NOT EXISTS order_date DATE NULL,
  ADD COLUMN IF NOT EXISTS civil_registry_ref VARCHAR(120) NULL,
  ADD COLUMN IF NOT EXISTS closed_at DATETIME NULL,
  ADD COLUMN IF NOT EXISTS consent_version VARCHAR(30) NULL,
  ADD COLUMN IF NOT EXISTS privacy_notice_version VARCHAR(30) NULL,
  ADD COLUMN IF NOT EXISTS archived_at DATETIME NULL,
  ADD COLUMN IF NOT EXISTS archived_by INT NULL,
  ADD COLUMN IF NOT EXISTS archive_reason VARCHAR(500) NULL;

-- Encrypted text is longer than the plain value.
ALTER TABLE tbl_adoption_applications MODIFY COLUMN reason_for_adoption TEXT NULL;

-- v3 -> RA 11642 statuses
ALTER TABLE tbl_adoption_applications MODIFY COLUMN status VARCHAR(40) NOT NULL DEFAULT 'Draft';
UPDATE tbl_adoption_applications SET status = 'Submitted' WHERE status = 'Under review';
UPDATE tbl_adoption_applications SET status = 'Home study scheduled' WHERE status = 'Interview scheduled';
UPDATE tbl_adoption_applications SET status = 'Order of Adoption issued', order_date = COALESCE(order_date, DATE(finalized_at))
 WHERE status = 'Approved' AND finalized_at IS NOT NULL;
UPDATE tbl_adoption_applications SET status = 'Cleared for matching', cleared_at = COALESCE(cleared_at, decided_at, updated_at)
 WHERE status = 'Approved';
ALTER TABLE tbl_adoption_applications
  MODIFY COLUMN status ENUM(
    'Draft', 'Submitted', 'Documents requested', 'Forum attended', 'Home study scheduled', 'Case study completed',
    'Cleared for matching', 'Child matched', 'Trial custody', 'Trial custody completed', 'Placement ended',
    'Petition filed', 'Published', 'Mandatory appearance done', 'Endorsed to NACC', 'Awaiting NACC decision',
    'Order of Adoption issued', 'Civil registry updated', 'Closed', 'Declined', 'Withdrawn'
  ) NOT NULL DEFAULT 'Draft';
CREATE INDEX IF NOT EXISTS idx_adoption_trial_end ON tbl_adoption_applications (trial_end);
CREATE INDEX IF NOT EXISTS idx_adoption_nacc_deadline ON tbl_adoption_applications (nacc_deadline);
ALTER TABLE tbl_adoption_applications
  ADD CONSTRAINT fk_adoption_archived_by FOREIGN KEY IF NOT EXISTS (archived_by) REFERENCES tbl_users(user_id);

-- Interviews: home study visits use the existing table.
ALTER TABLE tbl_application_interviews MODIFY COLUMN kind ENUM('Interview', 'Home visit', 'Home study') NOT NULL;

-- ---------------------------------------------------------------- 2. applicant fields become encrypted text
ALTER TABLE tbl_applicant_details
  MODIFY COLUMN date_of_birth VARCHAR(255) NULL,
  MODIFY COLUMN contact_number VARCHAR(255) NULL,
  MODIFY COLUMN house_unit VARCHAR(512) NULL,
  MODIFY COLUMN street VARCHAR(512) NULL,
  MODIFY COLUMN subdivision VARCHAR(512) NULL,
  MODIFY COLUMN barangay VARCHAR(512) NULL,
  MODIFY COLUMN province VARCHAR(255) NULL,
  MODIFY COLUMN city VARCHAR(512) NULL,
  MODIFY COLUMN postal_code VARCHAR(255) NULL,
  MODIFY COLUMN id_type VARCHAR(255) NULL,
  MODIFY COLUMN id_type_other VARCHAR(512) NULL,
  MODIFY COLUMN living_conditions TEXT NULL,
  MODIFY COLUMN caregiving_experience TEXT NULL;
ALTER TABLE tbl_household_members
  MODIFY COLUMN full_name VARCHAR(512) NOT NULL,
  MODIFY COLUMN age VARCHAR(255) NULL,
  MODIFY COLUMN relationship VARCHAR(512) NOT NULL;

-- ---------------------------------------------------------------- 3. documents: SHA-256, stage documents
ALTER TABLE tbl_adoption_documents
  ADD COLUMN IF NOT EXISTS sha256 CHAR(64) NULL AFTER storage_key,
  MODIFY COLUMN page TINYINT UNSIGNED NULL;

-- ---------------------------------------------------------------- 4. children: CDCLAA, placement, sealed flag
ALTER TABLE tbl_children
  ADD COLUMN IF NOT EXISTS placement_status ENUM('None', 'Matched', 'Trial custody') NOT NULL DEFAULT 'None' AFTER available_for_adoption,
  ADD COLUMN IF NOT EXISTS cdclaa_number VARCHAR(80) NULL,
  ADD COLUMN IF NOT EXISTS cdclaa_date DATE NULL,
  ADD COLUMN IF NOT EXISTS cdclaa_storage_key VARCHAR(255) NULL,
  ADD COLUMN IF NOT EXISTS cdclaa_original_name VARCHAR(255) NULL,
  ADD COLUMN IF NOT EXISTS cdclaa_mime VARCHAR(100) NULL,
  ADD COLUMN IF NOT EXISTS cdclaa_size INT NULL,
  ADD COLUMN IF NOT EXISTS cdclaa_sha256 CHAR(64) NULL,
  ADD COLUMN IF NOT EXISTS cdclaa_recorded_by INT NULL,
  ADD COLUMN IF NOT EXISTS cdclaa_verified_at DATETIME NULL,
  ADD COLUMN IF NOT EXISTS cdclaa_verified_by INT NULL,
  ADD COLUMN IF NOT EXISTS original_birth_sealed BOOLEAN NOT NULL DEFAULT TRUE;
-- CDCLAA gate: a child stays "Available for adoption" only with a verified CDCLAA.
UPDATE tbl_children SET available_for_adoption = FALSE
 WHERE available_for_adoption = TRUE AND cdclaa_verified_at IS NULL;
-- Children already matched through an open application are placed.
UPDATE tbl_children c JOIN tbl_adoption_applications a ON a.matched_child_id = c.child_id
   SET c.placement_status = 'Matched'
 WHERE c.status = 'Active' AND c.placement_status = 'None' AND a.status IN ('Child matched', 'Trial custody', 'Trial custody completed');

CREATE TABLE IF NOT EXISTS tbl_sealed_records (
    sealed_id     INT AUTO_INCREMENT PRIMARY KEY,
    child_id      VARCHAR(50) NOT NULL,
    kind          ENUM('original_birth_certificate', 'natural_parents_identity') NOT NULL,
    original_name VARCHAR(255) NOT NULL,
    mime_type     VARCHAR(100) NOT NULL,
    size_bytes    INT NOT NULL,
    storage_key   VARCHAR(255) NOT NULL,
    sha256        CHAR(64) NOT NULL,
    uploaded_by   INT NOT NULL,
    uploaded_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_sealed_child (child_id),
    CONSTRAINT fk_sealed_child FOREIGN KEY (child_id) REFERENCES tbl_children(child_id) ON DELETE RESTRICT,
    CONSTRAINT fk_sealed_user FOREIGN KEY (uploaded_by) REFERENCES tbl_users(user_id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS tbl_sealed_access_log (
    access_id    INT AUTO_INCREMENT PRIMARY KEY,
    sealed_id    INT NOT NULL,
    child_id     VARCHAR(50) NOT NULL,
    user_id      INT NOT NULL,
    reason       VARCHAR(500) NOT NULL,
    order_number VARCHAR(80) NOT NULL,
    via_token    BOOLEAN NOT NULL DEFAULT FALSE,
    ip_address   VARCHAR(45) NULL,
    accessed_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_sealed_access (sealed_id, accessed_at),
    CONSTRAINT fk_sealed_access_record FOREIGN KEY (sealed_id) REFERENCES tbl_sealed_records(sealed_id),
    CONSTRAINT fk_sealed_access_user FOREIGN KEY (user_id) REFERENCES tbl_users(user_id)
) ENGINE=InnoDB;

-- ---------------------------------------------------------------- 5. protected records and tokens
CREATE TABLE IF NOT EXISTS tbl_protected_records (
    record_id      INT AUTO_INCREMENT PRIMARY KEY,
    public_id      CHAR(36) NOT NULL UNIQUE,     -- random UUID, the only thing inside the QR
    record_type    ENUM('case_study', 'monitoring_report', 'cdclaa', 'order_of_adoption', 'certificate_of_finality',
                        'sealed_birth_record', 'document') NOT NULL,
    label          VARCHAR(150) NOT NULL,        -- no personal data, e.g. "Social Case Study Report, ADP-2026-0003"
    application_id INT NULL,
    document_id    INT NULL,
    child_id       VARCHAR(50) NULL,
    sealed_id      INT NULL,
    allow_download BOOLEAN NOT NULL DEFAULT FALSE,
    created_by     INT NOT NULL,
    created_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uq_protected_document (document_id),
    UNIQUE KEY uq_protected_sealed (sealed_id),
    INDEX idx_protected_app (application_id),
    INDEX idx_protected_child (child_id),
    CONSTRAINT fk_protected_app FOREIGN KEY (application_id) REFERENCES tbl_adoption_applications(application_id),
    CONSTRAINT fk_protected_doc FOREIGN KEY (document_id) REFERENCES tbl_adoption_documents(document_id),
    CONSTRAINT fk_protected_child FOREIGN KEY (child_id) REFERENCES tbl_children(child_id),
    CONSTRAINT fk_protected_sealed FOREIGN KEY (sealed_id) REFERENCES tbl_sealed_records(sealed_id),
    CONSTRAINT fk_protected_user FOREIGN KEY (created_by) REFERENCES tbl_users(user_id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS tbl_protected_tokens (
    token_id        INT AUTO_INCREMENT PRIMARY KEY,
    token_hash      CHAR(64) NOT NULL,           -- SHA-256 of the token; the token itself is never stored
    record_id       INT NOT NULL,
    staff_user_id   INT NOT NULL,
    purpose         VARCHAR(500) NOT NULL,
    expires_at      DATETIME NOT NULL,
    max_uses        TINYINT UNSIGNED NOT NULL DEFAULT 3,
    uses            TINYINT UNSIGNED NOT NULL DEFAULT 0,
    failed_attempts TINYINT UNSIGNED NOT NULL DEFAULT 0,
    locked_at       DATETIME NULL,
    revoked_at      DATETIME NULL,
    revoked_by      INT NULL,
    issued_by       INT NOT NULL,
    created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_tokens_record_user (record_id, staff_user_id),
    CONSTRAINT fk_tokens_record FOREIGN KEY (record_id) REFERENCES tbl_protected_records(record_id),
    CONSTRAINT fk_tokens_staff FOREIGN KEY (staff_user_id) REFERENCES tbl_users(user_id),
    CONSTRAINT fk_tokens_issuer FOREIGN KEY (issued_by) REFERENCES tbl_users(user_id),
    CONSTRAINT fk_tokens_revoker FOREIGN KEY (revoked_by) REFERENCES tbl_users(user_id)
) ENGINE=InnoDB;

-- Short server-side access after a valid token (the token is never put in a URL).
CREATE TABLE IF NOT EXISTS tbl_protected_grants (
    grant_hash CHAR(64) PRIMARY KEY,
    token_id   INT NULL,                       -- NULL for an Admin opening a sealed record (no token)
    record_id  INT NOT NULL,
    user_id    INT NOT NULL,
    expires_at DATETIME NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_grants_expires (expires_at),
    CONSTRAINT fk_grants_token FOREIGN KEY (token_id) REFERENCES tbl_protected_tokens(token_id),
    CONSTRAINT fk_grants_record FOREIGN KEY (record_id) REFERENCES tbl_protected_records(record_id),
    CONSTRAINT fk_grants_user FOREIGN KEY (user_id) REFERENCES tbl_users(user_id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS tbl_protected_access_log (
    log_id     INT AUTO_INCREMENT PRIMARY KEY,
    event      ENUM('issued', 'used', 'failed', 'locked', 'expired', 'revoked', 'view', 'download') NOT NULL,
    record_id  INT NULL,
    token_id   INT NULL,
    user_id    INT NOT NULL,
    detail     VARCHAR(500) NULL,
    ip_address VARCHAR(45) NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_protected_log (created_at),
    INDEX idx_protected_log_record (record_id, created_at)
) ENGINE=InnoDB;

-- ---------------------------------------------------------------- 6. confidentiality, releases, privacy
CREATE TABLE IF NOT EXISTS tbl_confidentiality_undertakings (
    undertaking_id INT AUTO_INCREMENT PRIMARY KEY,
    user_id        INT NOT NULL,
    version        VARCHAR(30) NOT NULL,
    accepted_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    ip_address     VARCHAR(45) NULL,
    UNIQUE KEY uq_undertaking (user_id, version),
    CONSTRAINT fk_undertaking_user FOREIGN KEY (user_id) REFERENCES tbl_users(user_id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS tbl_information_releases (
    release_id         INT AUTO_INCREMENT PRIMARY KEY,
    application_id     INT NULL,
    child_id           VARCHAR(50) NULL,
    requester_name     VARCHAR(150) NOT NULL,
    requester_org      VARCHAR(150) NULL,
    purpose            VARCHAR(1000) NOT NULL,
    nacc_authorization VARCHAR(120) NOT NULL,
    released_items     VARCHAR(2000) NOT NULL,
    released_by        INT NOT NULL,
    ip_address         VARCHAR(45) NULL,
    released_at        TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_releases_app (application_id),
    CONSTRAINT fk_releases_app FOREIGN KEY (application_id) REFERENCES tbl_adoption_applications(application_id),
    CONSTRAINT fk_releases_child FOREIGN KEY (child_id) REFERENCES tbl_children(child_id),
    CONSTRAINT fk_releases_user FOREIGN KEY (released_by) REFERENCES tbl_users(user_id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS tbl_data_subject_requests (
    request_id     INT AUTO_INCREMENT PRIMARY KEY,
    user_id        INT NOT NULL,
    application_id INT NULL,
    kind           ENUM('Access', 'Correction') NOT NULL,
    details        VARCHAR(3000) NOT NULL,
    status         ENUM('Open', 'In progress', 'Resolved', 'Rejected') NOT NULL DEFAULT 'Open',
    response       VARCHAR(3000) NULL,
    created_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    resolved_at    DATETIME NULL,
    resolved_by    INT NULL,
    INDEX idx_dsr_status (status, created_at),
    CONSTRAINT fk_dsr_user FOREIGN KEY (user_id) REFERENCES tbl_users(user_id),
    CONSTRAINT fk_dsr_app FOREIGN KEY (application_id) REFERENCES tbl_adoption_applications(application_id),
    CONSTRAINT fk_dsr_resolver FOREIGN KEY (resolved_by) REFERENCES tbl_users(user_id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS tbl_security_incidents (
    incident_id          INT AUTO_INCREMENT PRIMARY KEY,
    occurred_at          DATETIME NULL,
    discovered_at        DATETIME NOT NULL,
    severity             ENUM('Low', 'Medium', 'High', 'Serious') NOT NULL,
    description          VARCHAR(3000) NOT NULL,
    affected             VARCHAR(1000) NULL,
    actions_taken        VARCHAR(3000) NULL,
    npc_notified_at      DATETIME NULL,
    subjects_notified_at DATETIME NULL,
    reported_by          INT NOT NULL,
    created_at           TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at           TIMESTAMP NULL DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT fk_incident_user FOREIGN KEY (reported_by) REFERENCES tbl_users(user_id)
) ENGINE=InnoDB;

INSERT IGNORE INTO tbl_settings (setting_key, setting_value) VALUES
  ('dpo_name', ''), ('dpo_email', ''), ('dpo_phone', '');

-- ---------------------------------------------------------------- 7. access security
ALTER TABLE tbl_users
  ADD COLUMN IF NOT EXISTS failed_logins TINYINT UNSIGNED NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS locked_until DATETIME NULL;

-- Failed logins and unauthorized access attempts (user may be unknown, so not in tbl_activity_logs).
CREATE TABLE IF NOT EXISTS tbl_security_events (
    event_id   INT AUTO_INCREMENT PRIMARY KEY,
    event_type VARCHAR(40) NOT NULL,
    user_id    INT NULL,
    email_hash CHAR(64) NULL,                  -- SHA-256 of the email typed, never the email itself
    detail     VARCHAR(500) NULL,
    ip_address VARCHAR(45) NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_security_events (created_at),
    INDEX idx_security_events_type (event_type, created_at)
) ENGINE=InnoDB;

-- Idle timeout: last request time per session (jti).
CREATE TABLE IF NOT EXISTS tbl_session_activity (
    jti        VARCHAR(64) PRIMARY KEY,
    user_id    INT NOT NULL,
    last_seen  DATETIME NOT NULL,
    INDEX idx_session_last_seen (last_seen)
) ENGINE=InnoDB;

-- ---------------------------------------------------------------- 8. audit log integrity (RA 8792)
ALTER TABLE tbl_activity_logs ADD COLUMN IF NOT EXISTS user_role VARCHAR(20) NULL AFTER user_id;

DROP TRIGGER IF EXISTS trg_activity_logs_no_update;
CREATE TRIGGER trg_activity_logs_no_update BEFORE UPDATE ON tbl_activity_logs FOR EACH ROW
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'The audit log cannot be edited.';
DROP TRIGGER IF EXISTS trg_activity_logs_no_delete;
CREATE TRIGGER trg_activity_logs_no_delete BEFORE DELETE ON tbl_activity_logs FOR EACH ROW
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'The audit log cannot be deleted.';
DROP TRIGGER IF EXISTS trg_security_events_no_update;
CREATE TRIGGER trg_security_events_no_update BEFORE UPDATE ON tbl_security_events FOR EACH ROW
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Security events cannot be edited.';
DROP TRIGGER IF EXISTS trg_security_events_no_delete;
CREATE TRIGGER trg_security_events_no_delete BEFORE DELETE ON tbl_security_events FOR EACH ROW
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Security events cannot be deleted.';
DROP TRIGGER IF EXISTS trg_protected_log_no_update;
CREATE TRIGGER trg_protected_log_no_update BEFORE UPDATE ON tbl_protected_access_log FOR EACH ROW
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'The protected access log cannot be edited.';
DROP TRIGGER IF EXISTS trg_protected_log_no_delete;
CREATE TRIGGER trg_protected_log_no_delete BEFORE DELETE ON tbl_protected_access_log FOR EACH ROW
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'The protected access log cannot be deleted.';
DROP TRIGGER IF EXISTS trg_sealed_log_no_update;
CREATE TRIGGER trg_sealed_log_no_update BEFORE UPDATE ON tbl_sealed_access_log FOR EACH ROW
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'The sealed record access log cannot be edited.';
DROP TRIGGER IF EXISTS trg_sealed_log_no_delete;
CREATE TRIGGER trg_sealed_log_no_delete BEFORE DELETE ON tbl_sealed_access_log FOR EACH ROW
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'The sealed record access log cannot be deleted.';
DROP TRIGGER IF EXISTS trg_releases_no_delete;
CREATE TRIGGER trg_releases_no_delete BEFORE DELETE ON tbl_information_releases FOR EACH ROW
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Release records cannot be deleted.';

-- Retention note (RA 10173, RA 11642 Sec. 39): adoption records are never hard-deleted by the
-- app. Finished applications can be archived (archived_at); they stay in the database and in
-- every backup. Deleting them, if ever lawful, is a documented manual decision by the DPO.

DROP PROCEDURE IF EXISTS cs10_if_no_table;
