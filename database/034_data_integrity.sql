-- Migration 034 - data integrity: nothing is hard-deleted, uploaded files are kept, the audit log records what changed.
--
-- A. Archive instead of delete. Children, visitors, meals, staff shifts and inventory items get
--    archived_at / archived_by / archive_reason. "Delete" in the app now archives: the row stays, normal lists hide it,
--    Admin can list archived rows, see the reason and restore them. Every reference (health, case files, admission,
--    adoption, transition, donations, stock movements, audit log) stays valid because the row is never removed.
-- B. Uploaded files are kept. Adoption documents that a donor removes or replaces while the application is a draft
--    are marked Removed / Replaced and archived (hidden) instead of deleted; the file stays on disk.
--    tbl_retained_files records files that used to be overwritten in place (a child's profile photo, the CDCLAA copy):
--    the old file stays on disk and this table says which record it belonged to, who replaced or removed it and when.
-- C. Audit log details. tbl_activity_logs gets result (SUCCESS / DENIED) and reason. tbl_activity_log_changes holds
--    the changed fields of an audit entry (previous and new value; sensitive fields only "changed: yes").
--    Both tables refuse UPDATE and DELETE (same triggers as migration 010).
--
-- No existing row is changed or removed. Safe to run more than once.
-- Rollback: database/rollback/034_data_integrity_rollback.sql
USE caresphere_db;

-- ------------------------------------------------------------------ A
ALTER TABLE tbl_children
  ADD COLUMN IF NOT EXISTS archived_at    DATETIME NULL,
  ADD COLUMN IF NOT EXISTS archived_by    INT NULL,
  ADD COLUMN IF NOT EXISTS archive_reason VARCHAR(500) NULL,
  ADD INDEX IF NOT EXISTS idx_children_archived (archived_at);
ALTER TABLE tbl_visitors
  ADD COLUMN IF NOT EXISTS archived_at    DATETIME NULL,
  ADD COLUMN IF NOT EXISTS archived_by    INT NULL,
  ADD COLUMN IF NOT EXISTS archive_reason VARCHAR(500) NULL,
  ADD INDEX IF NOT EXISTS idx_visitors_archived (archived_at);
ALTER TABLE tbl_meals
  ADD COLUMN IF NOT EXISTS archived_at    DATETIME NULL,
  ADD COLUMN IF NOT EXISTS archived_by    INT NULL,
  ADD COLUMN IF NOT EXISTS archive_reason VARCHAR(500) NULL,
  ADD INDEX IF NOT EXISTS idx_meals_archived (archived_at);
ALTER TABLE tbl_staff_schedules
  ADD COLUMN IF NOT EXISTS archived_at    DATETIME NULL,
  ADD COLUMN IF NOT EXISTS archived_by    INT NULL,
  ADD COLUMN IF NOT EXISTS archive_reason VARCHAR(500) NULL,
  ADD INDEX IF NOT EXISTS idx_schedules_archived (archived_at);
ALTER TABLE tbl_inventory
  ADD COLUMN IF NOT EXISTS archived_at    DATETIME NULL,
  ADD COLUMN IF NOT EXISTS archived_by    INT NULL,
  ADD COLUMN IF NOT EXISTS archive_reason VARCHAR(500) NULL,
  ADD INDEX IF NOT EXISTS idx_inventory_archived (archived_at);

-- ------------------------------------------------------------------ B
ALTER TABLE tbl_adoption_documents
  MODIFY COLUMN status ENUM('Uploaded', 'Replaced', 'Removed') NOT NULL DEFAULT 'Uploaded',
  ADD COLUMN IF NOT EXISTS archived_by INT NULL;

CREATE TABLE IF NOT EXISTS tbl_retained_files (
    file_id        INT AUTO_INCREMENT PRIMARY KEY,
    area           VARCHAR(40)  NOT NULL COMMENT 'child_photo, cdclaa',
    child_id       VARCHAR(50)  NULL,
    storage_key    VARCHAR(255) NOT NULL COMMENT 'Encrypted file under backend/uploads (kept)',
    original_name  VARCHAR(255) NULL,
    mime_type      VARCHAR(50)  NULL,
    sha256         CHAR(64)     NULL,
    status         ENUM('Replaced', 'Removed') NOT NULL,
    replaced_by_key VARCHAR(255) NULL COMMENT 'The file that took its place (Replaced)',
    reason         VARCHAR(500) NULL,
    actor_id       INT NOT NULL,
    created_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_retained_child (child_id, area),
    CONSTRAINT fk_retained_actor FOREIGN KEY (actor_id) REFERENCES tbl_users(user_id)
) ENGINE=InnoDB;

-- ------------------------------------------------------------------ C
ALTER TABLE tbl_activity_logs
  ADD COLUMN IF NOT EXISTS result VARCHAR(10) NULL COMMENT 'SUCCESS or DENIED; NULL on entries written before 034 (success)',
  ADD COLUMN IF NOT EXISTS reason VARCHAR(500) NULL;

CREATE TABLE IF NOT EXISTS tbl_activity_log_changes (
    change_id    INT AUTO_INCREMENT PRIMARY KEY,
    log_id       INT NOT NULL,
    field_name   VARCHAR(80) NOT NULL,
    old_value    VARCHAR(500) NULL,
    new_value    VARCHAR(500) NULL,
    is_sensitive TINYINT(1) NOT NULL DEFAULT 0 COMMENT '1 = values not stored, only that the field changed',
    INDEX idx_log_changes_log (log_id),
    CONSTRAINT fk_log_changes_log FOREIGN KEY (log_id) REFERENCES tbl_activity_logs(log_id)
) ENGINE=InnoDB;

DROP TRIGGER IF EXISTS trg_activity_log_changes_no_update;
CREATE TRIGGER trg_activity_log_changes_no_update BEFORE UPDATE ON tbl_activity_log_changes FOR EACH ROW
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'The audit log cannot be edited.';
DROP TRIGGER IF EXISTS trg_activity_log_changes_no_delete;
CREATE TRIGGER trg_activity_log_changes_no_delete BEFORE DELETE ON tbl_activity_log_changes FOR EACH ROW
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'The audit log cannot be deleted.';
