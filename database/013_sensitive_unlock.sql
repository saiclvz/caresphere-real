-- Migration 013 - One unlock flow for sensitive records (adoption applications and children)
--
-- Staff open sensitive sections with: a stated purpose + confidentiality acknowledgement, then a
-- rotating QR (60 s) that opens a page on their phone showing a single-use Token ID, typed back
-- on the computer. A verified token starts a short unlock session (setting: unlock_minutes).
--
-- * tbl_adoption_applications.assigned_staff_id: need-to-know (Admin sets it).
-- * tbl_unlock_challenges: the QR / Token ID step (purpose, note, acknowledgement time, single use).
-- * tbl_unlock_sessions: unlocked periods (start, end, end reason, who revoked).
-- * tbl_unlock_events: every step (purpose, QR, verify success/failure, views, downloads, copy,
--   print, lock, expiry, revoke) with purpose and device type. Rows can't be edited or deleted.
-- * Settings: unlock_minutes (default 3), access_log_retention_months (review only, nothing is
--   deleted automatically), staff_download_doc_types (document types Staff may download).
--
-- Existing tokens and logs (health access, protected records) are not changed.
-- Safe to run more than once. Rollback: database/rollback/013_sensitive_unlock_rollback.sql
USE caresphere_db;

ALTER TABLE tbl_adoption_applications ADD COLUMN IF NOT EXISTS assigned_staff_id INT NULL AFTER applicant_id;
ALTER TABLE tbl_adoption_applications
  ADD CONSTRAINT fk_adoption_assigned_staff FOREIGN KEY IF NOT EXISTS (assigned_staff_id) REFERENCES tbl_users(user_id);
CREATE INDEX IF NOT EXISTS idx_adoption_assigned ON tbl_adoption_applications (assigned_staff_id);

CREATE TABLE IF NOT EXISTS tbl_unlock_challenges (
    challenge_id    INT AUTO_INCREMENT PRIMARY KEY,
    public_id       CHAR(22) NOT NULL UNIQUE,        -- random; the only thing inside the QR link
    record_type     ENUM('adoption_application', 'child') NOT NULL,
    record_id       VARCHAR(50) NOT NULL,
    user_id         INT NOT NULL,
    purpose         VARCHAR(40) NOT NULL,
    purpose_note    VARCHAR(500) NULL,
    acknowledged_at DATETIME NOT NULL,               -- "I will use this record only for the purpose I selected"
    token_hash      CHAR(64) NOT NULL,
    token_enc       VARCHAR(255) NOT NULL,           -- encrypted, shown only to the same user on their phone
    expires_at      DATETIME NOT NULL,
    used_at         DATETIME NULL,                   -- single use
    replaced_at     DATETIME NULL,                   -- a newer QR replaced this one
    failed_attempts TINYINT UNSIGNED NOT NULL DEFAULT 0,
    created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_challenges_user_record (user_id, record_type, record_id, created_at),
    CONSTRAINT fk_challenges_user FOREIGN KEY (user_id) REFERENCES tbl_users(user_id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS tbl_unlock_sessions (
    session_id   INT AUTO_INCREMENT PRIMARY KEY,
    grant_hash   CHAR(64) NOT NULL UNIQUE,
    challenge_id INT NOT NULL,
    record_type  ENUM('adoption_application', 'child') NOT NULL,
    record_id    VARCHAR(50) NOT NULL,
    user_id      INT NOT NULL,
    purpose      VARCHAR(40) NOT NULL,
    started_at   DATETIME NOT NULL,
    expires_at   DATETIME NOT NULL,
    ended_at     DATETIME NULL,
    end_reason   ENUM('expired', 'locked', 'revoked', 'signed_out') NULL,
    revoked_by   INT NULL,
    INDEX idx_sessions_record (record_type, record_id, started_at),
    INDEX idx_sessions_user (user_id, ended_at),
    CONSTRAINT fk_sessions_challenge FOREIGN KEY (challenge_id) REFERENCES tbl_unlock_challenges(challenge_id),
    CONSTRAINT fk_sessions_user FOREIGN KEY (user_id) REFERENCES tbl_users(user_id),
    CONSTRAINT fk_sessions_revoker FOREIGN KEY (revoked_by) REFERENCES tbl_users(user_id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS tbl_unlock_events (
    event_id    INT AUTO_INCREMENT PRIMARY KEY,
    event       VARCHAR(40) NOT NULL,
    record_type VARCHAR(30) NOT NULL,
    record_id   VARCHAR(50) NOT NULL,
    user_id     INT NULL,
    user_role   VARCHAR(20) NULL,
    purpose     VARCHAR(40) NULL,
    detail      VARCHAR(500) NULL,
    device_type VARCHAR(10) NULL,
    ip_address  VARCHAR(45) NULL,
    created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_unlock_events_time (created_at),
    INDEX idx_unlock_events_record (record_type, record_id, created_at),
    INDEX idx_unlock_events_user (user_id, created_at)
) ENGINE=InnoDB;

DROP TRIGGER IF EXISTS trg_unlock_events_no_update;
CREATE TRIGGER trg_unlock_events_no_update BEFORE UPDATE ON tbl_unlock_events FOR EACH ROW
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'The access log cannot be edited.';
DROP TRIGGER IF EXISTS trg_unlock_events_no_delete;
CREATE TRIGGER trg_unlock_events_no_delete BEFORE DELETE ON tbl_unlock_events FOR EACH ROW
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'The access log cannot be deleted.';

INSERT IGNORE INTO tbl_settings (setting_key, setting_value) VALUES
  ('unlock_minutes', '3'), ('access_log_retention_months', '60'), ('staff_download_doc_types', '');
