-- Rollback for 020. First move database/020_schedules_v2.sql out of the database folder.
-- Removes the new schedule columns, the areas and batches tables, and the child assignment fields.
-- Shifts are kept: the original area text was never changed. Overnight shifts lose their "ends next day"
-- flag (their end time stays as entered).
USE caresphere_db;
SET FOREIGN_KEY_CHECKS = 0;
ALTER TABLE tbl_staff_schedules DROP FOREIGN KEY IF EXISTS fk_schedules_area, DROP FOREIGN KEY IF EXISTS fk_schedules_batch;
ALTER TABLE tbl_staff_schedules DROP INDEX IF EXISTS idx_sched_user_date, DROP INDEX IF EXISTS idx_sched_batch;
ALTER TABLE tbl_staff_schedules DROP COLUMN IF EXISTS area_id, DROP COLUMN IF EXISTS note, DROP COLUMN IF EXISTS ends_next_day,
  DROP COLUMN IF EXISTS batch_id, DROP COLUMN IF EXISTS updated_at;
DROP TABLE IF EXISTS tbl_schedule_batches;
DROP TABLE IF EXISTS tbl_schedule_areas;
ALTER TABLE tbl_children DROP FOREIGN KEY IF EXISTS fk_children_assigned_by;
ALTER TABLE tbl_children DROP COLUMN IF EXISTS assigned_by, DROP COLUMN IF EXISTS assigned_at;
SET FOREIGN_KEY_CHECKS = 1;
