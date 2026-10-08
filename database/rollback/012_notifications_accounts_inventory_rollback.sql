-- Rollback for 012. First move database/012_notifications_accounts_inventory.sql out of the
-- database folder, and change 008's movement_type list back to ('donation_in', 'donation_reversal').
-- Notifications are removed. Cleared MFA data on non-Admin accounts is not restored (it was unused).
-- Stock history rows from item edits are removed before the type list is narrowed.
USE caresphere_db;
DROP TABLE IF EXISTS tbl_notifications;
DELETE FROM tbl_inventory_movements WHERE movement_type = 'manual_edit';
ALTER TABLE tbl_inventory_movements MODIFY COLUMN movement_type ENUM('donation_in', 'donation_reversal') NOT NULL;
