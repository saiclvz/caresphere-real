-- Migration 036 - admission lifecycle, document verification, withdrawal.
--
-- A. Lifecycle. tbl_children.admission_status gains 'Referral Received', 'Intake and Assessment' and 'Not Admitted'.
--      Referral Received -> Intake and Assessment -> Pending Approval (shown "Pending Admin Approval") -> Admitted
--      Other outcomes: Declined (Admin decision), Not Admitted (withdrawn before a decision), Discharged (later, by status).
--    'Draft' stays valid for admissions started before 036 (shown as Referral Received or Intake and Assessment from
--    how far they got); nothing is rewritten. tbl_children.status keeps its values: 'Active' is shown as "Admitted".
-- B. Document verification. Each checklist item gets the Admin's verification (Verified, Rejected, Requires
--    correction) with who, when and a note. Approval needs every required document Verified, or an Admin exception
--    with a reason (logged and shown in the admission history; stored in tbl_child_admissions.approval_exceptions).
-- C. Withdrawal. withdrawn_at / withdrawn_by / withdraw_reason on tbl_child_admissions (status Not Admitted). The
--    admission and the child record are kept.
-- D. Settings. admission_required_documents (which checklist items are required; Admin changes it in Settings) and
--    admission_stale_draft_days (unfinished admissions older than this are flagged; never deleted).
-- E. The old "initial access" of the registering Staff member (032) is retired: the admission workflow replaced it.
--    Rows still open are closed (ended_at, end_reason 'replaced_by_admission'); every row is kept as history.
--
-- No row is removed; the only rows changed are the open initial-access rows in E. Safe to run more than once. Rollback: database/rollback/036_admission_lifecycle_rollback.sql
USE caresphere_db;

-- ------------------------------------------------------------------ A
ALTER TABLE tbl_children
  MODIFY COLUMN admission_status ENUM('Draft', 'Referral Received', 'Intake and Assessment', 'Pending Approval', 'Needs Correction',
                                      'Admitted', 'Declined', 'Not Admitted') NOT NULL DEFAULT 'Admitted';

-- ------------------------------------------------------------------ B
ALTER TABLE tbl_child_admission_checklist
  ADD COLUMN IF NOT EXISTS verification_status ENUM('Verified', 'Rejected', 'Requires correction') NULL,
  ADD COLUMN IF NOT EXISTS verification_note   VARCHAR(500) NULL,
  ADD COLUMN IF NOT EXISTS verified_by         INT NULL,
  ADD COLUMN IF NOT EXISTS verified_at         DATETIME NULL;
ALTER TABLE tbl_child_admissions
  ADD COLUMN IF NOT EXISTS approval_exceptions TEXT NULL COMMENT 'JSON: required documents approved without verification, with the Admin reason';

-- ------------------------------------------------------------------ C
ALTER TABLE tbl_child_admissions
  ADD COLUMN IF NOT EXISTS withdrawn_at    DATETIME NULL,
  ADD COLUMN IF NOT EXISTS withdrawn_by    INT NULL,
  ADD COLUMN IF NOT EXISTS withdraw_reason VARCHAR(2000) NULL;

-- ------------------------------------------------------------------ D
INSERT IGNORE INTO tbl_settings (setting_key, setting_value) VALUES
  ('admission_required_documents', 'referral_letter,birth_certificate'),
  ('admission_stale_draft_days', '30');

-- ------------------------------------------------------------------ E
UPDATE tbl_child_initial_access SET ended_at = NOW(), end_reason = 'replaced_by_admission' WHERE ended_at IS NULL;
