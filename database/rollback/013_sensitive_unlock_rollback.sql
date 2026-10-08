-- Rollback for 013. First move database/013_sensitive_unlock.sql out of the database folder.
-- Removes the unlock flow tables (challenges, sessions, access events), the assignment column and
-- the three settings. Health access tokens, protected records and the audit log are not touched.
USE caresphere_db;
SET FOREIGN_KEY_CHECKS = 0;
DROP TRIGGER IF EXISTS trg_unlock_events_no_update;
DROP TRIGGER IF EXISTS trg_unlock_events_no_delete;
DROP TABLE IF EXISTS tbl_unlock_sessions;
DROP TABLE IF EXISTS tbl_unlock_challenges;
DROP TABLE IF EXISTS tbl_unlock_events;
ALTER TABLE tbl_adoption_applications DROP FOREIGN KEY IF EXISTS fk_adoption_assigned_staff;
ALTER TABLE tbl_adoption_applications DROP INDEX IF EXISTS idx_adoption_assigned;
ALTER TABLE tbl_adoption_applications DROP COLUMN IF EXISTS assigned_staff_id;
DELETE FROM tbl_settings WHERE setting_key IN ('unlock_minutes', 'access_log_retention_months', 'staff_download_doc_types');
SET FOREIGN_KEY_CHECKS = 1;
