-- Rollback of migration 037 (QR-only donations). Run only to go back to the code before migration 037.
-- Before running it: move database/037_qr_donations.sql out of the database folder (the migration runner re-runs every
-- file) and put back the previous backend and frontend files.
--
-- WARNING: this removes the QR-donation data added since migration 037 (donor reports, verifications, QR versions,
-- reconciliation imports, cash counts). Export them first (Donations > Export, Audit log) if they must be kept.
-- Donations themselves are NOT deleted: donations created as donor reports keep their row; only the new columns go.
-- Legacy payment rows (tbl_payments) are untouched and become editable again (the read-only triggers are removed).
USE caresphere_db;

DROP TRIGGER IF EXISTS trg_payments_read_only_update;
DROP TRIGGER IF EXISTS trg_payments_read_only_delete;
DROP TRIGGER IF EXISTS trg_payments_read_only_insert;
DROP TRIGGER IF EXISTS trg_webhook_events_read_only_update;
DROP TRIGGER IF EXISTS trg_webhook_events_read_only_delete;
DROP TRIGGER IF EXISTS trg_webhook_events_read_only_insert;
DROP TRIGGER IF EXISTS trg_qr_versions_no_update;
DROP TRIGGER IF EXISTS trg_qr_versions_no_delete;

DROP TRIGGER IF EXISTS trg_claim_notes_no_update;
DROP TRIGGER IF EXISTS trg_claim_notes_no_delete;
DROP TABLE IF EXISTS tbl_donation_claim_notes;
DROP TABLE IF EXISTS tbl_reconciliation_lines;
DROP TABLE IF EXISTS tbl_reconciliation_imports;
DROP TABLE IF EXISTS tbl_donation_approvals;
DROP TABLE IF EXISTS tbl_qr_problem_reports;
DROP TABLE IF EXISTS tbl_payment_qr_changes;
DROP TABLE IF EXISTS tbl_payment_qr_versions;
DROP TABLE IF EXISTS tbl_cash_counts;
DROP TABLE IF EXISTS tbl_reauth_grants;
DROP TABLE IF EXISTS tbl_legacy_payment_map;

ALTER TABLE tbl_donations DROP FOREIGN KEY IF EXISTS fk_donation_method;
ALTER TABLE tbl_donations DROP FOREIGN KEY IF EXISTS fk_donation_verifier;
ALTER TABLE tbl_donations DROP FOREIGN KEY IF EXISTS fk_donation_recorder;
ALTER TABLE tbl_donations DROP INDEX IF EXISTS uq_donation_ref_key;
DROP INDEX IF EXISTS idx_donations_claim ON tbl_donations;
ALTER TABLE tbl_donations
  DROP COLUMN IF EXISTS ref_key,
  DROP COLUMN IF EXISTS payment_method_id,
  DROP COLUMN IF EXISTS qr_version_id,
  DROP COLUMN IF EXISTS reported_amount,
  DROP COLUMN IF EXISTS verified_amount,
  DROP COLUMN IF EXISTS ref_method,
  DROP COLUMN IF EXISTS reference_raw,
  DROP COLUMN IF EXISTS reference_norm,
  DROP COLUMN IF EXISTS sent_at,
  DROP COLUMN IF EXISTS sender_hint,
  DROP COLUMN IF EXISTS donor_note,
  DROP COLUMN IF EXISTS claim_status,
  DROP COLUMN IF EXISTS claim_reported_at,
  DROP COLUMN IF EXISTS claim_message,
  DROP COLUMN IF EXISTS stale_flagged_at,
  DROP COLUMN IF EXISTS verified_reference,
  DROP COLUMN IF EXISTS verified_received_on,
  DROP COLUMN IF EXISTS verified_by,
  DROP COLUMN IF EXISTS verified_at,
  DROP COLUMN IF EXISTS amount_diff_reason,
  DROP COLUMN IF EXISTS consent_at,
  DROP COLUMN IF EXISTS consent_version,
  DROP COLUMN IF EXISTS legacy_payment_id,
  DROP COLUMN IF EXISTS recorded_by,
  DROP COLUMN IF EXISTS dual_control;
-- amount stays DECIMAL(12,2) (narrowing could truncate values entered since).

UPDATE tbl_donation_documents SET kind = 'proof_of_transfer' WHERE kind = 'donor_proof';
ALTER TABLE tbl_donation_documents MODIFY COLUMN kind ENUM('delivery_receipt', 'proof_of_transfer', 'photo', 'other') NOT NULL;
ALTER TABLE tbl_donation_documents DROP COLUMN IF EXISTS duplicate_of;

ALTER TABLE tbl_donation_acknowledgments DROP INDEX IF EXISTS uq_ack_no;
ALTER TABLE tbl_donation_acknowledgments DROP COLUMN IF EXISTS ack_no;

ALTER TABLE tbl_users DROP COLUMN IF EXISTS must_change_password, DROP COLUMN IF EXISTS temp_password_expires_at;

-- Payment methods: restore the earlier type and instructions.
UPDATE tbl_payment_methods SET method_type = 'manual' WHERE method_type = 'qr';
ALTER TABLE tbl_payment_methods MODIFY COLUMN method_type ENUM('gateway', 'manual') NOT NULL;
UPDATE tbl_payment_methods SET method_type = legacy_method_type WHERE legacy_method_type IN ('gateway', 'manual');
UPDATE tbl_payment_methods SET instructions = legacy_instructions WHERE legacy_instructions IS NOT NULL;
ALTER TABLE tbl_payment_methods
  DROP COLUMN IF EXISTS current_version_id,
  DROP COLUMN IF EXISTS qr_updated_at,
  DROP COLUMN IF EXISTS last_confirmed_by,
  DROP COLUMN IF EXISTS last_confirmed_at,
  DROP COLUMN IF EXISTS created_at,
  DROP COLUMN IF EXISTS legacy_method_type,
  DROP COLUMN IF EXISTS legacy_instructions;

DELETE FROM tbl_settings WHERE setting_key IN ('donation_claim_max_amount', 'donation_claim_max_age_days', 'donation_claim_max_pending',
  'donation_claim_daily_limit', 'donation_claim_ip_hourly_limit', 'donation_claim_burst_alert', 'donation_claim_captcha',
  'donation_duplicate_window_minutes', 'donation_stale_days', 'donation_sod_enabled', 'donation_sod_threshold',
  'cash_dual_control_threshold', 'payment_qr_second_admin');
