-- Rollback for 023. First move database/023_staff_duties.sql out of the database folder.
-- Removes the duties (Staff go back to every area). No other data is touched.
USE caresphere_db;
DROP TABLE IF EXISTS tbl_staff_duties;
DELETE FROM tbl_migration_markers WHERE marker = '023_staff_duties_seeded';
