-- Rollback for 031. First move database/031_donations_lifecycle.sql out of the database folder and put back the
-- previous backend and frontend files.
-- Kept: every donation row, its amount, method, receipt code, donor name, original allocation text and items.
-- Lost (export first if needed): donation numbers, donor records, item lines, lots, allocation lines, the status
-- timeline, acknowledgments, distributions, void requests, corrections and uploaded-document records (the files
-- stay on disk under backend/uploads/donations).
-- Statuses: rows converted by scripts/migrateDonations.js get their old status back from legacy_status, and their
-- original allocation text back from legacy_allocation. Rows voided or moved through the new lifecycle after the
-- conversion have no old status: they are set to 'Received' (or 'Cancelled' when voided). Review them first:
--   SELECT donation_id, donation_no, status, legacy_status, void_reason FROM tbl_donations WHERE status NOT IN ('Pending','Received','Cancelled','Pending verification','Rejected');
USE caresphere_db;

UPDATE tbl_donations SET allocation_notes = legacy_allocation WHERE legacy_allocation IS NOT NULL AND (allocation_notes IS NULL OR allocation_notes = '');
UPDATE tbl_donations SET status = legacy_status WHERE legacy_status IN ('Pending', 'Received', 'Cancelled', 'Pending verification', 'Rejected');
UPDATE tbl_donations SET status = 'Cancelled' WHERE status = 'Voided';
UPDATE tbl_donations SET status = 'Received' WHERE status NOT IN ('Pending', 'Received', 'Cancelled', 'Pending verification', 'Rejected');
ALTER TABLE tbl_donations MODIFY COLUMN status ENUM('Pending', 'Received', 'Cancelled', 'Pending verification', 'Rejected') NOT NULL DEFAULT 'Received';

DROP TABLE IF EXISTS tbl_donation_documents;
DROP TABLE IF EXISTS tbl_donation_corrections;
DROP TABLE IF EXISTS tbl_donation_void_requests;
DROP TABLE IF EXISTS tbl_donation_distributions;
DROP TABLE IF EXISTS tbl_donation_acknowledgments;
DROP TABLE IF EXISTS tbl_donation_status_history;
DROP TABLE IF EXISTS tbl_donation_allocations;
ALTER TABLE tbl_inventory_movements DROP FOREIGN KEY IF EXISTS fk_movement_lot;
ALTER TABLE tbl_inventory_movements DROP COLUMN IF EXISTS lot_id, DROP COLUMN IF EXISTS note;
-- Movements of the new kinds are kept as manual edits (the stock history stays complete).
UPDATE tbl_inventory_movements SET movement_type = 'manual_edit' WHERE movement_type IN ('distribution_out', 'void_reversal', 'correction');
ALTER TABLE tbl_inventory_movements MODIFY COLUMN movement_type ENUM('donation_in', 'donation_reversal', 'manual_edit') NOT NULL;
DROP TABLE IF EXISTS tbl_inventory_lots;
DROP TABLE IF EXISTS tbl_donation_item_lines;
DROP TABLE IF EXISTS tbl_number_sequences;

ALTER TABLE tbl_donations DROP FOREIGN KEY IF EXISTS fk_donation_donor_ref;
ALTER TABLE tbl_donations DROP FOREIGN KEY IF EXISTS fk_donation_voided_by;
ALTER TABLE tbl_donations DROP INDEX IF EXISTS uq_donation_no;
DROP INDEX IF EXISTS idx_donations_activity ON tbl_donations;
DROP INDEX IF EXISTS idx_donations_donor_ref ON tbl_donations;
ALTER TABLE tbl_donations
  DROP COLUMN IF EXISTS lifecycle_converted_at, DROP COLUMN IF EXISTS voided_at, DROP COLUMN IF EXISTS voided_by,
  DROP COLUMN IF EXISTS void_note, DROP COLUMN IF EXISTS void_reason, DROP COLUMN IF EXISTS last_activity_at,
  DROP COLUMN IF EXISTS purpose, DROP COLUMN IF EXISTS is_anonymous, DROP COLUMN IF EXISTS donor_ref_id,
  DROP COLUMN IF EXISTS legacy_allocation, DROP COLUMN IF EXISTS legacy_status, DROP COLUMN IF EXISTS donation_no;
DROP TABLE IF EXISTS tbl_donors;
DELETE FROM tbl_staff_duties WHERE duty = 'donor_directory';
