-- Migration 003 - CareSphere v2
-- Children profile fields, discharge history, adoption, transition review (18+),
-- health-access tokens + access log, donor-submitted donations, meals/visitors
-- updates, and removal of inventory/visitor QR workflows.
--
-- Safe to run more than once: uses MariaDB (XAMPP) IF [NOT] EXISTS syntax.
USE caresphere_db;
SET FOREIGN_KEY_CHECKS = 0;

-- ---------------------------------------------------------------- roles
-- (The separate Applicant role was merged into Donor. See 004_merge_applicant_into_donor.sql.)

-- ---------------------------------------------------------------- children
-- (October 2026) the list includes every value added by later migrations, so running all migrations again never narrows it.
ALTER TABLE tbl_children
  MODIFY COLUMN status ENUM('Active', 'Discharged', 'Adopted', 'In admission') NOT NULL DEFAULT 'Active',
  MODIFY COLUMN qr_created_at TIMESTAMP NULL DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS full_name VARCHAR(101)
      GENERATED ALWAYS AS (CONCAT(first_name, ' ', last_name)) STORED AFTER last_name,
  ADD COLUMN IF NOT EXISTS admission_date DATE NULL AFTER dob,
  ADD COLUMN IF NOT EXISTS profile_photo_path VARCHAR(255) NULL,
  ADD COLUMN IF NOT EXISTS background_care_info TEXT NULL COMMENT 'AES-256-GCM ciphertext',
  ADD COLUMN IF NOT EXISTS guardian_family_info TEXT NULL COMMENT 'AES-256-GCM ciphertext',
  ADD COLUMN IF NOT EXISTS public_bio TEXT NULL,
  ADD COLUMN IF NOT EXISTS is_public BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP;

ALTER TABLE tbl_children
  ADD INDEX IF NOT EXISTS idx_children_dob (dob),
  ADD INDEX IF NOT EXISTS idx_children_status (status),
  ADD INDEX IF NOT EXISTS idx_children_full_name (full_name);

-- Discharge documentation (history is never overwritten)
CREATE TABLE IF NOT EXISTS tbl_child_discharge_history (
    discharge_id            INT AUTO_INCREMENT PRIMARY KEY,
    child_id                VARCHAR(50) NOT NULL,
    discharge_reason        TEXT NOT NULL,
    report_of_what_happened TEXT NOT NULL,
    discharge_date          DATE NOT NULL,
    reported_by             INT NOT NULL,
    previous_status         VARCHAR(20) NOT NULL,
    created_at              TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (child_id) REFERENCES tbl_children(child_id) ON DELETE RESTRICT,
    FOREIGN KEY (reported_by) REFERENCES tbl_users(user_id),
    INDEX idx_discharge_child (child_id)
) ENGINE=InnoDB;

-- Transition review for children who reach 18 (never auto-discharged)
CREATE TABLE IF NOT EXISTS tbl_transition_reviews (
    review_id       INT AUTO_INCREMENT PRIMARY KEY,
    child_id        VARCHAR(50) NOT NULL UNIQUE,
    review_status   ENUM('For Review', 'In Progress', 'Completed') NOT NULL DEFAULT 'For Review',
    notes           TEXT NULL,
    housing_goal    TEXT NULL,
    vocational_goal TEXT NULL,
    education_goal  TEXT NULL,
    updated_by      INT NULL,
    flagged_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at      TIMESTAMP NULL DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (child_id) REFERENCES tbl_children(child_id) ON DELETE CASCADE,
    FOREIGN KEY (updated_by) REFERENCES tbl_users(user_id)
) ENGINE=InnoDB;

-- ---------------------------------------------------------------- adoption
CREATE TABLE IF NOT EXISTS tbl_adoption_applications (
    application_id        INT AUTO_INCREMENT PRIMARY KEY,
    reference_no          VARCHAR(20) NOT NULL UNIQUE,
    applicant_id          INT NOT NULL,
    child_id              VARCHAR(50) NOT NULL,
    status                ENUM('Submitted', 'Under Review', 'Additional Documents Required',
                               'Approved', 'Rejected', 'Completed') NOT NULL DEFAULT 'Submitted',
    -- 1. Applicant information
    legal_name            VARCHAR(150) NOT NULL,
    date_of_birth         DATE NOT NULL,
    contact_number        VARCHAR(30) NOT NULL,
    email                 VARCHAR(100) NOT NULL,
    address               TEXT NOT NULL,
    civil_status          VARCHAR(30) NOT NULL,
    occupation            VARCHAR(150) NOT NULL,
    employment_details    TEXT NOT NULL,
    -- 2. Family and household
    spouse_details        TEXT NULL,
    household_members     TEXT NOT NULL,
    living_conditions     TEXT NOT NULL,
    caregiving_experience TEXT NOT NULL,
    -- 5. Reason / 6. Declaration
    reason_for_adoption   TEXT NOT NULL,
    declaration_accepted  BOOLEAN NOT NULL,
    consented_at          DATETIME NOT NULL,
    submitted_at          TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at            TIMESTAMP NULL DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP,
    completed_at          DATETIME NULL,
    FOREIGN KEY (applicant_id) REFERENCES tbl_users(user_id),
    FOREIGN KEY (child_id) REFERENCES tbl_children(child_id) ON DELETE RESTRICT,
    INDEX idx_adoption_status (status),
    INDEX idx_adoption_child (child_id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS tbl_adoption_documents (
    document_id    INT AUTO_INCREMENT PRIMARY KEY,
    application_id INT NOT NULL,
    doc_type       VARCHAR(40) NOT NULL,
    original_name  VARCHAR(255) NOT NULL,
    mime_type      VARCHAR(50) NOT NULL,
    size_bytes     INT NOT NULL,
    storage_key    VARCHAR(255) NOT NULL COMMENT 'Encrypted file under backend/uploads',
    uploaded_by    INT NOT NULL,
    uploaded_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (application_id) REFERENCES tbl_adoption_applications(application_id) ON DELETE CASCADE,
    FOREIGN KEY (uploaded_by) REFERENCES tbl_users(user_id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS tbl_adoption_reviews (
    review_id      INT AUTO_INCREMENT PRIMARY KEY,
    application_id INT NOT NULL,
    reviewer_id    INT NOT NULL,
    status_from    VARCHAR(40) NULL,
    status_to      VARCHAR(40) NULL,
    note           TEXT NULL,
    created_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (application_id) REFERENCES tbl_adoption_applications(application_id) ON DELETE CASCADE,
    FOREIGN KEY (reviewer_id) REFERENCES tbl_users(user_id)
) ENGINE=InnoDB;

-- ---------------------------------------------------------------- health access
-- Elevated 180-second tokens for health records and case files.
CREATE TABLE IF NOT EXISTS tbl_health_access_tokens (
    token_id   INT AUTO_INCREMENT PRIMARY KEY,
    token_hash CHAR(64) NOT NULL UNIQUE,
    user_id    INT NOT NULL,
    child_id   VARCHAR(50) NOT NULL,
    method     ENUM('TYPED_TOKEN', 'PASSWORD') NOT NULL,
    issued_at  DATETIME NOT NULL,
    expires_at DATETIME NOT NULL,
    revoked    BOOLEAN NOT NULL DEFAULT FALSE,
    FOREIGN KEY (user_id) REFERENCES tbl_users(user_id),
    FOREIGN KEY (child_id) REFERENCES tbl_children(child_id) ON DELETE CASCADE,
    INDEX idx_hat_expires (expires_at)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS tbl_health_data_access_logs (
    log_id     INT AUTO_INCREMENT PRIMARY KEY,
    user_id    INT NULL,
    child_id   VARCHAR(50) NULL,
    event      VARCHAR(40) NOT NULL,
    detail     VARCHAR(255) NULL,
    ip_address VARCHAR(45) NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_hal_child (child_id),
    INDEX idx_hal_created (created_at)
) ENGINE=InnoDB;

-- Typed tokens are for child health records only now.
DELETE FROM tbl_qr_sessions WHERE scope <> 'child';
ALTER TABLE tbl_qr_sessions MODIFY COLUMN scope ENUM('child') NOT NULL DEFAULT 'child';

-- ---------------------------------------------------------------- donations
ALTER TABLE tbl_donations
  ADD COLUMN IF NOT EXISTS status ENUM('Pending', 'Received', 'Cancelled') NOT NULL DEFAULT 'Received' AFTER payment_method,
  ADD COLUMN IF NOT EXISTS item_description TEXT NULL AFTER status,
  ADD COLUMN IF NOT EXISTS reason_for_donation TEXT NULL AFTER item_description,
  ADD COLUMN IF NOT EXISTS submitted_by_donor BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS idempotency_key CHAR(36) NULL,
  ADD COLUMN IF NOT EXISTS received_at DATETIME NULL;

ALTER TABLE tbl_donations ADD UNIQUE INDEX IF NOT EXISTS uq_donation_idempotency (idempotency_key);

CREATE TABLE IF NOT EXISTS tbl_donation_children (
    donation_id INT NOT NULL,
    child_id    VARCHAR(50) NOT NULL,
    PRIMARY KEY (donation_id, child_id),
    FOREIGN KEY (donation_id) REFERENCES tbl_donations(donation_id) ON DELETE CASCADE,
    FOREIGN KEY (child_id) REFERENCES tbl_children(child_id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- ---------------------------------------------------------------- meals
-- (is_active, the "remove from plan" flag, was added here and is dropped by 025_remove_meal_disable.sql)
ALTER TABLE tbl_meals
  ADD COLUMN IF NOT EXISTS dietary_tags VARCHAR(255) NOT NULL DEFAULT '';

-- ---------------------------------------------------------------- visitors (QR passes removed)
ALTER TABLE tbl_visitors
  ADD COLUMN IF NOT EXISTS contact_number VARCHAR(30) NULL AFTER visitor_name,
  ADD COLUMN IF NOT EXISTS logged_by INT NULL,
  DROP COLUMN IF EXISTS qr_pass_code;

-- ---------------------------------------------------------------- inventory (QR-restricted items removed)
ALTER TABLE tbl_inventory DROP COLUMN IF EXISTS is_restricted;

SET FOREIGN_KEY_CHECKS = 1;
