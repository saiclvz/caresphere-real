-- Rollback for migration 036 (admission lifecycle, document verification, withdrawal).
-- Before running it: move database/036_admission_lifecycle.sql out of the database folder (the migration runner
-- re-runs every file) and put back the previous backend and frontend files.
--
-- Admissions in the new stages are mapped back to the closest earlier value (nothing is deleted):
--   Referral Received, Intake and Assessment -> Draft;  Not Admitted -> Declined (the withdraw reason stays in the history).
-- Check them first:  SELECT child_id, admission_status FROM tbl_children
--                     WHERE admission_status IN ('Referral Received', 'Intake and Assessment', 'Not Admitted');
-- Document verifications and approval exceptions are dropped with their columns; export first if needed:
--   SELECT child_id, doc_key, verification_status, verification_note, verified_by, verified_at FROM tbl_child_admission_checklist
--    WHERE verification_status IS NOT NULL;
--   SELECT child_id, approval_exceptions, withdrawn_at, withdrawn_by, withdraw_reason FROM tbl_child_admissions;
USE caresphere_db;
UPDATE tbl_children SET admission_status = 'Draft' WHERE admission_status IN ('Referral Received', 'Intake and Assessment');
UPDATE tbl_children SET admission_status = 'Declined' WHERE admission_status = 'Not Admitted';
ALTER TABLE tbl_children
  MODIFY COLUMN admission_status ENUM('Draft', 'Pending Approval', 'Needs Correction', 'Admitted', 'Declined') NOT NULL DEFAULT 'Admitted';
ALTER TABLE tbl_child_admission_checklist
  DROP COLUMN IF EXISTS verification_status, DROP COLUMN IF EXISTS verification_note, DROP COLUMN IF EXISTS verified_by, DROP COLUMN IF EXISTS verified_at;
ALTER TABLE tbl_child_admissions
  DROP COLUMN IF EXISTS approval_exceptions, DROP COLUMN IF EXISTS withdrawn_at, DROP COLUMN IF EXISTS withdrawn_by, DROP COLUMN IF EXISTS withdraw_reason;
-- The two settings rows (admission_required_documents, admission_stale_draft_days) are left in tbl_settings; the
-- previous app ignores them.
-- Initial access rows closed by 036 (end_reason 'replaced_by_admission') are reopened only if they have not expired:
UPDATE tbl_child_initial_access SET ended_at = NULL, end_reason = NULL WHERE end_reason = 'replaced_by_admission' AND ends_at > NOW();
