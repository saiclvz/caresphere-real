-- Rollback for 017. First move database/017_notifications_v2.sql out of the database folder.
-- Removes the new columns, indexes, the preferences table and the retention setting. Notifications
-- themselves are kept (with their original kind, title, body, link and read state).
USE caresphere_db;
DROP TABLE IF EXISTS tbl_notification_preferences;
ALTER TABLE tbl_notifications DROP INDEX IF EXISTS uq_notifications_user_group;
ALTER TABLE tbl_notifications DROP INDEX IF EXISTS idx_notifications_user_category;
ALTER TABLE tbl_notifications DROP INDEX IF EXISTS idx_notifications_user_read_time;
ALTER TABLE tbl_notifications
  DROP COLUMN IF EXISTS role, DROP COLUMN IF EXISTS type, DROP COLUMN IF EXISTS category, DROP COLUMN IF EXISTS priority,
  DROP COLUMN IF EXISTS entity_type, DROP COLUMN IF EXISTS entity_id, DROP COLUMN IF EXISTS group_key, DROP COLUMN IF EXISTS group_count,
  DROP COLUMN IF EXISTS dismissed_at, DROP COLUMN IF EXISTS updated_at;
DELETE FROM tbl_settings WHERE setting_key = 'notification_retention_days';
