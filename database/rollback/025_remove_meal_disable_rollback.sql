-- Rollback for 025. First move database/025_remove_meal_disable.sql out of the database folder, and put
-- back the old line in 003_v2_updates.sql (ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE)
-- and the old Meals files, or the disable button won't be there to use the column.
-- Adds tbl_meals.is_active back and marks the meals that were disabled before 025 as disabled again.
USE caresphere_db;

ALTER TABLE tbl_meals ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE;
UPDATE tbl_meals m JOIN tbl_meals_disabled_backup b ON b.meal_id = m.meal_id SET m.is_active = 0;
-- The backup table is kept (it holds only meal IDs). Drop it by hand once you no longer need it:
-- DROP TABLE tbl_meals_disabled_backup;
