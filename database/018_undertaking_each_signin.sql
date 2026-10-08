-- Migration 018 - Confidentiality undertaking on every sign-in (Admin and Staff)
--
-- * tbl_confidentiality_undertakings: one row per accepted sign-in session from now on. Adds the
--   session reference (JWT id), device type and the version row it showed. The old "one per user and
--   version" unique key is replaced by a plain index; existing rows are kept unchanged as history.
-- * tbl_undertaking_versions: the undertaking text per version (Admin edits it in Data protection;
--   each change creates a new version, e.g. CU-2026-2). The first row (CU-2026-1, today's text) is
--   added by the server on first use, from backend/src/services/compliance.js.
-- * Setting undertaking_timeout_minutes (default 10): a sign-in left on the undertaking screen longer
--   than this is signed out.
--
-- Safe to run more than once. Rollback: database/rollback/018_undertaking_each_signin_rollback.sql
USE caresphere_db;

ALTER TABLE tbl_confidentiality_undertakings
  ADD COLUMN IF NOT EXISTS session_jti VARCHAR(64) NULL AFTER version,
  ADD COLUMN IF NOT EXISTS device_type VARCHAR(10) NULL AFTER ip_address,
  ADD COLUMN IF NOT EXISTS version_id INT NULL AFTER version;
CREATE INDEX IF NOT EXISTS idx_undertaking_user_version ON tbl_confidentiality_undertakings (user_id, version);
ALTER TABLE tbl_confidentiality_undertakings DROP INDEX IF EXISTS uq_undertaking;
CREATE UNIQUE INDEX IF NOT EXISTS uq_undertaking_session ON tbl_confidentiality_undertakings (session_jti);

CREATE TABLE IF NOT EXISTS tbl_undertaking_versions (
    version_id       INT AUTO_INCREMENT PRIMARY KEY,
    version          VARCHAR(30) NOT NULL UNIQUE,
    title            VARCHAR(150) NOT NULL,
    paragraphs       TEXT NOT NULL,              -- JSON array, shown exactly as saved
    previous_version VARCHAR(30) NULL,
    created_by       INT NULL,
    created_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_undertaking_versions_user FOREIGN KEY (created_by) REFERENCES tbl_users(user_id)
) ENGINE=InnoDB;

INSERT IGNORE INTO tbl_settings (setting_key, setting_value) VALUES ('undertaking_timeout_minutes', '10');
