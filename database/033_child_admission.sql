-- Migration 033 - Child admission workflow
--   Staff (Admission duty) -> New Admission -> Steps 1-4 -> Submit for Admin Approval -> Admin review
--   -> Approve (Admitted) -> assignment decides who keeps working on the child.
--
-- "Creating a child record does not mean owning the child record."
--   Admission duty  = who can create the admission
--   Assignment      = who can continue managing the child
--   Admin approval  = is the child officially admitted
--
-- One child record from start to finish (no second record):
-- * tbl_children.status gains 'In admission': the child exists but is not admitted, so every module that works
--   with Active children (lists, meals, adoption, transition, donor portal, reports) leaves it out by itself.
--   Approval sets it to Active. A declined admission stays 'In admission' (kept, never deleted).
-- * tbl_children.admission_status: Draft, Pending Approval, Needs Correction, Admitted, Declined.
--   Every existing child gets 'Admitted' (the column default): nothing about existing children changes.
-- * tbl_child_admissions: referral details, parent/guardian entries (encrypted), current step, submit and
--   decision details (approval date and approving Admin).
-- * tbl_child_admission_history: every status change (immutable; never updated or deleted).
-- * tbl_child_admission_checklist and tbl_child_admission_files: the documents checklist and uploaded copies
--   (encrypted files; a replaced file is kept and marked superseded, never deleted).
-- * New Staff duty "admission". Staff who have the "Child records" duty today get it once (they can register
--   children today), so nobody loses what they can do; Admin can remove it per person afterwards.
-- Safe to run more than once. Rollback: database/rollback/033_child_admission_rollback.sql
USE caresphere_db;

ALTER TABLE tbl_children
  MODIFY COLUMN status ENUM('Active', 'Discharged', 'Adopted', 'In admission') NOT NULL DEFAULT 'Active';

ALTER TABLE tbl_children
  ADD COLUMN IF NOT EXISTS admission_status ENUM('Draft', 'Pending Approval', 'Needs Correction', 'Admitted', 'Declined')
    NOT NULL DEFAULT 'Admitted' AFTER status;

CREATE TABLE IF NOT EXISTS tbl_child_admissions (
    child_id            VARCHAR(50) PRIMARY KEY,
    created_by          INT NOT NULL,
    created_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at          DATETIME NULL,
    current_step        TINYINT NOT NULL DEFAULT 1,
    place_of_birth      VARCHAR(150) NULL,
    referral_source     VARCHAR(60) NULL,
    referring_agency    VARCHAR(150) NULL,
    referring_person    VARCHAR(150) NULL,
    referring_contact_enc TEXT NULL COMMENT 'encrypted',
    referral_date       DATE NULL,
    referral_reference  VARCHAR(80) NULL,
    reason_enc          TEXT NULL COMMENT 'reason for admission (encrypted)',
    parents_unknown     BOOLEAN NOT NULL DEFAULT FALSE,
    guardians_enc       TEXT NULL COMMENT 'JSON list of parents/guardians (encrypted)',
    siblings_enc        TEXT NULL COMMENT 'encrypted',
    submitted_at        DATETIME NULL COMMENT 'last submission',
    submitted_by        INT NULL,
    submit_count        INT NOT NULL DEFAULT 0,
    reviewed_at         DATETIME NULL COMMENT 'last time an Admin opened the review',
    reviewed_by         INT NULL,
    decided_at          DATETIME NULL,
    decided_by          INT NULL,
    decision            ENUM('Approved', 'Returned', 'Declined') NULL,
    decision_note       VARCHAR(2000) NULL,
    approved_at         DATETIME NULL,
    approved_by         INT NULL,
    INDEX idx_adm_created_by (created_by),
    INDEX idx_adm_submitted (submitted_at),
    CONSTRAINT fk_adm_child FOREIGN KEY (child_id) REFERENCES tbl_children(child_id) ON DELETE CASCADE,
    CONSTRAINT fk_adm_created_by FOREIGN KEY (created_by) REFERENCES tbl_users(user_id),
    CONSTRAINT fk_adm_submitted_by FOREIGN KEY (submitted_by) REFERENCES tbl_users(user_id),
    CONSTRAINT fk_adm_reviewed_by FOREIGN KEY (reviewed_by) REFERENCES tbl_users(user_id),
    CONSTRAINT fk_adm_decided_by FOREIGN KEY (decided_by) REFERENCES tbl_users(user_id),
    CONSTRAINT fk_adm_approved_by FOREIGN KEY (approved_by) REFERENCES tbl_users(user_id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS tbl_child_admission_history (
    history_id   INT AUTO_INCREMENT PRIMARY KEY,
    child_id     VARCHAR(50) NOT NULL,
    from_status  VARCHAR(30) NULL,
    to_status    VARCHAR(30) NOT NULL,
    note         VARCHAR(2000) NULL,
    actor_id     INT NULL,
    created_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_admh_child (child_id, created_at),
    CONSTRAINT fk_admh_child FOREIGN KEY (child_id) REFERENCES tbl_children(child_id) ON DELETE CASCADE,
    CONSTRAINT fk_admh_actor FOREIGN KEY (actor_id) REFERENCES tbl_users(user_id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS tbl_child_admission_checklist (
    child_id     VARCHAR(50) NOT NULL,
    doc_key      VARCHAR(40) NOT NULL,
    status       ENUM('Received', 'To follow', 'Not applicable') NOT NULL,
    note         VARCHAR(500) NULL,
    updated_by   INT NULL,
    updated_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (child_id, doc_key),
    CONSTRAINT fk_admc_child FOREIGN KEY (child_id) REFERENCES tbl_children(child_id) ON DELETE CASCADE,
    CONSTRAINT fk_admc_user FOREIGN KEY (updated_by) REFERENCES tbl_users(user_id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS tbl_child_admission_files (
    file_id       INT AUTO_INCREMENT PRIMARY KEY,
    child_id      VARCHAR(50) NOT NULL,
    doc_key       VARCHAR(40) NOT NULL,
    storage_key   VARCHAR(255) NOT NULL,
    mime_type     VARCHAR(100) NULL,
    original_name VARCHAR(255) NULL,
    sha256        CHAR(64) NULL,
    uploaded_by   INT NULL,
    uploaded_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    superseded_at DATETIME NULL COMMENT 'replaced by a newer copy (kept, never deleted)',
    INDEX idx_admf_child (child_id, doc_key),
    CONSTRAINT fk_admf_child FOREIGN KEY (child_id) REFERENCES tbl_children(child_id) ON DELETE CASCADE,
    CONSTRAINT fk_admf_user FOREIGN KEY (uploaded_by) REFERENCES tbl_users(user_id)
) ENGINE=InnoDB;

-- Where the new admission information sits in the access levels (Level 2 core record; medical copies Level 3).
INSERT IGNORE INTO tbl_child_field_levels (field_key, section, level, label) VALUES
  ('admission_referral', 'admission', 'core', 'Referral details'),
  ('admission_family', 'admission', 'core', 'Parent/guardian and family'),
  ('admission_documents', 'admission', 'core', 'Admission documents checklist and copies'),
  ('admission_medical_documents', 'admission', 'sensitive', 'Medical certificate copy');

-- Admission duty, given once to Staff who have the Child records duty today (marker: runs only once, so a duty
-- Admin removes later stays removed).
CREATE TABLE IF NOT EXISTS tbl_migration_markers (marker VARCHAR(60) PRIMARY KEY, done_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP) ENGINE=InnoDB;
INSERT IGNORE INTO tbl_staff_duties (user_id, duty)
SELECT sd.user_id, 'admission' FROM tbl_staff_duties sd
 WHERE sd.duty = 'children'
   AND NOT EXISTS (SELECT 1 FROM tbl_migration_markers WHERE marker = '033_admission_duty_seeded');
INSERT IGNORE INTO tbl_migration_markers (marker) VALUES ('033_admission_duty_seeded');
