-- Rollback for 018. First move database/018_undertaking_each_signin.sql out of the database folder.
-- Removes the session columns and the versions table. Acceptance rows are kept (no deletions), so the
-- old unique (user, version) key is not restored; a plain index takes its place.
USE caresphere_db;
ALTER TABLE tbl_confidentiality_undertakings DROP INDEX IF EXISTS uq_undertaking_session;
ALTER TABLE tbl_confidentiality_undertakings DROP INDEX IF EXISTS idx_undertaking_session_jti;
ALTER TABLE tbl_confidentiality_undertakings DROP COLUMN IF EXISTS session_jti, DROP COLUMN IF EXISTS device_type, DROP COLUMN IF EXISTS version_id;
DROP TABLE IF EXISTS tbl_undertaking_versions;
DELETE FROM tbl_settings WHERE setting_key = 'undertaking_timeout_minutes';
