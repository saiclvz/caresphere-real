-- Rollback for 014. First move database/014_transition_unlock.sql out of the database folder.
-- Transition-review unlock challenges and sessions are removed before the type list is narrowed
-- (their access-log rows in tbl_unlock_events stay). The case-worker assignment and the
-- "young person informed" fields are removed. Reviews themselves are not touched.
USE caresphere_db;
SET FOREIGN_KEY_CHECKS = 0;
DELETE FROM tbl_unlock_sessions WHERE record_type = 'transition_review';
DELETE FROM tbl_unlock_challenges WHERE record_type = 'transition_review';
ALTER TABLE tbl_unlock_challenges MODIFY COLUMN record_type ENUM('adoption_application', 'child') NOT NULL;
ALTER TABLE tbl_unlock_sessions   MODIFY COLUMN record_type ENUM('adoption_application', 'child') NOT NULL;
ALTER TABLE tbl_children DROP FOREIGN KEY IF EXISTS fk_children_assigned_staff;
ALTER TABLE tbl_children DROP INDEX IF EXISTS idx_children_assigned;
ALTER TABLE tbl_children DROP COLUMN IF EXISTS assigned_staff_id;
ALTER TABLE tbl_transition_reviews DROP FOREIGN KEY IF EXISTS fk_transition_informed_recorder;
ALTER TABLE tbl_transition_reviews DROP COLUMN IF EXISTS informed_at, DROP COLUMN IF EXISTS informed_by, DROP COLUMN IF EXISTS informed_recorded_by;
SET FOREIGN_KEY_CHECKS = 1;
