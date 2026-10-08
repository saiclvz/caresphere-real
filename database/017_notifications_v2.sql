-- Migration 017 - One notification system for Admin, Staff and Donor
--
-- Extends tbl_notifications (from 012) instead of creating a second table:
-- * role, type (the event type; old rows copy their "kind"), category, priority (action / warning /
--   info), entity type and ID (what the notification is about), group key and count (repeat events
--   update one row, and the key also stops duplicates), dismissed_at (hidden, kept until clean-up).
-- * Indexes for the bell and the chips: (user_id, is_read, created_at) and (user_id, category, is_read).
-- * tbl_notification_preferences: categories a user turned off (critical events can't be turned off;
--   that rule is enforced in backend/src/config/notificationEvents.js).
-- * Setting notification_retention_days (default 90). Clean-up is a button for Admin that asks first
--   and is written to the audit log; nothing is deleted automatically.
--
-- Existing notifications keep working: their category is filled from their old kind.
-- Safe to run more than once. Rollback: database/rollback/017_notifications_v2_rollback.sql
USE caresphere_db;

ALTER TABLE tbl_notifications
  ADD COLUMN IF NOT EXISTS role VARCHAR(20) NULL AFTER user_id,
  ADD COLUMN IF NOT EXISTS type VARCHAR(60) NULL AFTER kind,
  ADD COLUMN IF NOT EXISTS category VARCHAR(30) NULL AFTER type,
  ADD COLUMN IF NOT EXISTS priority ENUM('action', 'warning', 'info') NOT NULL DEFAULT 'info' AFTER category,
  ADD COLUMN IF NOT EXISTS entity_type VARCHAR(30) NULL AFTER link,
  ADD COLUMN IF NOT EXISTS entity_id VARCHAR(50) NULL AFTER entity_type,
  ADD COLUMN IF NOT EXISTS group_key VARCHAR(150) NULL AFTER entity_id,
  ADD COLUMN IF NOT EXISTS group_count INT NOT NULL DEFAULT 1 AFTER group_key,
  ADD COLUMN IF NOT EXISTS dismissed_at DATETIME NULL AFTER read_at,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP NULL DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP;

-- Existing rows: type from kind, category from type, role from the user, entity from the application.
UPDATE tbl_notifications SET type = kind WHERE type IS NULL;
UPDATE tbl_notifications SET category = CASE
    WHEN type IN ('application_status', 'documents_requested') THEN 'applications'
    WHEN type IN ('donation_paid', 'donation_confirmed', 'donation_rejected') THEN 'donations'
    WHEN type = 'assignment' THEN 'assignments'
    ELSE 'applications' END
  WHERE category IS NULL;
UPDATE tbl_notifications SET type = 'transfer_confirmed' WHERE type = 'donation_confirmed';
UPDATE tbl_notifications SET type = 'transfer_rejected' WHERE type = 'donation_rejected';
UPDATE tbl_notifications SET type = 'assigned' WHERE type = 'assignment';
UPDATE tbl_notifications SET link = '/donations/history' WHERE link = '/history';
UPDATE tbl_notifications n JOIN tbl_users u ON u.user_id = n.user_id JOIN tbl_roles r ON r.role_id = u.role_id
   SET n.role = r.role_name WHERE n.role IS NULL;
UPDATE tbl_notifications SET entity_type = 'application', entity_id = application_id WHERE entity_type IS NULL AND application_id IS NOT NULL;
UPDATE tbl_notifications SET priority = 'action' WHERE type = 'documents_requested' AND priority = 'info';

CREATE INDEX IF NOT EXISTS idx_notifications_user_read_time ON tbl_notifications (user_id, is_read, created_at);
CREATE INDEX IF NOT EXISTS idx_notifications_user_category ON tbl_notifications (user_id, category, is_read);
CREATE UNIQUE INDEX IF NOT EXISTS uq_notifications_user_group ON tbl_notifications (user_id, group_key);

CREATE TABLE IF NOT EXISTS tbl_notification_preferences (
    user_id    INT NOT NULL,
    category   VARCHAR(30) NOT NULL,
    enabled    BOOLEAN NOT NULL DEFAULT TRUE,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id, category),
    CONSTRAINT fk_notification_prefs_user FOREIGN KEY (user_id) REFERENCES tbl_users(user_id) ON DELETE CASCADE
) ENGINE=InnoDB;

INSERT IGNORE INTO tbl_settings (setting_key, setting_value) VALUES ('notification_retention_days', '90');
