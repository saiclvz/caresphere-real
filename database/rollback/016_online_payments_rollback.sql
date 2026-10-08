-- Rollback for 016. First move database/016_online_payments.sql out of the database folder.
-- Bank-transfer donations still waiting ('Pending verification') become 'Pending'; rejected ones
-- become 'Cancelled', so the old status list fits. Payment records, webhook IDs and the payment
-- method table are removed (uploaded proof files stay on disk). Donations themselves are kept.
USE caresphere_db;
SET FOREIGN_KEY_CHECKS = 0;
UPDATE tbl_donations SET status = 'Pending' WHERE status = 'Pending verification';
UPDATE tbl_donations SET status = 'Cancelled' WHERE status = 'Rejected';
ALTER TABLE tbl_donations MODIFY COLUMN status ENUM('Pending', 'Received', 'Cancelled') NOT NULL DEFAULT 'Received';
DROP TABLE IF EXISTS tbl_payment_webhook_events;
DROP TABLE IF EXISTS tbl_payments;
DROP TABLE IF EXISTS tbl_payment_methods;
DELETE FROM tbl_settings WHERE setting_key = 'default_allocation_text';
SET FOREIGN_KEY_CHECKS = 1;
