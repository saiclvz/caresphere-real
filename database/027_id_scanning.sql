-- Migration 027 - automatic ID scanning (front and back)
--
-- * tbl_id_type_rules: one row per accepted ID type (number format, required fields per side, date formats,
--   expiry, which side has a QR code or MRZ, the verification adapter). Admin edits these in Settings, so a
--   type can be added or fixed without redeploying. Seeded with the types CareSphere already accepts;
--   existing rows are never overwritten.
-- * tbl_id_scans: the result of each automatic scan of one side of an ID photo (one row per upload, so
--   retakes are counted). Extracted fields are stored encrypted; the raw QR payload is never stored.
-- * tbl_verifications: the automated-checks result (Passed / Failed / Unable to read) kept separate from
--   the authenticity status, and the official verification record (source, reference, time, who, and the
--   raw result, encrypted).
-- * Setting id_scan_retention_days: how long extracted scan fields are kept once an application is closed.
--
-- No existing data is changed or deleted. Safe to run more than once.
-- Rollback: database/rollback/027_id_scanning_rollback.sql
USE caresphere_db;

CREATE TABLE IF NOT EXISTS tbl_id_type_rules (
    type_key        VARCHAR(60) PRIMARY KEY,            -- the ID type name shown in the form (e.g. 'PhilSys National ID')
    label           VARCHAR(80) NOT NULL,
    number_regex    VARCHAR(255) NULL,                  -- pattern for the ID number (spaces ignored); NULL = not checked
    number_example  VARCHAR(80) NULL,
    expires         BOOLEAN NOT NULL DEFAULT TRUE,      -- whether the ID has an expiry date
    needs_back      BOOLEAN NOT NULL DEFAULT TRUE,      -- back photo required (cards); FALSE for passports
    front_fields    JSON NULL,                          -- fields expected on the front, e.g. ["full_name","id_number","date_of_birth"]
    back_fields     JSON NULL,                          -- fields expected on the back
    front_keywords  JSON NULL,                          -- printed words that identify the front
    back_keywords   JSON NULL,                          -- printed words that identify the back
    date_formats    JSON NULL,                          -- e.g. ["YYYY-MM-DD","MMMM DD, YYYY","DD MMM YYYY"]
    machine_readable ENUM('none', 'qr', 'mrz') NOT NULL DEFAULT 'none',
    machine_side    ENUM('front', 'back') NOT NULL DEFAULT 'back',
    adapter         VARCHAR(40) NOT NULL DEFAULT 'manual', -- 'philsys_check', 'mrz_consistency', 'manual' (see services/verificationAdapters.js)
    active          BOOLEAN NOT NULL DEFAULT TRUE,
    updated_by      INT NULL,
    updated_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB;

INSERT IGNORE INTO tbl_id_type_rules (type_key, label, number_regex, number_example, expires, needs_back, front_fields, back_fields, front_keywords, back_keywords, date_formats, machine_readable, machine_side, adapter) VALUES
('PhilSys National ID', 'PhilSys National ID (PhilID / ePhilID)', '^\\d{4}-?\\d{4}-?\\d{4}-?\\d{4}$', '1234-5678-9012-3456 (PhilSys Card Number)', FALSE, TRUE,
  '["full_name","date_of_birth","id_number"]', '["date_issued"]',
  '["PAMBANSANG PAGKAKAKILANLAN","PHILIPPINE IDENTIFICATION CARD","REPUBLIKA NG PILIPINAS"]', '["PETSA NG PAGKAKAISYU","DATE OF ISSUE","PHILSYS"]',
  '["YYYY-MM-DD","MMMM DD, YYYY","DD MMM YYYY"]', 'qr', 'back', 'philsys_check'),
('Passport', 'Philippine passport', '^([A-Z]\\d{7}[A-Z]|[A-Z]{2}\\d{7})$', 'P1234567A', TRUE, FALSE,
  '["full_name","date_of_birth","id_number","expiry_date"]', '[]',
  '["PASSPORT","PASAPORTE","DEPARTMENT OF FOREIGN AFFAIRS"]', '[]',
  '["DD MMM YYYY","YYYY-MM-DD"]', 'mrz', 'front', 'mrz_consistency'),
("Driver's license", 'LTO driver''s license', '^[A-Z]\\d{2}-?\\d{2}-?\\d{6}$', 'N01-23-456789', TRUE, TRUE,
  '["full_name","date_of_birth","id_number","expiry_date"]', '[]',
  '["LAND TRANSPORTATION OFFICE","DRIVER''S LICENSE","DRIVERS LICENSE"]', '["CONDITIONS","RESTRICTION","DL CODES"]',
  '["YYYY/MM/DD","YYYY-MM-DD","MM/DD/YYYY"]', 'none', 'back', 'manual'),
('UMID', 'UMID (SSS / GSIS)', '^\\d{4}-?\\d{7}-?\\d$', '0111-1234567-8 (CRN)', FALSE, TRUE,
  '["full_name","date_of_birth","id_number"]', '[]',
  '["UNIFIED MULTI-PURPOSE","UMID","SOCIAL SECURITY SYSTEM","GSIS"]', '["SIGNATURE","IF FOUND"]',
  '["YYYY/MM/DD","YYYY-MM-DD"]', 'none', 'back', 'manual'),
('PRC ID', 'PRC professional ID', '^\\d{7}$', '0123456 (registration number)', TRUE, TRUE,
  '["full_name","id_number","expiry_date"]', '[]',
  '["PROFESSIONAL REGULATION COMMISSION"]', '["SIGNATURE"]',
  '["MM/DD/YYYY","YYYY-MM-DD"]', 'none', 'back', 'manual'),
('Postal ID', 'PHLPost Postal ID', NULL, NULL, TRUE, TRUE,
  '["full_name","date_of_birth"]', '[]',
  '["POSTAL IDENTITY CARD","PHLPOST","PHILIPPINE POSTAL"]', '[]',
  '["DD MMM YYYY","YYYY-MM-DD"]', 'none', 'back', 'manual'),
("Voter's ID", 'COMELEC voter''s ID', NULL, NULL, FALSE, TRUE,
  '["full_name","date_of_birth"]', '[]',
  '["COMMISSION ON ELECTIONS","COMELEC","VOTER''S"]', '[]',
  '["MM/DD/YYYY","YYYY-MM-DD"]', 'none', 'back', 'manual'),
('PhilHealth ID', 'PhilHealth ID', '^\\d{2}-?\\d{9}-?\\d$', '12-345678901-2 (PIN)', FALSE, TRUE,
  '["full_name","id_number"]', '[]',
  '["PHILHEALTH","PHILIPPINE HEALTH INSURANCE"]', '[]',
  '["MM/DD/YYYY","YYYY-MM-DD"]', 'none', 'back', 'manual');

CREATE TABLE IF NOT EXISTS tbl_id_scans (
    scan_id         INT AUTO_INCREMENT PRIMARY KEY,
    application_id  INT NOT NULL,
    document_id     INT NOT NULL,
    side            ENUM('front', 'back') NOT NULL,
    attempt_no      SMALLINT UNSIGNED NOT NULL DEFAULT 1, -- retakes of this side so far (1 = first upload)
    selected_type   VARCHAR(60) NULL,                  -- ID type chosen by the applicant at the time
    state           ENUM('scanning', 'done') NOT NULL DEFAULT 'scanning',
    result          ENUM('passed', 'failed', 'unreadable') NULL, -- automated checks for this side
    detected_type   VARCHAR(60) NULL,
    detected_side   ENUM('front', 'back') NULL,
    quality         JSON NULL,                         -- measurements only (size, blur, glare, brightness)
    checks          JSON NULL,                         -- [{ check, result: pass|fail|warn|n/a, message }]
    flags           JSON NULL,                         -- review flags (never "fake")
    fields_enc      MEDIUMTEXT NULL,                   -- extracted fields, encrypted JSON
    machine_kind    ENUM('none', 'qr', 'mrz') NOT NULL DEFAULT 'none',
    machine_status  ENUM('not_expected', 'read', 'not_found', 'unreadable', 'invalid') NOT NULL DEFAULT 'not_expected',
    machine_enc     MEDIUMTEXT NULL,                   -- fields decoded from the QR or MRZ, encrypted JSON (no raw payload)
    image_hash      CHAR(64) NULL,                     -- SHA-256 of the uploaded file (duplicate check)
    image_dhash     CHAR(16) NULL,                     -- perceptual hash (front vs back the same photo)
    number_hash     CHAR(64) NULL,                     -- keyed hash of the ID number read from the photo (never the number)
    created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    finished_at     DATETIME NULL,
    purged_at       DATETIME NULL,                     -- when the extracted fields were removed (retention)
    INDEX idx_id_scans_app (application_id, side, scan_id),
    INDEX idx_id_scans_hash (image_hash),
    INDEX idx_id_scans_number (number_hash),
    CONSTRAINT fk_id_scans_app FOREIGN KEY (application_id) REFERENCES tbl_adoption_applications(application_id),
    CONSTRAINT fk_id_scans_doc FOREIGN KEY (document_id) REFERENCES tbl_adoption_documents(document_id)
) ENGINE=InnoDB;

ALTER TABLE tbl_verifications
  ADD COLUMN IF NOT EXISTS auto_result      ENUM('Passed', 'Failed', 'Unable to read') NULL AFTER checks,
  ADD COLUMN IF NOT EXISTS official_source  VARCHAR(80) NULL AFTER auto_result,
  ADD COLUMN IF NOT EXISTS official_result  VARCHAR(40) NULL AFTER official_source,
  ADD COLUMN IF NOT EXISTS official_reference VARCHAR(120) NULL AFTER official_result,
  ADD COLUMN IF NOT EXISTS official_at      DATETIME NULL AFTER official_reference,
  ADD COLUMN IF NOT EXISTS official_by      INT NULL AFTER official_at,
  ADD COLUMN IF NOT EXISTS official_mode    ENUM('automatic', 'staff_confirmed') NULL AFTER official_by,
  ADD COLUMN IF NOT EXISTS official_raw_enc MEDIUMTEXT NULL AFTER official_mode;

INSERT IGNORE INTO tbl_settings (setting_key, setting_value) VALUES ('id_scan_retention_days', '90');
