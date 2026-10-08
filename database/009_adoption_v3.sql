-- Migration 009 - Adoption v3: 9-page application, drafts, staff workflow
--
-- BACK UP FIRST: phpMyAdmin > caresphere_db > Export > Quick > SQL > Go.
-- This file also copies the three current adoption tables into *_backup_v2 tables
-- the first time it runs, before anything is converted.
--
-- What it does (decisions 1 and 2):
--   * Statuses: Submitted -> Submitted, Under Review -> Under review,
--     Additional Documents Required -> Documents requested, Approved -> Approved,
--     Rejected -> Declined, Completed -> Approved + finalized (child already Adopted).
--     New statuses: Draft, Interview scheduled, Withdrawn.
--   * The old application's child becomes matched_child_id.
--   * Old identity fields move to tbl_applicant_details. Old single address,
--     employment and household fields move to legacy_* columns (read-only for staff).
--     Migrated applications are marked is_legacy and are not checked against the 9-page rules.
--   * Old review entries become status history. Their notes were shown to applicants
--     before, so they stay applicant-visible as "remark to applicant".
--   * Documents are kept (same encrypted files) and mapped to the new document types.
--
-- `npm run migrate` re-runs every file, so every step checks what is already done
-- and skips it. Safe to run any number of times.
-- Rollback: database/rollback/009_adoption_v3_rollback.sql
USE caresphere_db;

-- ---------------------------------------------------------------- helpers (dropped at the end)
DROP PROCEDURE IF EXISTS cs_if_column;
CREATE PROCEDURE cs_if_column(IN p_table VARCHAR(64), IN p_column VARCHAR(64), IN p_exists BOOLEAN, IN p_sql TEXT)
BEGIN
  DECLARE n INT DEFAULT 0;
  SELECT COUNT(*) INTO n FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = p_table AND COLUMN_NAME = p_column;
  IF (n > 0) = p_exists THEN
    SET @cs_sql = p_sql;
    PREPARE cs_stmt FROM @cs_sql; EXECUTE cs_stmt; DEALLOCATE PREPARE cs_stmt;
  END IF;
END;

DROP PROCEDURE IF EXISTS cs_if_no_table;
CREATE PROCEDURE cs_if_no_table(IN p_table VARCHAR(64), IN p_sql TEXT)
BEGIN
  DECLARE n INT DEFAULT 0;
  SELECT COUNT(*) INTO n FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = p_table;
  IF n = 0 THEN
    SET @cs_sql = p_sql;
    PREPARE cs_stmt FROM @cs_sql; EXECUTE cs_stmt; DEALLOCATE PREPARE cs_stmt;
  END IF;
END;

DROP PROCEDURE IF EXISTS cs_drop_fk_on;
CREATE PROCEDURE cs_drop_fk_on(IN p_table VARCHAR(64), IN p_column VARCHAR(64))
BEGIN
  DECLARE fk VARCHAR(64) DEFAULT NULL;
  SELECT CONSTRAINT_NAME INTO fk FROM information_schema.KEY_COLUMN_USAGE
   WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = p_table AND COLUMN_NAME = p_column
     AND REFERENCED_TABLE_NAME IS NOT NULL LIMIT 1;
  IF fk IS NOT NULL THEN
    SET @cs_sql = CONCAT('ALTER TABLE `', p_table, '` DROP FOREIGN KEY `', fk, '`');
    PREPARE cs_stmt FROM @cs_sql; EXECUTE cs_stmt; DEALLOCATE PREPARE cs_stmt;
  END IF;
END;

-- ---------------------------------------------------------------- 0. backups (first run only, before conversion)
CALL cs_if_no_table('tbl_adoption_applications_backup_v2',
  'CREATE TABLE tbl_adoption_applications_backup_v2 LIKE tbl_adoption_applications');
CALL cs_if_no_table('tbl_adoption_documents_backup_v2',
  'CREATE TABLE tbl_adoption_documents_backup_v2 LIKE tbl_adoption_documents');
CALL cs_if_no_table('tbl_adoption_reviews_backup_v2',
  'CREATE TABLE tbl_adoption_reviews_backup_v2 LIKE tbl_adoption_reviews');
-- Fill the backups only while the old shape is still there (legal_name exists only before conversion).
CALL cs_if_column('tbl_adoption_applications', 'legal_name', TRUE,
  'INSERT IGNORE INTO tbl_adoption_applications_backup_v2 SELECT * FROM tbl_adoption_applications');
CALL cs_if_column('tbl_adoption_applications', 'legal_name', TRUE,
  'INSERT IGNORE INTO tbl_adoption_documents_backup_v2 SELECT * FROM tbl_adoption_documents');
CALL cs_if_column('tbl_adoption_applications', 'legal_name', TRUE,
  'INSERT IGNORE INTO tbl_adoption_reviews_backup_v2 SELECT * FROM tbl_adoption_reviews');

-- ---------------------------------------------------------------- 1. new tables
CREATE TABLE IF NOT EXISTS tbl_applicant_details (
    application_id      INT PRIMARY KEY,
    legal_name          VARCHAR(150) NULL,
    date_of_birth       DATE NULL,
    contact_number      VARCHAR(30) NULL,
    email               VARCHAR(100) NULL,
    house_unit          VARCHAR(120) NULL,
    street              VARCHAR(120) NULL,
    subdivision         VARCHAR(120) NULL,
    barangay            VARCHAR(120) NULL,
    province            VARCHAR(60) NULL,
    city                VARCHAR(100) NULL,
    city_is_other       BOOLEAN NOT NULL DEFAULT FALSE,
    postal_code         CHAR(4) NULL,
    civil_status        VARCHAR(30) NULL,
    employment_status   VARCHAR(30) NULL,
    occupation          VARCHAR(150) NULL,
    employer            VARCHAR(150) NULL,
    position            VARCHAR(150) NULL,
    employment_length   VARCHAR(60) NULL,
    income_source       VARCHAR(40) NULL,
    housing             VARCHAR(40) NULL,
    living_conditions   TEXT NULL,
    caregiving_experience TEXT NULL,
    id_type             VARCHAR(40) NULL,
    id_type_other       VARCHAR(100) NULL,
    updated_at          TIMESTAMP NULL DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT fk_applicant_details_app FOREIGN KEY (application_id) REFERENCES tbl_adoption_applications(application_id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS tbl_applicant_spouse (
    application_id INT PRIMARY KEY,
    details        TEXT NULL,
    CONSTRAINT fk_applicant_spouse_app FOREIGN KEY (application_id) REFERENCES tbl_adoption_applications(application_id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS tbl_household_members (
    member_id      INT AUTO_INCREMENT PRIMARY KEY,
    application_id INT NOT NULL,
    full_name      VARCHAR(150) NOT NULL,
    age            TINYINT UNSIGNED NULL,
    relationship   VARCHAR(60) NOT NULL,
    sort_order     TINYINT UNSIGNED NOT NULL DEFAULT 0,
    INDEX idx_household_app (application_id, sort_order),
    CONSTRAINT fk_household_app FOREIGN KEY (application_id) REFERENCES tbl_adoption_applications(application_id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS tbl_application_status_history (
    history_id          INT AUTO_INCREMENT PRIMARY KEY,
    application_id      INT NOT NULL,
    from_status         VARCHAR(40) NULL,
    to_status           VARCHAR(40) NULL,      -- NULL = a migrated remark with no status change
    changed_by          INT NULL,
    remark_to_applicant TEXT NULL,             -- the ONLY text applicants see
    legacy_review_id    INT NULL UNIQUE,       -- set for rows migrated from tbl_adoption_reviews
    created_at          TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_history_app (application_id, created_at),
    CONSTRAINT fk_history_app FOREIGN KEY (application_id) REFERENCES tbl_adoption_applications(application_id) ON DELETE CASCADE,
    CONSTRAINT fk_history_user FOREIGN KEY (changed_by) REFERENCES tbl_users(user_id)
) ENGINE=InnoDB;

-- Internal notes: never returned by donor endpoints.
CREATE TABLE IF NOT EXISTS tbl_application_notes (
    note_id        INT AUTO_INCREMENT PRIMARY KEY,
    application_id INT NOT NULL,
    history_id     INT NULL,                   -- the status update this note belongs to
    author_id      INT NOT NULL,
    note           TEXT NOT NULL,
    created_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_notes_app (application_id, created_at),
    CONSTRAINT fk_notes_app FOREIGN KEY (application_id) REFERENCES tbl_adoption_applications(application_id) ON DELETE CASCADE,
    CONSTRAINT fk_notes_history FOREIGN KEY (history_id) REFERENCES tbl_application_status_history(history_id) ON DELETE SET NULL,
    CONSTRAINT fk_notes_author FOREIGN KEY (author_id) REFERENCES tbl_users(user_id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS tbl_application_document_requests (
    request_id     INT AUTO_INCREMENT PRIMARY KEY,
    application_id INT NOT NULL,
    history_id     INT NULL,
    doc_type       VARCHAR(40) NOT NULL,
    message        VARCHAR(500) NULL,          -- shown to the applicant
    status         ENUM('Open', 'Fulfilled', 'Closed') NOT NULL DEFAULT 'Open',
    requested_by   INT NOT NULL,
    requested_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    fulfilled_at   DATETIME NULL,
    closed_at      DATETIME NULL,
    INDEX idx_requests_app (application_id, status),
    CONSTRAINT fk_requests_app FOREIGN KEY (application_id) REFERENCES tbl_adoption_applications(application_id) ON DELETE CASCADE,
    CONSTRAINT fk_requests_history FOREIGN KEY (history_id) REFERENCES tbl_application_status_history(history_id) ON DELETE SET NULL,
    CONSTRAINT fk_requests_user FOREIGN KEY (requested_by) REFERENCES tbl_users(user_id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS tbl_application_interviews (
    interview_id   INT AUTO_INCREMENT PRIMARY KEY,
    application_id INT NOT NULL,
    history_id     INT NULL,
    kind           ENUM('Interview', 'Home visit') NOT NULL,
    scheduled_at   DATETIME NOT NULL,
    details        VARCHAR(500) NULL,          -- place or instructions, shown to the applicant
    created_by     INT NOT NULL,
    created_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_interviews_app (application_id, scheduled_at),
    CONSTRAINT fk_interviews_app FOREIGN KEY (application_id) REFERENCES tbl_adoption_applications(application_id) ON DELETE CASCADE,
    CONSTRAINT fk_interviews_history FOREIGN KEY (history_id) REFERENCES tbl_application_status_history(history_id) ON DELETE SET NULL,
    CONSTRAINT fk_interviews_user FOREIGN KEY (created_by) REFERENCES tbl_users(user_id)
) ENGINE=InnoDB;

-- ---------------------------------------------------------------- 2. applications: new columns
ALTER TABLE tbl_adoption_applications
  ADD COLUMN IF NOT EXISTS matched_child_id VARCHAR(50) NULL AFTER applicant_id,
  ADD COLUMN IF NOT EXISTS current_page TINYINT UNSIGNED NOT NULL DEFAULT 1 AFTER status,
  ADD COLUMN IF NOT EXISTS is_legacy BOOLEAN NOT NULL DEFAULT FALSE AFTER current_page,
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN IF NOT EXISTS decided_at DATETIME NULL,
  ADD COLUMN IF NOT EXISTS withdrawn_at DATETIME NULL,
  ADD COLUMN IF NOT EXISTS finalized_at DATETIME NULL,
  ADD COLUMN IF NOT EXISTS finalized_by INT NULL;

-- Drafts have no reference, consent or submit time yet.
ALTER TABLE tbl_adoption_applications
  MODIFY COLUMN reference_no VARCHAR(20) NULL,
  MODIFY COLUMN reason_for_adoption TEXT NULL,
  MODIFY COLUMN declaration_accepted BOOLEAN NOT NULL DEFAULT FALSE,
  MODIFY COLUMN consented_at DATETIME NULL,
  MODIFY COLUMN submitted_at DATETIME NULL DEFAULT NULL;

-- ---------------------------------------------------------------- 3. identity -> tbl_applicant_details, legacy columns
-- Everything that exists now came from the old 6-section form.
CALL cs_if_column('tbl_adoption_applications', 'legal_name', TRUE,
  'UPDATE tbl_adoption_applications SET is_legacy = TRUE, created_at = COALESCE(submitted_at, created_at)');
CALL cs_if_column('tbl_adoption_applications', 'legal_name', TRUE,
  'INSERT IGNORE INTO tbl_applicant_details (application_id, legal_name, date_of_birth, contact_number, email, civil_status)
   SELECT application_id, legal_name, date_of_birth, contact_number, email, civil_status FROM tbl_adoption_applications');
CALL cs_if_column('tbl_adoption_applications', 'legal_name', TRUE, 'ALTER TABLE tbl_adoption_applications DROP COLUMN legal_name');
CALL cs_if_column('tbl_adoption_applications', 'date_of_birth', TRUE, 'ALTER TABLE tbl_adoption_applications DROP COLUMN date_of_birth');
CALL cs_if_column('tbl_adoption_applications', 'contact_number', TRUE, 'ALTER TABLE tbl_adoption_applications DROP COLUMN contact_number');
CALL cs_if_column('tbl_adoption_applications', 'email', TRUE, 'ALTER TABLE tbl_adoption_applications DROP COLUMN email');
CALL cs_if_column('tbl_adoption_applications', 'civil_status', TRUE, 'ALTER TABLE tbl_adoption_applications DROP COLUMN civil_status');

CALL cs_if_column('tbl_adoption_applications', 'address', TRUE,
  'ALTER TABLE tbl_adoption_applications CHANGE COLUMN address legacy_address TEXT NULL');
CALL cs_if_column('tbl_adoption_applications', 'occupation', TRUE,
  'ALTER TABLE tbl_adoption_applications CHANGE COLUMN occupation legacy_occupation VARCHAR(150) NULL');
CALL cs_if_column('tbl_adoption_applications', 'employment_details', TRUE,
  'ALTER TABLE tbl_adoption_applications CHANGE COLUMN employment_details legacy_employment_details TEXT NULL');
CALL cs_if_column('tbl_adoption_applications', 'spouse_details', TRUE,
  'ALTER TABLE tbl_adoption_applications CHANGE COLUMN spouse_details legacy_spouse_details TEXT NULL');
CALL cs_if_column('tbl_adoption_applications', 'household_members', TRUE,
  'ALTER TABLE tbl_adoption_applications CHANGE COLUMN household_members legacy_household_members TEXT NULL');
CALL cs_if_column('tbl_adoption_applications', 'living_conditions', TRUE,
  'ALTER TABLE tbl_adoption_applications CHANGE COLUMN living_conditions legacy_living_conditions TEXT NULL');
CALL cs_if_column('tbl_adoption_applications', 'caregiving_experience', TRUE,
  'ALTER TABLE tbl_adoption_applications CHANGE COLUMN caregiving_experience legacy_caregiving_experience TEXT NULL');

-- ---------------------------------------------------------------- 4. child -> matched_child_id
CALL cs_if_column('tbl_adoption_applications', 'child_id', TRUE,
  'UPDATE tbl_adoption_applications SET matched_child_id = child_id WHERE matched_child_id IS NULL');
CALL cs_drop_fk_on('tbl_adoption_applications', 'child_id');
ALTER TABLE tbl_adoption_applications DROP INDEX IF EXISTS idx_adoption_child;
ALTER TABLE tbl_adoption_applications DROP COLUMN IF EXISTS child_id;
ALTER TABLE tbl_adoption_applications
  ADD CONSTRAINT fk_adoption_matched_child FOREIGN KEY IF NOT EXISTS (matched_child_id)
  REFERENCES tbl_children(child_id) ON DELETE RESTRICT;
CREATE INDEX IF NOT EXISTS idx_adoption_matched ON tbl_adoption_applications (matched_child_id);
CREATE INDEX IF NOT EXISTS idx_adoption_applicant_status ON tbl_adoption_applications (applicant_id, status);

-- ---------------------------------------------------------------- 5. statuses
ALTER TABLE tbl_adoption_applications MODIFY COLUMN status VARCHAR(40) NOT NULL DEFAULT 'Draft';
-- Completed = Approved + finalized. completed_at (old) becomes finalized_at.
CALL cs_if_column('tbl_adoption_applications', 'completed_at', TRUE,
  'UPDATE tbl_adoption_applications SET finalized_at = COALESCE(finalized_at, completed_at, updated_at, NOW()) WHERE status = ''Completed''');
UPDATE tbl_adoption_applications SET finalized_at = COALESCE(finalized_at, updated_at, NOW()) WHERE status = 'Completed';
UPDATE tbl_adoption_applications SET status = 'Approved' WHERE status = 'Completed';
UPDATE tbl_adoption_applications SET status = 'Under review' WHERE status = 'Under Review';
UPDATE tbl_adoption_applications SET status = 'Documents requested' WHERE status = 'Additional Documents Required';
UPDATE tbl_adoption_applications SET status = 'Declined' WHERE status = 'Rejected';
UPDATE tbl_adoption_applications SET decided_at = COALESCE(decided_at, updated_at, submitted_at)
 WHERE status IN ('Approved', 'Declined') AND decided_at IS NULL;
-- The allowed status list is enforced by the latest migration (010 replaced this workflow),
-- so this file leaves the column as text on re-runs instead of forcing the v3 list.
ALTER TABLE tbl_adoption_applications MODIFY COLUMN status VARCHAR(40) NOT NULL DEFAULT 'Draft';
ALTER TABLE tbl_adoption_applications DROP COLUMN IF EXISTS completed_at;
ALTER TABLE tbl_adoption_applications
  ADD CONSTRAINT fk_adoption_finalized_by FOREIGN KEY IF NOT EXISTS (finalized_by) REFERENCES tbl_users(user_id);

-- ---------------------------------------------------------------- 6. reviews -> status history
INSERT IGNORE INTO tbl_application_status_history
  (application_id, from_status, to_status, changed_by, remark_to_applicant, legacy_review_id, created_at)
SELECT rv.application_id,
       CASE rv.status_from WHEN 'Under Review' THEN 'Under review' WHEN 'Additional Documents Required' THEN 'Documents requested'
            WHEN 'Rejected' THEN 'Declined' WHEN 'Completed' THEN 'Approved' ELSE rv.status_from END,
       CASE rv.status_to WHEN 'Under Review' THEN 'Under review' WHEN 'Additional Documents Required' THEN 'Documents requested'
            WHEN 'Rejected' THEN 'Declined' WHEN 'Completed' THEN 'Approved' ELSE rv.status_to END,
       rv.reviewer_id, rv.note, rv.review_id, rv.created_at
  FROM tbl_adoption_reviews rv;
-- A migrated "Approved -> Approved" row (from Completed) is the finalize step, which applicants never see.
DELETE FROM tbl_application_status_history
 WHERE legacy_review_id IS NOT NULL AND from_status = 'Approved' AND to_status = 'Approved';

-- ---------------------------------------------------------------- 7. documents
ALTER TABLE tbl_adoption_documents
  ADD COLUMN IF NOT EXISTS page TINYINT UNSIGNED NULL AFTER doc_type,
  ADD COLUMN IF NOT EXISTS status ENUM('Uploaded', 'Replaced') NOT NULL DEFAULT 'Uploaded' AFTER storage_key,
  ADD COLUMN IF NOT EXISTS request_id INT NULL AFTER status;
UPDATE tbl_adoption_documents SET page = 3, doc_type = 'valid_id' WHERE doc_type = 'government_id';
UPDATE tbl_adoption_documents SET page = 4, doc_type = 'nbi_police_clearance' WHERE doc_type = 'background_check';
UPDATE tbl_adoption_documents SET page = 5 WHERE doc_type = 'proof_of_income' AND page IS NULL;
UPDATE tbl_adoption_documents SET page = 7, doc_type = 'other_supporting' WHERE doc_type = 'other';
UPDATE tbl_adoption_documents SET page = 7 WHERE page IS NULL;
CREATE INDEX IF NOT EXISTS idx_adoption_docs_app_type ON tbl_adoption_documents (application_id, doc_type, status);
ALTER TABLE tbl_adoption_documents
  ADD CONSTRAINT fk_adoption_doc_request FOREIGN KEY IF NOT EXISTS (request_id)
  REFERENCES tbl_application_document_requests(request_id) ON DELETE SET NULL;

-- tbl_adoption_reviews is kept as it was (read-only history); the app now uses
-- tbl_application_status_history and tbl_application_notes.

DROP PROCEDURE IF EXISTS cs_if_column;
DROP PROCEDURE IF EXISTS cs_if_no_table;
DROP PROCEDURE IF EXISTS cs_drop_fk_on;
