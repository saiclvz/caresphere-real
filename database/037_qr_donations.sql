-- Migration 037 - QR-only donations: no online payment processing.
--
-- CareSphere no longer processes, confirms or holds payments. Donors pay outside the system (their own e-wallet or
-- bank app, scanning the home's QR code) and tell the home what they sent; staff check the home's real account and
-- verify. This migration:
--
-- A. Payment QR (Settings > Payment QR, Admin only): payment methods gain QR fields; every change to a QR image,
--    account name or number is a version in tbl_payment_qr_versions (immutable: no UPDATE, no DELETE) made through a
--    change request (tbl_payment_qr_changes) that needs re-authentication, a reason and, when the home has two or
--    more Admins, a second Admin's approval. Donor reports of a wrong QR: tbl_qr_problem_reports.
-- B. Donor claims on tbl_donations: reported and verified amounts in separate columns, the method and normalized
--    transfer reference with a UNIQUE key (method, reference) across portal and staff-entered donations (race-safe:
--    the database refuses the second row), time sent, claim status, stale flag, consent time.
--    Amounts become DECIMAL(12,2).
-- C. Approvals (amount differences, second verifier, cash dual control): tbl_donation_approvals.
-- D. Reconciliation: tbl_reconciliation_imports (log of every import and who did it) and tbl_reconciliation_lines.
-- E. Cash: sequential acknowledgment numbers (ACK-YYYY-NNNN, separate from the random verification code) and the
--    daily cash count Admin signs off (tbl_cash_counts).
-- F. Security: one-time re-authentication grants (tbl_reauth_grants), temporary-password fields on tbl_users, and
--    duplicate-file flag on donation documents.
-- G. Legacy gateway data is kept and made READ-ONLY: tbl_payments and tbl_payment_webhook_events refuse UPDATE and
--    DELETE from now on. Nothing is dropped. How each legacy row maps to the new donation fields is a separate,
--    reviewable step (it changes tbl_donations, never tbl_payments):
--        node scripts/mapLegacyPayments.js            (dry run: lists every legacy payment row and its mapping)
--        node scripts/mapLegacyPayments.js --apply    (applies it in one transaction; writes tbl_legacy_payment_map)
-- H. Settings for the limits below (all editable in Settings).
--
-- No existing row is deleted. Safe to run more than once.
-- Rollback: database/rollback/037_qr_donations_rollback.sql
USE caresphere_db;

-- ------------------------------------------------------------------ A. payment methods and QR versions
ALTER TABLE tbl_payment_methods
  MODIFY COLUMN method_type ENUM('gateway', 'manual', 'qr') NOT NULL DEFAULT 'qr',
  ADD COLUMN IF NOT EXISTS current_version_id INT NULL COMMENT 'the QR version donors see (tbl_payment_qr_versions)',
  ADD COLUMN IF NOT EXISTS qr_updated_at      DATETIME NULL,
  ADD COLUMN IF NOT EXISTS last_confirmed_by  INT NULL,
  ADD COLUMN IF NOT EXISTS last_confirmed_at  DATETIME NULL,
  ADD COLUMN IF NOT EXISTS created_at         DATETIME NULL,
  ADD COLUMN IF NOT EXISTS legacy_method_type VARCHAR(10) NULL COMMENT 'method_type before migration 037 (kept for rollback)',
  ADD COLUMN IF NOT EXISTS legacy_instructions VARCHAR(1000) NULL COMMENT 'gateway instructions before migration 037 (kept for rollback)';

CREATE TABLE IF NOT EXISTS tbl_payment_qr_versions (
    version_id      INT AUTO_INCREMENT PRIMARY KEY,
    method_id       INT NOT NULL,
    version_no      INT NOT NULL,
    label           VARCHAR(60) NOT NULL,
    method_group    ENUM('E-wallet', 'Bank transfer') NOT NULL,
    account_name    VARCHAR(120) NOT NULL,
    account_number  VARCHAR(60) NULL,
    bank_name       VARCHAR(120) NULL COMMENT 'bank or e-wallet name',
    instructions    VARCHAR(1000) NULL,
    qr_storage_key  VARCHAR(255) NOT NULL COMMENT 'encrypted, re-encoded image (metadata removed); the old image is kept',
    qr_sha256       CHAR(64) NOT NULL,
    qr_format       ENUM('qrph', 'other') NOT NULL,
    qr_decoded_name VARCHAR(120) NULL COMMENT 'merchant / account name read from a QR Ph (EMV) payload',
    qr_payload_sha256 CHAR(64) NOT NULL COMMENT 'hash of the decoded QR text (the text itself is in the change request)',
    reason          VARCHAR(500) NOT NULL,
    change_id       INT NULL,
    created_by      INT NOT NULL COMMENT 'the Admin who requested the change',
    approved_by     INT NULL COMMENT 'the second Admin, when one was required',
    created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uq_qr_version (method_id, version_no),
    CONSTRAINT fk_qrv_method FOREIGN KEY (method_id) REFERENCES tbl_payment_methods(method_id),
    CONSTRAINT fk_qrv_creator FOREIGN KEY (created_by) REFERENCES tbl_users(user_id),
    CONSTRAINT fk_qrv_approver FOREIGN KEY (approved_by) REFERENCES tbl_users(user_id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS tbl_payment_qr_changes (
    change_id        INT AUTO_INCREMENT PRIMARY KEY,
    method_id        INT NULL COMMENT 'NULL = a new method',
    action           ENUM('create', 'update_qr', 'update_details') NOT NULL,
    label            VARCHAR(60) NOT NULL,
    method_group     ENUM('E-wallet', 'Bank transfer') NOT NULL,
    account_name     VARCHAR(120) NOT NULL,
    account_number   VARCHAR(60) NULL,
    bank_name        VARCHAR(120) NULL,
    instructions     VARCHAR(1000) NULL,
    qr_storage_key   VARCHAR(255) NOT NULL,
    qr_sha256        CHAR(64) NOT NULL,
    qr_format        ENUM('qrph', 'other') NOT NULL,
    qr_decoded_text  TEXT NULL COMMENT 'shown to the approving Admin before saving',
    qr_decoded_name  VARCHAR(120) NULL,
    name_mismatch    BOOLEAN NOT NULL DEFAULT FALSE,
    reason           VARCHAR(500) NOT NULL,
    requested_by     INT NOT NULL,
    requested_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    needs_second     BOOLEAN NOT NULL DEFAULT TRUE,
    status           ENUM('Pending', 'Applied', 'Rejected', 'Cancelled') NOT NULL DEFAULT 'Pending',
    decided_by       INT NULL,
    decided_at       DATETIME NULL,
    decision_note    VARCHAR(500) NULL,
    version_id       INT NULL,
    INDEX idx_qrc_status (status, requested_at),
    CONSTRAINT fk_qrc_method FOREIGN KEY (method_id) REFERENCES tbl_payment_methods(method_id),
    CONSTRAINT fk_qrc_requester FOREIGN KEY (requested_by) REFERENCES tbl_users(user_id),
    CONSTRAINT fk_qrc_decider FOREIGN KEY (decided_by) REFERENCES tbl_users(user_id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS tbl_qr_problem_reports (
    report_id       INT AUTO_INCREMENT PRIMARY KEY,
    method_id       INT NOT NULL,
    version_id      INT NULL,
    reported_by     INT NOT NULL,
    problem         ENUM('name_mismatch', 'does_not_scan', 'wrong_details', 'looks_altered', 'other') NOT NULL,
    note            VARCHAR(500) NULL,
    created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    status          ENUM('Open', 'Resolved') NOT NULL DEFAULT 'Open',
    resolved_by     INT NULL,
    resolved_at     DATETIME NULL,
    resolution_note VARCHAR(500) NULL,
    INDEX idx_qrp_status (status, created_at),
    CONSTRAINT fk_qrp_method FOREIGN KEY (method_id) REFERENCES tbl_payment_methods(method_id),
    CONSTRAINT fk_qrp_user FOREIGN KEY (reported_by) REFERENCES tbl_users(user_id)
) ENGINE=InnoDB;

-- QR versions are evidence: never edited or removed.
DROP TRIGGER IF EXISTS trg_qr_versions_no_update;
CREATE TRIGGER trg_qr_versions_no_update BEFORE UPDATE ON tbl_payment_qr_versions FOR EACH ROW
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Payment QR versions cannot be edited.';
DROP TRIGGER IF EXISTS trg_qr_versions_no_delete;
CREATE TRIGGER trg_qr_versions_no_delete BEFORE DELETE ON tbl_payment_qr_versions FOR EACH ROW
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Payment QR versions cannot be deleted.';

-- ------------------------------------------------------------------ B. donor claims on donations
ALTER TABLE tbl_donations MODIFY COLUMN amount DECIMAL(12,2) NOT NULL;
ALTER TABLE tbl_donations
  ADD COLUMN IF NOT EXISTS payment_method_id  INT NULL,
  ADD COLUMN IF NOT EXISTS qr_version_id      INT NULL COMMENT 'the QR version shown when the donor reported',
  ADD COLUMN IF NOT EXISTS reported_amount    DECIMAL(12,2) NULL COMMENT 'what the donor said they sent; never changed',
  ADD COLUMN IF NOT EXISTS verified_amount    DECIMAL(12,2) NULL COMMENT 'what the home received; the only figure in totals',
  ADD COLUMN IF NOT EXISTS ref_method         VARCHAR(30) NULL COMMENT 'payment method code for the duplicate-reference key',
  ADD COLUMN IF NOT EXISTS reference_raw      VARCHAR(100) NULL,
  ADD COLUMN IF NOT EXISTS reference_norm     VARCHAR(64) NULL COMMENT 'trimmed, upper case, no spaces or dashes',
  ADD COLUMN IF NOT EXISTS sent_at            DATETIME NULL,
  ADD COLUMN IF NOT EXISTS sender_hint        VARCHAR(60) NULL COMMENT 'name on the sending account or last 4 digits',
  ADD COLUMN IF NOT EXISTS donor_note         VARCHAR(500) NULL,
  ADD COLUMN IF NOT EXISTS claim_status       ENUM('Reported', 'Details requested', 'Awaiting approval', 'Verified', 'Not matched', 'Withdrawn', 'Legacy cancelled') NULL COMMENT 'Legacy cancelled is shown as Cancelled (legacy)',
  ADD COLUMN IF NOT EXISTS claim_reported_at  DATETIME NULL,
  ADD COLUMN IF NOT EXISTS claim_message      VARCHAR(500) NULL COMMENT 'the message from the home to the donor (never internal notes)',
  ADD COLUMN IF NOT EXISTS stale_flagged_at   DATETIME NULL,
  ADD COLUMN IF NOT EXISTS verified_reference VARCHAR(100) NULL,
  ADD COLUMN IF NOT EXISTS verified_received_on DATE NULL,
  ADD COLUMN IF NOT EXISTS verified_by        INT NULL,
  ADD COLUMN IF NOT EXISTS verified_at        DATETIME NULL,
  ADD COLUMN IF NOT EXISTS amount_diff_reason VARCHAR(500) NULL,
  ADD COLUMN IF NOT EXISTS consent_at         DATETIME NULL,
  ADD COLUMN IF NOT EXISTS consent_version    VARCHAR(40) NULL,
  ADD COLUMN IF NOT EXISTS legacy_payment_id  INT NULL COMMENT 'the read-only tbl_payments row this donation came from',
  ADD COLUMN IF NOT EXISTS recorded_by        INT NULL COMMENT 'the staff member who recorded it (segregation of duties)',
  ADD COLUMN IF NOT EXISTS dual_control       ENUM('Waiting', 'Approved') NULL COMMENT 'cash above the threshold: a second person confirms',
  ADD COLUMN IF NOT EXISTS ref_key            VARCHAR(100) GENERATED ALWAYS AS (CASE WHEN reference_norm IS NULL OR claim_status = 'Withdrawn' OR status = 'Voided' THEN NULL ELSE CONCAT(ref_method, ':', reference_norm) END) STORED;
ALTER TABLE tbl_donations ADD UNIQUE INDEX IF NOT EXISTS uq_donation_ref_key (ref_key);
CREATE INDEX IF NOT EXISTS idx_donations_claim ON tbl_donations (claim_status, claim_reported_at);
ALTER TABLE tbl_donations
  ADD CONSTRAINT fk_donation_method FOREIGN KEY IF NOT EXISTS (payment_method_id) REFERENCES tbl_payment_methods(method_id),
  ADD CONSTRAINT fk_donation_verifier FOREIGN KEY IF NOT EXISTS (verified_by) REFERENCES tbl_users(user_id),
  ADD CONSTRAINT fk_donation_recorder FOREIGN KEY IF NOT EXISTS (recorded_by) REFERENCES tbl_users(user_id);

ALTER TABLE tbl_donation_documents
  ADD COLUMN IF NOT EXISTS duplicate_of INT NULL COMMENT 'another document with the same SHA-256 (flag only; a proof is never verification)';
ALTER TABLE tbl_donation_documents
  MODIFY COLUMN kind ENUM('delivery_receipt', 'proof_of_transfer', 'photo', 'other', 'donor_proof') NOT NULL;

-- Messages on a donor report: the donor's replies and the home's messages to the donor (internal notes are never
-- shown to donors; they are kept as author_role 'internal'). Insert-only.
CREATE TABLE IF NOT EXISTS tbl_donation_claim_notes (
    note_id      INT AUTO_INCREMENT PRIMARY KEY,
    donation_id  INT NOT NULL,
    author_role  ENUM('donor', 'home', 'internal') NOT NULL,
    user_id      INT NOT NULL,
    note         VARCHAR(500) NOT NULL,
    created_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_claim_notes (donation_id, created_at),
    CONSTRAINT fk_cnote_donation FOREIGN KEY (donation_id) REFERENCES tbl_donations(donation_id),
    CONSTRAINT fk_cnote_user FOREIGN KEY (user_id) REFERENCES tbl_users(user_id)
) ENGINE=InnoDB;
DROP TRIGGER IF EXISTS trg_claim_notes_no_update;
CREATE TRIGGER trg_claim_notes_no_update BEFORE UPDATE ON tbl_donation_claim_notes FOR EACH ROW
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Donation report messages cannot be edited.';
DROP TRIGGER IF EXISTS trg_claim_notes_no_delete;
CREATE TRIGGER trg_claim_notes_no_delete BEFORE DELETE ON tbl_donation_claim_notes FOR EACH ROW
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Donation report messages cannot be deleted.';

-- ------------------------------------------------------------------ C. approvals
CREATE TABLE IF NOT EXISTS tbl_donation_approvals (
    approval_id   INT AUTO_INCREMENT PRIMARY KEY,
    donation_id   INT NOT NULL,
    kind          ENUM('amount_difference', 'second_verifier', 'cash_dual_control') NOT NULL,
    verified_amount DECIMAL(12,2) NULL,
    verified_reference VARCHAR(100) NULL,
    verified_received_on DATE NULL,
    reason        VARCHAR(500) NULL,
    requested_by  INT NOT NULL,
    requested_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    status        ENUM('Pending', 'Approved', 'Declined') NOT NULL DEFAULT 'Pending',
    decided_by    INT NULL,
    decided_at    DATETIME NULL,
    decision_note VARCHAR(500) NULL,
    INDEX idx_approvals (donation_id, status),
    CONSTRAINT fk_appr_donation FOREIGN KEY (donation_id) REFERENCES tbl_donations(donation_id),
    CONSTRAINT fk_appr_requester FOREIGN KEY (requested_by) REFERENCES tbl_users(user_id),
    CONSTRAINT fk_appr_decider FOREIGN KEY (decided_by) REFERENCES tbl_users(user_id)
) ENGINE=InnoDB;

-- ------------------------------------------------------------------ D. reconciliation
CREATE TABLE IF NOT EXISTS tbl_reconciliation_imports (
    import_id     INT AUTO_INCREMENT PRIMARY KEY,
    period        CHAR(7) NOT NULL COMMENT 'YYYY-MM',
    method_id     INT NOT NULL,
    source        ENUM('csv', 'manual') NOT NULL,
    file_name     VARCHAR(200) NULL,
    file_sha256   CHAR(64) NULL,
    line_count    INT NOT NULL DEFAULT 0,
    imported_by   INT NOT NULL,
    imported_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    note          VARCHAR(500) NULL,
    INDEX idx_recon_period (period, method_id),
    CONSTRAINT fk_recon_method FOREIGN KEY (method_id) REFERENCES tbl_payment_methods(method_id),
    CONSTRAINT fk_recon_user FOREIGN KEY (imported_by) REFERENCES tbl_users(user_id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS tbl_reconciliation_lines (
    line_id        INT AUTO_INCREMENT PRIMARY KEY,
    import_id      INT NOT NULL,
    line_no        INT NOT NULL,
    txn_date       DATE NOT NULL,
    reference_raw  VARCHAR(100) NOT NULL,
    reference_norm VARCHAR(64) NOT NULL,
    amount         DECIMAL(12,2) NOT NULL,
    match_status   ENUM('Matched', 'Amount differs', 'Unreported', 'Duplicate line', 'Converted', 'Dismissed') NOT NULL,
    donation_id    INT NULL,
    reviewed_by    INT NULL,
    reviewed_at    DATETIME NULL,
    review_note    VARCHAR(500) NULL,
    INDEX idx_recon_lines (import_id, match_status),
    INDEX idx_recon_ref (reference_norm),
    CONSTRAINT fk_rline_import FOREIGN KEY (import_id) REFERENCES tbl_reconciliation_imports(import_id),
    CONSTRAINT fk_rline_donation FOREIGN KEY (donation_id) REFERENCES tbl_donations(donation_id),
    CONSTRAINT fk_rline_user FOREIGN KEY (reviewed_by) REFERENCES tbl_users(user_id)
) ENGINE=InnoDB;

-- ------------------------------------------------------------------ E. acknowledgment numbers and the daily cash count
ALTER TABLE tbl_donation_acknowledgments
  ADD COLUMN IF NOT EXISTS ack_no VARCHAR(20) NULL COMMENT 'sequential ACK-YYYY-NNNN (not a secret; the receipt code is the random part)';
ALTER TABLE tbl_donation_acknowledgments ADD UNIQUE INDEX IF NOT EXISTS uq_ack_no (ack_no);

CREATE TABLE IF NOT EXISTS tbl_cash_counts (
    count_id       INT AUTO_INCREMENT PRIMARY KEY,
    count_date     DATE NOT NULL UNIQUE,
    expected_cash  DECIMAL(12,2) NOT NULL COMMENT 'cash donations received that day (system)',
    counted_cash   DECIMAL(12,2) NOT NULL,
    note           VARCHAR(500) NULL,
    counted_by     INT NOT NULL,
    counted_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    signed_off_by  INT NULL,
    signed_off_at  DATETIME NULL,
    CONSTRAINT fk_cash_counter FOREIGN KEY (counted_by) REFERENCES tbl_users(user_id),
    CONSTRAINT fk_cash_signer FOREIGN KEY (signed_off_by) REFERENCES tbl_users(user_id)
) ENGINE=InnoDB;

-- ------------------------------------------------------------------ F. security
CREATE TABLE IF NOT EXISTS tbl_reauth_grants (
    grant_hash   CHAR(64) PRIMARY KEY COMMENT 'SHA-256 of the one-time grant; the grant itself is never stored',
    user_id      INT NOT NULL,
    session_jti  VARCHAR(64) NOT NULL,
    purpose      VARCHAR(40) NOT NULL,
    expires_at   DATETIME NOT NULL,
    used_at      DATETIME NULL,
    created_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_reauth_user (user_id, created_at),
    CONSTRAINT fk_reauth_user FOREIGN KEY (user_id) REFERENCES tbl_users(user_id)
) ENGINE=InnoDB;

ALTER TABLE tbl_users
  ADD COLUMN IF NOT EXISTS must_change_password    BOOLEAN NOT NULL DEFAULT FALSE COMMENT 'set when an Admin sets a temporary password',
  ADD COLUMN IF NOT EXISTS temp_password_expires_at DATETIME NULL;

-- ------------------------------------------------------------------ G. legacy gateway data: read-only, never dropped
CREATE TABLE IF NOT EXISTS tbl_legacy_payment_map (
    payment_id   INT PRIMARY KEY,
    old_status   VARCHAR(30) NOT NULL,
    mapped_as    VARCHAR(40) NOT NULL,
    donation_id  INT NULL,
    counted      BOOLEAN NOT NULL,
    note         VARCHAR(255) NULL,
    mapped_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

DROP TRIGGER IF EXISTS trg_payments_read_only_update;
CREATE TRIGGER trg_payments_read_only_update BEFORE UPDATE ON tbl_payments FOR EACH ROW
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Legacy payment records are read-only.';
DROP TRIGGER IF EXISTS trg_payments_read_only_delete;
CREATE TRIGGER trg_payments_read_only_delete BEFORE DELETE ON tbl_payments FOR EACH ROW
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Legacy payment records are read-only.';
DROP TRIGGER IF EXISTS trg_payments_read_only_insert;
CREATE TRIGGER trg_payments_read_only_insert BEFORE INSERT ON tbl_payments FOR EACH ROW
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Online payments were retired. Legacy payment records are read-only.';
DROP TRIGGER IF EXISTS trg_webhook_events_read_only_update;
CREATE TRIGGER trg_webhook_events_read_only_update BEFORE UPDATE ON tbl_payment_webhook_events FOR EACH ROW
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Legacy payment records are read-only.';
DROP TRIGGER IF EXISTS trg_webhook_events_read_only_delete;
CREATE TRIGGER trg_webhook_events_read_only_delete BEFORE DELETE ON tbl_payment_webhook_events FOR EACH ROW
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Legacy payment records are read-only.';
DROP TRIGGER IF EXISTS trg_webhook_events_read_only_insert;
CREATE TRIGGER trg_webhook_events_read_only_insert BEFORE INSERT ON tbl_payment_webhook_events FOR EACH ROW
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Online payments were retired. Legacy payment records are read-only.';

-- The gateway-only setting is kept (read-only history); the PayMongo instructions on the methods are cleared so no
-- donor ever sees "You will be sent to a secure PayMongo page". The method rows themselves are kept.
UPDATE tbl_payment_methods SET legacy_method_type = method_type WHERE legacy_method_type IS NULL AND method_type IN ('gateway', 'manual');
UPDATE tbl_payment_methods SET legacy_instructions = instructions, instructions = NULL WHERE instructions LIKE '%PayMongo%';
UPDATE tbl_payment_methods SET method_type = 'qr' WHERE method_type IN ('gateway', 'manual');
UPDATE tbl_payment_methods SET created_at = COALESCE(created_at, updated_at, NOW());

-- ------------------------------------------------------------------ H. settings (defaults; Admin edits them in Settings)
INSERT IGNORE INTO tbl_settings (setting_key, setting_value) VALUES
  ('donation_claim_max_amount', '100000'),
  ('donation_claim_max_age_days', '60'),
  ('donation_claim_max_pending', '3'),
  ('donation_claim_daily_limit', '5'),
  ('donation_claim_ip_hourly_limit', '20'),
  ('donation_claim_burst_alert', '10'),
  ('donation_claim_captcha', '0'),
  ('donation_duplicate_window_minutes', '10'),
  ('donation_stale_days', '14'),
  ('donation_sod_enabled', '1'),
  ('donation_sod_threshold', '10000'),
  ('cash_dual_control_threshold', '5000'),
  ('payment_qr_second_admin', '1');
