-- Migration 006 - TOTP two-step verification (MFA) for Admin accounts
-- * The TOTP secret is stored encrypted (AES-256-GCM), never in plain text.
-- * Backup codes are stored only as keyed hashes (HMAC-SHA256); each works once.
-- * mfa_last_step blocks reuse of a code that was already accepted.
-- * tokens_valid_after ends older sessions (set when an admin's MFA is reset).
-- * tbl_mfa_challenges holds the short-lived "password OK, code pending" state.
--   It is never a session: protected routes only accept a full session token.
--
-- Safe to run more than once (npm run migrate re-runs every file).
USE caresphere_db;

ALTER TABLE tbl_users
  ADD COLUMN IF NOT EXISTS mfa_enabled        BOOLEAN      NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS mfa_secret_enc     VARCHAR(255) NULL,
  ADD COLUMN IF NOT EXISTS mfa_last_step      BIGINT       NULL,
  ADD COLUMN IF NOT EXISTS mfa_enrolled_at    DATETIME     NULL,
  ADD COLUMN IF NOT EXISTS tokens_valid_after DATETIME     NULL;

CREATE TABLE IF NOT EXISTS tbl_mfa_backup_codes (
    code_id    INT AUTO_INCREMENT PRIMARY KEY,
    user_id    INT NOT NULL,
    code_hash  VARCHAR(64) NOT NULL,
    used_at    DATETIME NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uq_mfa_backup (user_id, code_hash),
    FOREIGN KEY (user_id) REFERENCES tbl_users(user_id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS tbl_mfa_challenges (
    challenge_hash     CHAR(64) PRIMARY KEY,
    user_id            INT NOT NULL,
    purpose            ENUM('setup', 'verify') NOT NULL,
    pending_secret_enc VARCHAR(255) NULL,
    attempts           TINYINT UNSIGNED NOT NULL DEFAULT 0,
    expires_at         DATETIME NOT NULL,
    consumed_at        DATETIME NULL,
    created_at         TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_mfa_challenge_user (user_id),
    INDEX idx_mfa_challenge_expires (expires_at),
    FOREIGN KEY (user_id) REFERENCES tbl_users(user_id) ON DELETE CASCADE
) ENGINE=InnoDB;
