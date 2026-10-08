-- Migration 020 - Staff schedules: areas list, day editing, bulk actions with undo, overnight shifts;
-- shared assignment fields for the child case worker
--
-- * tbl_schedule_areas: the area dropdown (Admin manages it in Settings). Seeded with Front Desk,
--   Nursery, Kitchen, Laundry and Office.
-- * tbl_staff_schedules: area_id (existing shifts are matched to an area by their text, ignoring case
--   and spaces; the original text in `assignment` is kept unchanged), an optional note, ends_next_day
--   (crosses midnight), batch_id (bulk actions, for undo), updated_at, and indexes.
--   Shifts whose text matches no area keep area_id NULL; Settings lists them so Admin can map them.
-- * tbl_schedule_batches: each bulk action (create, copy day, copy week) with what it replaced, so the
--   last one can be undone.
-- * tbl_children: assigned_by and assigned_at, so the case worker uses the same assignment logic as
--   adoption applications and transition reviews.
--
-- No shift is deleted. Safe to run more than once. Rollback: database/rollback/020_schedules_v2_rollback.sql
USE caresphere_db;

CREATE TABLE IF NOT EXISTS tbl_schedule_areas (
    area_id    INT AUTO_INCREMENT PRIMARY KEY,
    name       VARCHAR(60) NOT NULL UNIQUE,
    is_active  BOOLEAN NOT NULL DEFAULT TRUE,
    sort_order SMALLINT NOT NULL DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;
INSERT IGNORE INTO tbl_schedule_areas (name, sort_order) VALUES
  ('Front Desk', 10), ('Nursery', 20), ('Kitchen', 30), ('Laundry', 40), ('Office', 50);

CREATE TABLE IF NOT EXISTS tbl_schedule_batches (
    batch_id   INT AUTO_INCREMENT PRIMARY KEY,
    kind       ENUM('create', 'copy_day', 'copy_week') NOT NULL,
    summary    VARCHAR(255) NOT NULL,
    replaced   JSON NULL,                 -- shifts this action replaced (restored by undo)
    created_by INT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    undone_at  DATETIME NULL,
    CONSTRAINT fk_schedule_batches_user FOREIGN KEY (created_by) REFERENCES tbl_users(user_id)
) ENGINE=InnoDB;

ALTER TABLE tbl_staff_schedules
  ADD COLUMN IF NOT EXISTS area_id INT NULL AFTER assignment,
  ADD COLUMN IF NOT EXISTS note VARCHAR(300) NULL AFTER area_id,
  ADD COLUMN IF NOT EXISTS ends_next_day BOOLEAN NOT NULL DEFAULT FALSE AFTER end_time,
  ADD COLUMN IF NOT EXISTS batch_id INT NULL AFTER note,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP NULL DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP;
ALTER TABLE tbl_staff_schedules
  ADD CONSTRAINT fk_schedules_area FOREIGN KEY IF NOT EXISTS (area_id) REFERENCES tbl_schedule_areas(area_id),
  ADD CONSTRAINT fk_schedules_batch FOREIGN KEY IF NOT EXISTS (batch_id) REFERENCES tbl_schedule_batches(batch_id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_sched_user_date ON tbl_staff_schedules (user_id, shift_date);
CREATE INDEX IF NOT EXISTS idx_sched_batch ON tbl_staff_schedules (batch_id);

-- Match existing shifts to an area by text ("kitchen", " Kitchen " -> Kitchen). The text stays as it was.
UPDATE tbl_staff_schedules s JOIN tbl_schedule_areas a ON LOWER(TRIM(s.assignment)) = LOWER(a.name)
   SET s.area_id = a.area_id WHERE s.area_id IS NULL;

ALTER TABLE tbl_children
  ADD COLUMN IF NOT EXISTS assigned_by INT NULL AFTER assigned_staff_id,
  ADD COLUMN IF NOT EXISTS assigned_at DATETIME NULL AFTER assigned_by;
ALTER TABLE tbl_children
  ADD CONSTRAINT fk_children_assigned_by FOREIGN KEY IF NOT EXISTS (assigned_by) REFERENCES tbl_users(user_id);
