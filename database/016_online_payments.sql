-- Migration 016 - Donor payments: e-wallets through PayMongo, bank transfer with proof
--
-- * tbl_payment_methods: the donor's payment choices, editable by Admin (name, type, enabled,
--   order, instructions, account details). Seeded with GCash and Maya (gateway, enabled),
--   GrabPay and ShopeePay / MariBank (gateway, disabled until checked in the sandbox), and Bank
--   transfer (manual). Account details are left EMPTY: Admin fills them in Settings.
-- * tbl_payments: one row per donor payment attempt (gateway or manual): status, amount, method,
--   gateway IDs, transfer reference and date, proof file (encrypted, random name), last 4 digits
--   only, who verified it, rejection reason, and the donation it created.
-- * tbl_payment_webhook_events: PayMongo event IDs already processed (a repeated webhook is ignored).
-- * tbl_donations.status gains 'Pending verification' and 'Rejected' (bank transfers).
-- * Setting default_allocation_text: the allocation put on gateway-paid donations so the receipt
--   can be issued at once (Staff can change it later).
--
-- Existing donations (cash, in-kind, earlier GCash/Maya/Check entries) are unchanged.
-- Safe to run more than once. Rollback: database/rollback/016_online_payments_rollback.sql
USE caresphere_db;

CREATE TABLE IF NOT EXISTS tbl_payment_methods (
    method_id      INT AUTO_INCREMENT PRIMARY KEY,
    code           VARCHAR(30) NOT NULL UNIQUE,
    name           VARCHAR(60) NOT NULL,
    method_group   ENUM('E-wallet', 'Bank transfer') NOT NULL,
    method_type    ENUM('gateway', 'manual') NOT NULL,
    gateway_code   VARCHAR(30) NULL,               -- PayMongo payment_method_types value
    enabled        BOOLEAN NOT NULL DEFAULT FALSE,
    sort_order     SMALLINT NOT NULL DEFAULT 0,
    instructions   VARCHAR(1000) NULL,
    bank_name      VARCHAR(120) NULL,
    account_name   VARCHAR(120) NULL,
    account_number VARCHAR(60) NULL,
    branch         VARCHAR(120) NULL,
    qr_storage_key VARCHAR(255) NULL,               -- optional QR image for manual wallets (encrypted file)
    updated_by     INT NULL,
    updated_at     TIMESTAMP NULL DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT fk_payment_methods_user FOREIGN KEY (updated_by) REFERENCES tbl_users(user_id)
) ENGINE=InnoDB;

INSERT IGNORE INTO tbl_payment_methods (code, name, method_group, method_type, gateway_code, enabled, sort_order, instructions) VALUES
  ('gcash', 'GCash', 'E-wallet', 'gateway', 'gcash', TRUE, 10, 'You will be sent to a secure PayMongo page to pay with GCash.'),
  ('maya', 'Maya', 'E-wallet', 'gateway', 'paymaya', TRUE, 20, 'You will be sent to a secure PayMongo page to pay with Maya.'),
  ('grab_pay', 'GrabPay', 'E-wallet', 'gateway', 'grab_pay', FALSE, 30, 'You will be sent to a secure PayMongo page to pay with GrabPay.'),
  ('shopee_pay', 'ShopeePay / MariBank', 'E-wallet', 'gateway', 'shopee_pay', FALSE, 40, 'You will be sent to a secure PayMongo page to pay with ShopeePay or MariBank.'),
  ('bank_transfer', 'Bank transfer', 'Bank transfer', 'manual', NULL, TRUE, 50, NULL);

CREATE TABLE IF NOT EXISTS tbl_payments (
    payment_id         INT AUTO_INCREMENT PRIMARY KEY,
    donor_id           INT NOT NULL,
    method_id          INT NOT NULL,
    method_name        VARCHAR(60) NOT NULL,         -- as shown to the donor at the time
    gateway            ENUM('paymongo', 'manual') NOT NULL,
    gateway_session_id VARCHAR(100) NULL UNIQUE,     -- PayMongo checkout session ID
    gateway_payment_id VARCHAR(100) NULL UNIQUE,     -- PayMongo payment ID (set when paid)
    amount             DECIMAL(12,2) NOT NULL,       -- decided by the server
    currency           CHAR(3) NOT NULL DEFAULT 'PHP',
    reason             VARCHAR(3000) NOT NULL,
    status             ENUM('pending', 'paid', 'failed', 'cancelled', 'expired', 'pending_verification', 'confirmed', 'rejected') NOT NULL,
    transfer_reference VARCHAR(100) NULL UNIQUE,     -- bank transfer reference (duplicates blocked)
    transfer_date      DATE NULL,
    account_last4      CHAR(4) NULL,                 -- at most the last 4 digits of the donor's account
    proof_storage_key  VARCHAR(255) NULL,
    proof_name         VARCHAR(255) NULL,
    proof_mime         VARCHAR(100) NULL,
    proof_size         INT NULL,
    proof_sha256       CHAR(64) NULL,
    donation_id        INT NULL UNIQUE,              -- the donation this payment created (one only)
    verified_by        INT NULL,
    verified_at        DATETIME NULL,
    rejection_reason   VARCHAR(1000) NULL,
    paid_at            DATETIME NULL,
    created_at         TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at         TIMESTAMP NULL DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_payments_donor (donor_id, created_at),
    INDEX idx_payments_status (status, created_at),
    CONSTRAINT fk_payments_donor FOREIGN KEY (donor_id) REFERENCES tbl_users(user_id),
    CONSTRAINT fk_payments_method FOREIGN KEY (method_id) REFERENCES tbl_payment_methods(method_id),
    CONSTRAINT fk_payments_donation FOREIGN KEY (donation_id) REFERENCES tbl_donations(donation_id),
    CONSTRAINT fk_payments_verifier FOREIGN KEY (verified_by) REFERENCES tbl_users(user_id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS tbl_payment_webhook_events (
    event_id    VARCHAR(100) PRIMARY KEY,
    event_type  VARCHAR(60) NOT NULL,
    payment_id  INT NULL,
    received_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

ALTER TABLE tbl_donations
  MODIFY COLUMN status ENUM('Pending', 'Received', 'Cancelled', 'Pending verification', 'Rejected') NOT NULL DEFAULT 'Received';

INSERT IGNORE INTO tbl_settings (setting_key, setting_value) VALUES
  ('default_allocation_text', 'General support for the children in our care');
