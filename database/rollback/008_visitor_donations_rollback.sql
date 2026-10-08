-- Rollback for 008_visitor_donations.sql (back to the schema before migration 008)
-- IMPORTANT: first move database/008_visitor_donations.sql out of the database folder,
-- otherwise the next `npm run migrate` adds everything back.
-- Run in phpMyAdmin (SQL tab) or: mysql -u root caresphere_db < this-file.sql
--
-- Kept: every donation (amount, donor name, method, status, receipt code) and every visit.
-- Removed: donor type and walk-in columns, source, visit links, receipt-issued flag,
-- in-kind item lists, stock movement history and the needs-review flag.
-- Not changed: current stock quantities in tbl_inventory.
USE caresphere_db;

ALTER TABLE tbl_visitors DROP COLUMN IF EXISTS needs_review;

DROP TABLE IF EXISTS tbl_inventory_movements;
DROP TABLE IF EXISTS tbl_donation_items;

ALTER TABLE tbl_donations DROP FOREIGN KEY IF EXISTS fk_donation_visit;
ALTER TABLE tbl_donations DROP INDEX IF EXISTS uq_donation_visit;
ALTER TABLE tbl_donations DROP INDEX IF EXISTS idx_donations_type_source;
ALTER TABLE tbl_donations DROP INDEX IF EXISTS idx_donations_walk_in;
ALTER TABLE tbl_donations DROP COLUMN IF EXISTS visit_id;
ALTER TABLE tbl_donations DROP COLUMN IF EXISTS source;
ALTER TABLE tbl_donations DROP COLUMN IF EXISTS receipt_issued;
ALTER TABLE tbl_donations DROP COLUMN IF EXISTS walk_in_contact;
ALTER TABLE tbl_donations DROP COLUMN IF EXISTS walk_in_name;
ALTER TABLE tbl_donations DROP COLUMN IF EXISTS donor_type;

-- donor_id goes back to required only if no walk-in donation (without an account) remains.
SET @nulls := (SELECT COUNT(*) FROM tbl_donations WHERE donor_id IS NULL);
SET @sql := IF(@nulls = 0, 'ALTER TABLE tbl_donations MODIFY COLUMN donor_id INT NOT NULL', 'DO 0');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
SELECT IF(@nulls = 0, 'Rollback complete. donor_id is required again.',
  CONCAT('Rollback complete. ', @nulls, ' walk-in donation(s) have no donor account, so donor_id stays optional.')) AS rollback_note;
