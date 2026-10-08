-- Migration 012 - In-app notifications, MFA cleanup for non-Admin accounts, stock history for item edits
--
-- * tbl_notifications: one reusable in-app notification table (first used for donor adoption updates).
--   Text holds only the application reference and the stage, never notes or sensitive data.
-- * Two-step verification is only for Admin accounts: leftover MFA data on Staff/Donor accounts
--   (e.g. an Admin later changed to Donor) is cleared, so "Reset two-step verification" no longer shows.
-- * Stock movements: 'manual_edit' records a quantity changed by editing an item on the Inventory page.
--
-- Safe to run more than once. Rollback: database/rollback/012_notifications_accounts_inventory_rollback.sql
USE caresphere_db;

CREATE TABLE IF NOT EXISTS tbl_notifications (
    notification_id INT AUTO_INCREMENT PRIMARY KEY,
    user_id         INT NOT NULL,
    kind            VARCHAR(40) NOT NULL,           -- application_status, documents_requested, ...
    application_id  INT NULL,
    title           VARCHAR(150) NOT NULL,
    body            VARCHAR(300) NULL,
    link            VARCHAR(200) NULL,              -- an in-app path, e.g. /applications/12
    is_read         BOOLEAN NOT NULL DEFAULT FALSE,
    created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    read_at         DATETIME NULL,
    INDEX idx_notifications_user_unread (user_id, is_read, created_at),
    INDEX idx_notifications_user_app (user_id, application_id, is_read),
    CONSTRAINT fk_notifications_user FOREIGN KEY (user_id) REFERENCES tbl_users(user_id) ON DELETE CASCADE,
    CONSTRAINT fk_notifications_app FOREIGN KEY (application_id) REFERENCES tbl_adoption_applications(application_id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- MFA only applies to Admin accounts.
DELETE b FROM tbl_mfa_backup_codes b JOIN tbl_users u ON u.user_id = b.user_id JOIN tbl_roles r ON r.role_id = u.role_id WHERE r.role_name <> 'Admin';
DELETE c FROM tbl_mfa_challenges c JOIN tbl_users u ON u.user_id = c.user_id JOIN tbl_roles r ON r.role_id = u.role_id WHERE r.role_name <> 'Admin';
UPDATE tbl_users u JOIN tbl_roles r ON r.role_id = u.role_id
   SET u.mfa_enabled = FALSE, u.mfa_secret_enc = NULL, u.mfa_last_step = NULL, u.mfa_enrolled_at = NULL
 WHERE r.role_name <> 'Admin' AND (u.mfa_enabled = TRUE OR u.mfa_secret_enc IS NOT NULL);

ALTER TABLE tbl_inventory_movements MODIFY COLUMN movement_type ENUM('donation_in', 'donation_reversal', 'manual_edit') NOT NULL;
