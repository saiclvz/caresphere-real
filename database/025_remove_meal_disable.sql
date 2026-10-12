-- Migration 025 - remove the meal "disable / remove from plan" feature
--
-- The Meals page no longer has a disable (skip / not served) action, so tbl_meals.is_active is dropped.
-- Nothing else reads it (the dashboard's "Today's meals" and the report's meal count never filtered on it).
--
-- No data is lost: before the column is dropped, the IDs of meals that were disabled are copied to
-- tbl_meals_disabled_backup, so the rollback can restore them. After this migration those meals show on
-- the plan like any other meal; delete them on the Meals page if they shouldn't be there.
--
-- Safe to run more than once (the migration runner runs every file each time).
-- Rollback: database/rollback/025_remove_meal_disable_rollback.sql
USE caresphere_db;

CREATE TABLE IF NOT EXISTS tbl_meals_disabled_backup (
    meal_id      INT PRIMARY KEY,
    backed_up_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

DROP PROCEDURE IF EXISTS cs_025_remove_meal_disable;
CREATE PROCEDURE cs_025_remove_meal_disable()
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.COLUMNS
              WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'tbl_meals' AND COLUMN_NAME = 'is_active') THEN
    INSERT IGNORE INTO tbl_meals_disabled_backup (meal_id) SELECT meal_id FROM tbl_meals WHERE is_active = 0;
    ALTER TABLE tbl_meals DROP COLUMN is_active;
  END IF;
END;
CALL cs_025_remove_meal_disable();
DROP PROCEDURE IF EXISTS cs_025_remove_meal_disable;
