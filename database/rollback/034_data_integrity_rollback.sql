-- Rollback for migration 034 (archive instead of delete, retained files, audit change details).
-- Before running it: move database/034_data_integrity.sql (and any later migrations) out of the database folder
-- (the migration runner re-runs every file) and put back the previous backend and frontend files.
--
-- Nothing is deleted from the main tables. Archived rows become visible again in the previous app, because it does
-- not know the archive columns. List them first if you want to deal with them by hand:
--   SELECT child_id, archived_at, archive_reason FROM tbl_children WHERE archived_at IS NOT NULL;
--   (same for tbl_visitors, tbl_meals, tbl_staff_schedules, tbl_inventory)
-- The audit change details and the retained-file index are dropped with their tables. Export them first:
--   SELECT * FROM tbl_activity_log_changes; SELECT * FROM tbl_retained_files;
-- The files themselves stay in backend/uploads.
USE caresphere_db;
DROP TRIGGER IF EXISTS trg_activity_log_changes_no_update;
DROP TRIGGER IF EXISTS trg_activity_log_changes_no_delete;
DROP TABLE IF EXISTS tbl_activity_log_changes;
DROP TABLE IF EXISTS tbl_retained_files;
ALTER TABLE tbl_activity_logs DROP COLUMN IF EXISTS result, DROP COLUMN IF EXISTS reason;
-- Removed adoption documents go back to Replaced (still archived, so still hidden) before the value is dropped.
UPDATE tbl_adoption_documents SET status = 'Replaced' WHERE status = 'Removed';
ALTER TABLE tbl_adoption_documents MODIFY COLUMN status ENUM('Uploaded', 'Replaced') NOT NULL DEFAULT 'Uploaded',
  DROP COLUMN IF EXISTS archived_by;
ALTER TABLE tbl_children DROP INDEX IF EXISTS idx_children_archived, DROP COLUMN IF EXISTS archived_at, DROP COLUMN IF EXISTS archived_by, DROP COLUMN IF EXISTS archive_reason;
ALTER TABLE tbl_visitors DROP INDEX IF EXISTS idx_visitors_archived, DROP COLUMN IF EXISTS archived_at, DROP COLUMN IF EXISTS archived_by, DROP COLUMN IF EXISTS archive_reason;
ALTER TABLE tbl_meals DROP INDEX IF EXISTS idx_meals_archived, DROP COLUMN IF EXISTS archived_at, DROP COLUMN IF EXISTS archived_by, DROP COLUMN IF EXISTS archive_reason;
ALTER TABLE tbl_staff_schedules DROP INDEX IF EXISTS idx_schedules_archived, DROP COLUMN IF EXISTS archived_at, DROP COLUMN IF EXISTS archived_by, DROP COLUMN IF EXISTS archive_reason;
ALTER TABLE tbl_inventory DROP INDEX IF EXISTS idx_inventory_archived, DROP COLUMN IF EXISTS archived_at, DROP COLUMN IF EXISTS archived_by, DROP COLUMN IF EXISTS archive_reason;
