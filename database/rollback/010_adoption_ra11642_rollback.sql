-- Rollback for 010_adoption_ra11642.sql: back to the v3 adoption schema (migration 009).
--
-- BEFORE RUNNING:
--   1. Back up the current database (phpMyAdmin > Export).
--   2. Move database/010_adoption_ra11642.sql out of the database folder, otherwise the next
--      `npm run migrate` converts everything again.
--   3. Put back the previous (v3) backend and frontend adoption files.
-- Run in phpMyAdmin (SQL tab) or: mysql -u root caresphere_db < this-file.sql
--
-- Restored from the *_backup_v3 copies: applications, applicant details (unencrypted, as they
-- were), spouse details, household members and documents. Lost: everything created after 010
-- (new stages and dates, protected records and tokens, sealed records, releases, requests,
-- incidents, security events). Uploaded files stay on disk. Child CDCLAA and placement columns
-- are removed; children that 010 marked "not available" (no verified CDCLAA) stay not available.
-- The audit log keeps its rows; only the triggers and the user_role column are removed.
USE caresphere_db;
SET FOREIGN_KEY_CHECKS = 0;

DROP TRIGGER IF EXISTS trg_activity_logs_no_update;
DROP TRIGGER IF EXISTS trg_activity_logs_no_delete;
DROP TRIGGER IF EXISTS trg_security_events_no_update;
DROP TRIGGER IF EXISTS trg_security_events_no_delete;
DROP TRIGGER IF EXISTS trg_protected_log_no_update;
DROP TRIGGER IF EXISTS trg_protected_log_no_delete;
DROP TRIGGER IF EXISTS trg_sealed_log_no_update;
DROP TRIGGER IF EXISTS trg_sealed_log_no_delete;
DROP TRIGGER IF EXISTS trg_releases_no_delete;

DROP TABLE IF EXISTS tbl_protected_grants;
DROP TABLE IF EXISTS tbl_protected_tokens;
DROP TABLE IF EXISTS tbl_protected_access_log;
DROP TABLE IF EXISTS tbl_protected_records;
DROP TABLE IF EXISTS tbl_sealed_access_log;
DROP TABLE IF EXISTS tbl_sealed_records;
DROP TABLE IF EXISTS tbl_information_releases;
DROP TABLE IF EXISTS tbl_data_subject_requests;
DROP TABLE IF EXISTS tbl_security_incidents;
DROP TABLE IF EXISTS tbl_security_events;
DROP TABLE IF EXISTS tbl_session_activity;
DROP TABLE IF EXISTS tbl_confidentiality_undertakings;

-- Restore the adoption tables from the v3 backups (CREATE TABLE ... LIKE keeps columns and
-- indexes; foreign keys are added back below).
DROP TABLE IF EXISTS tbl_adoption_documents, tbl_household_members, tbl_applicant_spouse, tbl_applicant_details, tbl_adoption_applications;
RENAME TABLE tbl_adoption_applications_backup_v3 TO tbl_adoption_applications,
             tbl_applicant_details_backup_v3 TO tbl_applicant_details,
             tbl_applicant_spouse_backup_v3 TO tbl_applicant_spouse,
             tbl_household_members_backup_v3 TO tbl_household_members,
             tbl_adoption_documents_backup_v3 TO tbl_adoption_documents;

ALTER TABLE tbl_adoption_applications
  ADD CONSTRAINT FOREIGN KEY (applicant_id) REFERENCES tbl_users(user_id),
  ADD CONSTRAINT fk_adoption_matched_child FOREIGN KEY (matched_child_id) REFERENCES tbl_children(child_id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_adoption_finalized_by FOREIGN KEY (finalized_by) REFERENCES tbl_users(user_id);
ALTER TABLE tbl_applicant_details
  ADD CONSTRAINT fk_applicant_details_app FOREIGN KEY (application_id) REFERENCES tbl_adoption_applications(application_id) ON DELETE CASCADE;
ALTER TABLE tbl_applicant_spouse
  ADD CONSTRAINT fk_applicant_spouse_app FOREIGN KEY (application_id) REFERENCES tbl_adoption_applications(application_id) ON DELETE CASCADE;
ALTER TABLE tbl_household_members
  ADD CONSTRAINT fk_household_app FOREIGN KEY (application_id) REFERENCES tbl_adoption_applications(application_id) ON DELETE CASCADE;
ALTER TABLE tbl_adoption_documents
  ADD CONSTRAINT FOREIGN KEY (application_id) REFERENCES tbl_adoption_applications(application_id) ON DELETE CASCADE,
  ADD CONSTRAINT FOREIGN KEY (uploaded_by) REFERENCES tbl_users(user_id),
  ADD CONSTRAINT fk_adoption_doc_request FOREIGN KEY (request_id) REFERENCES tbl_application_document_requests(request_id) ON DELETE SET NULL;
ALTER TABLE tbl_application_interviews MODIFY COLUMN kind ENUM('Interview', 'Home visit') NOT NULL;

ALTER TABLE tbl_children
  DROP COLUMN IF EXISTS placement_status, DROP COLUMN IF EXISTS cdclaa_number, DROP COLUMN IF EXISTS cdclaa_date,
  DROP COLUMN IF EXISTS cdclaa_storage_key, DROP COLUMN IF EXISTS cdclaa_original_name, DROP COLUMN IF EXISTS cdclaa_mime,
  DROP COLUMN IF EXISTS cdclaa_size, DROP COLUMN IF EXISTS cdclaa_sha256, DROP COLUMN IF EXISTS cdclaa_recorded_by,
  DROP COLUMN IF EXISTS cdclaa_verified_at, DROP COLUMN IF EXISTS cdclaa_verified_by, DROP COLUMN IF EXISTS original_birth_sealed;
ALTER TABLE tbl_users DROP COLUMN IF EXISTS failed_logins, DROP COLUMN IF EXISTS locked_until;
ALTER TABLE tbl_activity_logs DROP COLUMN IF EXISTS user_role;
DELETE FROM tbl_settings WHERE setting_key IN ('dpo_name', 'dpo_email', 'dpo_phone');

SET FOREIGN_KEY_CHECKS = 1;
SELECT 'Adoption tables restored from the v3 backups.' AS rollback_note;
