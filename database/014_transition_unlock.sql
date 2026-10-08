-- Migration 014 - Transition Review (18+) uses the shared sensitive-record unlock flow
--
-- * Record type 'transition_review' in the unlock challenge and session tables (shared module;
--   tbl_unlock_events already stores the type as text).
-- * tbl_children.assigned_staff_id: the case worker (Admin sets it). Need-to-know for the
--   transition review: only that staff member can unlock it.
-- * tbl_transition_reviews: optional "young person informed of this review and their data rights"
--   (date, who informed them, who recorded it). It never blocks saving.
--
-- Existing reviews, tokens and logs keep working. Nothing here discharges or deletes a record.
-- Safe to run more than once. Rollback: database/rollback/014_transition_unlock_rollback.sql
USE caresphere_db;

ALTER TABLE tbl_unlock_challenges MODIFY COLUMN record_type ENUM('adoption_application', 'child', 'transition_review') NOT NULL;
ALTER TABLE tbl_unlock_sessions   MODIFY COLUMN record_type ENUM('adoption_application', 'child', 'transition_review') NOT NULL;

ALTER TABLE tbl_children ADD COLUMN IF NOT EXISTS assigned_staff_id INT NULL;
ALTER TABLE tbl_children
  ADD CONSTRAINT fk_children_assigned_staff FOREIGN KEY IF NOT EXISTS (assigned_staff_id) REFERENCES tbl_users(user_id);
CREATE INDEX IF NOT EXISTS idx_children_assigned ON tbl_children (assigned_staff_id);

ALTER TABLE tbl_transition_reviews
  ADD COLUMN IF NOT EXISTS informed_at DATE NULL,
  ADD COLUMN IF NOT EXISTS informed_by VARCHAR(150) NULL,
  ADD COLUMN IF NOT EXISTS informed_recorded_by INT NULL;
ALTER TABLE tbl_transition_reviews
  ADD CONSTRAINT fk_transition_informed_recorder FOREIGN KEY IF NOT EXISTS (informed_recorded_by) REFERENCES tbl_users(user_id);
