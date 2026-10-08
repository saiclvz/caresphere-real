-- Rollback for 015. First move database/015_unified_access.sql out of the database folder.
-- 'health' challenges and sessions become 'child' again; session binding and the "assigned by /
-- when" fields are removed; Transition Review assignment is removed (the child's case worker stays).
USE caresphere_db;
SET FOREIGN_KEY_CHECKS = 0;
ALTER TABLE tbl_unlock_challenges MODIFY COLUMN record_type ENUM('adoption_application', 'child', 'transition_review', 'health') NOT NULL;
ALTER TABLE tbl_unlock_sessions   MODIFY COLUMN record_type ENUM('adoption_application', 'child', 'transition_review', 'health') NOT NULL;
UPDATE tbl_unlock_challenges SET record_type = 'child' WHERE record_type = 'health';
UPDATE tbl_unlock_sessions   SET record_type = 'child' WHERE record_type = 'health';
ALTER TABLE tbl_unlock_challenges MODIFY COLUMN record_type ENUM('adoption_application', 'child', 'transition_review') NOT NULL;
ALTER TABLE tbl_unlock_sessions   MODIFY COLUMN record_type ENUM('adoption_application', 'child', 'transition_review') NOT NULL;
DELETE FROM tbl_unlock_challenges WHERE token_enc IS NULL AND used_at IS NULL;
ALTER TABLE tbl_unlock_challenges DROP INDEX IF EXISTS idx_challenges_session, DROP COLUMN IF EXISTS session_jti;
ALTER TABLE tbl_unlock_sessions DROP INDEX IF EXISTS idx_sessions_jti, DROP INDEX IF EXISTS idx_sessions_active, DROP COLUMN IF EXISTS session_jti;
ALTER TABLE tbl_transition_reviews DROP FOREIGN KEY IF EXISTS fk_transition_assigned_staff, DROP FOREIGN KEY IF EXISTS fk_transition_assigned_by;
ALTER TABLE tbl_transition_reviews DROP INDEX IF EXISTS idx_transition_assigned;
ALTER TABLE tbl_transition_reviews DROP COLUMN IF EXISTS assigned_staff_id, DROP COLUMN IF EXISTS assigned_by, DROP COLUMN IF EXISTS assigned_at;
ALTER TABLE tbl_adoption_applications DROP FOREIGN KEY IF EXISTS fk_adoption_assigned_by;
ALTER TABLE tbl_adoption_applications DROP COLUMN IF EXISTS assigned_by, DROP COLUMN IF EXISTS assigned_at;
SET FOREIGN_KEY_CHECKS = 1;
