-- Rollback for 011_adoption_qr_access.sql
-- First move database/011_adoption_qr_access.sql out of the database folder, then run this in
-- phpMyAdmin. Whole-record tokens and their grants are removed; per-document protected
-- records and their tokens stay. QR labels printed with public references stop working.
USE caresphere_db;
SET FOREIGN_KEY_CHECKS = 0;

DELETE g FROM tbl_protected_grants g JOIN tbl_protected_records r ON r.record_id = g.record_id
 WHERE r.record_type IN ('adoption_application', 'child_record');
DELETE t FROM tbl_protected_tokens t JOIN tbl_protected_records r ON r.record_id = t.record_id
 WHERE r.record_type IN ('adoption_application', 'child_record');
DELETE FROM tbl_protected_records WHERE record_type IN ('adoption_application', 'child_record');
ALTER TABLE tbl_protected_records
  MODIFY COLUMN record_type ENUM('case_study', 'monitoring_report', 'cdclaa', 'order_of_adoption', 'certificate_of_finality',
                                 'sealed_birth_record', 'document') NOT NULL;

ALTER TABLE tbl_adoption_applications DROP INDEX IF EXISTS uq_adoption_public_ref;
ALTER TABLE tbl_adoption_applications DROP COLUMN IF EXISTS public_ref;
ALTER TABLE tbl_children DROP INDEX IF EXISTS uq_child_public_ref;
ALTER TABLE tbl_children DROP COLUMN IF EXISTS public_ref;
-- The audit logs keep their rows; only the device_type column is removed (the triggers block row edits, not schema changes).
ALTER TABLE tbl_activity_logs DROP INDEX IF EXISTS idx_logs_action;
ALTER TABLE tbl_activity_logs DROP COLUMN IF EXISTS device_type;
ALTER TABLE tbl_protected_access_log DROP COLUMN IF EXISTS device_type;

SET FOREIGN_KEY_CHECKS = 1;
SELECT 'Rollback of 011 complete.' AS rollback_note;
