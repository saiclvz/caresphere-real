-- Migration 015 - One access flow for health, adoption applications and Transition Review
--
-- * Record type 'child' becomes 'health' (existing challenges and sessions are converted; old
--   access-log rows keep 'child', which the Audit log shows as Health, because that log can't be edited).
-- * Tokens and unlock sessions are bound to the signed-in session (JWT id) that made the QR.
-- * The QR now holds plain text, so the encrypted copy for the phone page is no longer needed.
-- * Assigned staff on Transition Review (copied from the child's case worker), and "assigned by /
--   when" on adoption applications and transition reviews. Unassigned by default.
-- * The unlock length moved to backend/src/config/sensitiveAccess.js (the unlock_minutes setting is
--   no longer read; the row is left in place).
--
-- Safe to run more than once. Rollback: database/rollback/015_unified_access_rollback.sql
USE caresphere_db;

ALTER TABLE tbl_unlock_challenges MODIFY COLUMN record_type ENUM('adoption_application', 'child', 'transition_review', 'health') NOT NULL;
ALTER TABLE tbl_unlock_sessions   MODIFY COLUMN record_type ENUM('adoption_application', 'child', 'transition_review', 'health') NOT NULL;
UPDATE tbl_unlock_challenges SET record_type = 'health' WHERE record_type = 'child';
UPDATE tbl_unlock_sessions   SET record_type = 'health' WHERE record_type = 'child';
ALTER TABLE tbl_unlock_challenges MODIFY COLUMN record_type ENUM('adoption_application', 'transition_review', 'health') NOT NULL;
ALTER TABLE tbl_unlock_sessions   MODIFY COLUMN record_type ENUM('adoption_application', 'transition_review', 'health') NOT NULL;

ALTER TABLE tbl_unlock_challenges
  ADD COLUMN IF NOT EXISTS session_jti VARCHAR(64) NULL AFTER user_id,
  MODIFY COLUMN token_enc VARCHAR(255) NULL;
ALTER TABLE tbl_unlock_sessions ADD COLUMN IF NOT EXISTS session_jti VARCHAR(64) NULL AFTER user_id;
CREATE INDEX IF NOT EXISTS idx_challenges_session ON tbl_unlock_challenges (session_jti);
CREATE INDEX IF NOT EXISTS idx_sessions_jti ON tbl_unlock_sessions (session_jti);
CREATE INDEX IF NOT EXISTS idx_sessions_active ON tbl_unlock_sessions (ended_at, expires_at);

ALTER TABLE tbl_transition_reviews
  ADD COLUMN IF NOT EXISTS assigned_staff_id INT NULL,
  ADD COLUMN IF NOT EXISTS assigned_by INT NULL,
  ADD COLUMN IF NOT EXISTS assigned_at DATETIME NULL;
UPDATE tbl_transition_reviews tr JOIN tbl_children c ON c.child_id = tr.child_id
   SET tr.assigned_staff_id = c.assigned_staff_id
 WHERE tr.assigned_staff_id IS NULL AND c.assigned_staff_id IS NOT NULL;
ALTER TABLE tbl_transition_reviews
  ADD CONSTRAINT fk_transition_assigned_staff FOREIGN KEY IF NOT EXISTS (assigned_staff_id) REFERENCES tbl_users(user_id),
  ADD CONSTRAINT fk_transition_assigned_by FOREIGN KEY IF NOT EXISTS (assigned_by) REFERENCES tbl_users(user_id);
CREATE INDEX IF NOT EXISTS idx_transition_assigned ON tbl_transition_reviews (assigned_staff_id);

ALTER TABLE tbl_adoption_applications
  ADD COLUMN IF NOT EXISTS assigned_by INT NULL AFTER assigned_staff_id,
  ADD COLUMN IF NOT EXISTS assigned_at DATETIME NULL AFTER assigned_by;
ALTER TABLE tbl_adoption_applications
  ADD CONSTRAINT fk_adoption_assigned_by FOREIGN KEY IF NOT EXISTS (assigned_by) REFERENCES tbl_users(user_id);
