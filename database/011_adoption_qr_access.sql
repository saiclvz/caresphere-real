-- Migration 011 - QR access to adoption data (whole-record tokens) and random QR references
--
-- * public_ref: a random, non-sequential 12-character reference for every application and
--   child, used ONLY inside QR links (/adoption/{public_ref}, /child/{public_ref}).
--   ADP-2026-0004 / CHD-2026-0004 stay as the readable codes. New and existing rows get
--   their public_ref from the app (filled in by `npm run migrate`, scripts/backfillPublicRefs.js).
-- * Protected records can now cover a whole adoption application or a whole child record,
--   so one Admin-issued token unlocks that record's sensitive sections for one staff member.
-- * device_type (phone / tablet / computer) on the audit log and the protected access log.
--
-- Safe to run more than once. Rollback: database/rollback/011_adoption_qr_access_rollback.sql
USE caresphere_db;

ALTER TABLE tbl_adoption_applications ADD COLUMN IF NOT EXISTS public_ref CHAR(12) NULL AFTER reference_no;
CREATE UNIQUE INDEX IF NOT EXISTS uq_adoption_public_ref ON tbl_adoption_applications (public_ref);

ALTER TABLE tbl_children ADD COLUMN IF NOT EXISTS public_ref CHAR(12) NULL AFTER child_id;
CREATE UNIQUE INDEX IF NOT EXISTS uq_child_public_ref ON tbl_children (public_ref);

ALTER TABLE tbl_protected_records
  MODIFY COLUMN record_type ENUM('case_study', 'monitoring_report', 'cdclaa', 'order_of_adoption', 'certificate_of_finality',
                                 'sealed_birth_record', 'document', 'adoption_application', 'child_record') NOT NULL;

ALTER TABLE tbl_activity_logs ADD COLUMN IF NOT EXISTS device_type VARCHAR(10) NULL AFTER ip_address;
ALTER TABLE tbl_protected_access_log ADD COLUMN IF NOT EXISTS device_type VARCHAR(10) NULL AFTER ip_address;
CREATE INDEX IF NOT EXISTS idx_logs_action ON tbl_activity_logs (action_performed(40), timestamp);
