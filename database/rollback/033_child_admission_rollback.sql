-- Rollback for migration 033 (child admission workflow).
-- Before running it: move database/033_child_admission.sql out of the database folder (the migration runner re-runs
-- every file) and put back the previous backend and frontend files.
--
-- Nothing is deleted from tbl_children. Children still in admission keep status 'In admission' (the value stays in
-- the status list so their rows remain valid); the previous app shows them under that status, where an Admin can
-- set them Active or Discharged. Check them first:
--   SELECT child_id, admission_status FROM tbl_children WHERE status = 'In admission';
-- What is dropped: the admission details (referral, parent/guardian entries, checklist, uploaded copies' index,
-- history). Export them first if you want to keep them:
--   SELECT * FROM tbl_child_admissions; SELECT * FROM tbl_child_admission_history;
--   SELECT * FROM tbl_child_admission_checklist; SELECT * FROM tbl_child_admission_files;
-- The uploaded files themselves stay in backend/uploads (encrypted).
USE caresphere_db;
SET FOREIGN_KEY_CHECKS = 0;
DROP TABLE IF EXISTS tbl_child_admission_files;
DROP TABLE IF EXISTS tbl_child_admission_checklist;
DROP TABLE IF EXISTS tbl_child_admission_history;
DROP TABLE IF EXISTS tbl_child_admissions;
SET FOREIGN_KEY_CHECKS = 1;
ALTER TABLE tbl_children DROP COLUMN IF EXISTS admission_status;
DELETE FROM tbl_child_field_levels WHERE field_key IN ('admission_referral', 'admission_family', 'admission_documents', 'admission_medical_documents');
-- The "admission" duty rows are left in tbl_staff_duties (the previous app ignores unknown duties). To remove them:
--   DELETE FROM tbl_staff_duties WHERE duty = 'admission';
