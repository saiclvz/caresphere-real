-- Rollback for 026. First move database/026_health_access_method.sql out of the database folder.
-- Puts the old ENUM back. Rows with a method the old ENUM doesn't allow are set to 'TYPED_TOKEN' first
-- (otherwise the change would fail or blank them). Note: with the old ENUM, health unlocks fail again in
-- strict SQL mode.
USE caresphere_db;

UPDATE tbl_health_access_tokens SET method = 'TYPED_TOKEN' WHERE method NOT IN ('TYPED_TOKEN', 'PASSWORD');
ALTER TABLE tbl_health_access_tokens MODIFY COLUMN method ENUM('TYPED_TOKEN', 'PASSWORD') NOT NULL;
