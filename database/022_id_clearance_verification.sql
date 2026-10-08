-- Migration 022 - Government ID and NBI/police/court clearance checks
--
-- * tbl_applicant_details: the ID number, expiry date, and the name and date of birth exactly as printed
--   on the ID (to compare with the application), and the clearances (holder, kind, reference number,
--   date issued) as an encrypted list. All stored encrypted like the other applicant details.
-- * tbl_verifications: one row per government ID or clearance of a submitted application. It stores the
--   automatic checks (format, expiry, match with the application, duplicates) and the status. No official
--   verification service is connected, so a row is never "Verified" without a person's review, which
--   records the method (original sighted, official QR or online check) and any reference.
-- * tbl_verification_events: every status change (automatic or by a person). Rows can't be edited or deleted.
--
-- No existing data is changed. Safe to run more than once.
-- Rollback: database/rollback/022_id_clearance_verification_rollback.sql
USE caresphere_db;

ALTER TABLE tbl_applicant_details
  ADD COLUMN IF NOT EXISTS id_number VARCHAR(255) NULL,
  ADD COLUMN IF NOT EXISTS id_expiry VARCHAR(255) NULL,
  ADD COLUMN IF NOT EXISTS id_name VARCHAR(255) NULL,
  ADD COLUMN IF NOT EXISTS id_dob VARCHAR(255) NULL,
  ADD COLUMN IF NOT EXISTS clearances TEXT NULL;

CREATE TABLE IF NOT EXISTS tbl_verifications (
    verification_id INT AUTO_INCREMENT PRIMARY KEY,
    application_id  INT NOT NULL,
    kind            ENUM('government_id', 'clearance') NOT NULL,
    slot            VARCHAR(20) NOT NULL,              -- 'id', or 'clearance-1', 'clearance-2', ...
    item_type       VARCHAR(60) NOT NULL,              -- ID type, or NBI / Police / Court
    reference_enc   VARCHAR(255) NULL,                 -- ID or clearance number (encrypted)
    reference_hash  CHAR(64) NULL,                     -- keyed hash, to find the same number on other applications
    holder_enc      VARCHAR(255) NULL,                 -- clearance holder's name (encrypted)
    issue_date      DATE NULL,
    expiry_date     DATE NULL,
    status          VARCHAR(40) NOT NULL,
    checks          JSON NULL,                         -- automatic check results
    method          VARCHAR(60) NULL,                  -- how a person verified it
    method_ref      VARCHAR(120) NULL,                 -- e.g. official reference shown on the QR check
    note            VARCHAR(500) NULL,                 -- shown to the applicant when it needs correction
    reviewed_by     INT NULL,
    reviewed_at     DATETIME NULL,
    created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at      TIMESTAMP NULL DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uq_verification_slot (application_id, slot),
    INDEX idx_verification_hash (reference_hash),
    CONSTRAINT fk_verifications_app FOREIGN KEY (application_id) REFERENCES tbl_adoption_applications(application_id),
    CONSTRAINT fk_verifications_reviewer FOREIGN KEY (reviewed_by) REFERENCES tbl_users(user_id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS tbl_verification_events (
    event_id        INT AUTO_INCREMENT PRIMARY KEY,
    verification_id INT NOT NULL,
    from_status     VARCHAR(40) NULL,
    to_status       VARCHAR(40) NOT NULL,
    actor_id        INT NULL,                          -- NULL = automatic checks
    detail          VARCHAR(500) NULL,
    created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_verification_events (verification_id, created_at),
    CONSTRAINT fk_verification_events FOREIGN KEY (verification_id) REFERENCES tbl_verifications(verification_id)
) ENGINE=InnoDB;

DROP TRIGGER IF EXISTS trg_verification_events_no_update;
CREATE TRIGGER trg_verification_events_no_update BEFORE UPDATE ON tbl_verification_events FOR EACH ROW
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'The verification history cannot be edited.';
DROP TRIGGER IF EXISTS trg_verification_events_no_delete;
CREATE TRIGGER trg_verification_events_no_delete BEFORE DELETE ON tbl_verification_events FOR EACH ROW
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'The verification history cannot be deleted.';
