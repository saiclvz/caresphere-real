-- Migration 008 - Donations: one record, one form (single source of truth)
--
-- tbl_donations
--   donor_type      'registered' (has a donor account) or 'walk_in' (no account)
--   walk_in_name    walk-in donor's full name (required for walk-ins, set by the app)
--   walk_in_contact walk-in donor's contact number (optional)
--   source          'portal' (donor's own Donate page), 'visitors_page' (recorded from a visit),
--                   'donations_page' (Record donation on the Donations page)
--   visit_id        the visit this donation came from. UNIQUE: one visit has at most one donation.
--                   A visit's type (Donated / Just visited) is derived from this link.
--   receipt_issued  TRUE once a receipt has been downloaded/printed or marked as given
--   donor_id        optional now (walk-ins have no account). donor_name keeps the display name.
-- tbl_donation_items       in-kind items per donation
-- tbl_inventory_movements  stock history ('donation_in' adds, 'donation_reversal' undoes)
-- tbl_visitors.needs_review visits that were marked "Donated" but whose donation can't be matched
--
-- Safe to run more than once (npm run migrate re-runs every file). It also upgrades the two
-- earlier shapes of this migration (visitor_id / visitor_log_id / visitors.donation_id /
-- visit_type and the old source values) without losing links.
-- Rollback: database/rollback/008_visitor_donations_rollback.sql
USE caresphere_db;

CREATE INDEX IF NOT EXISTS idx_visitors_check_in ON tbl_visitors (check_in_time);
ALTER TABLE tbl_visitors ADD COLUMN IF NOT EXISTS needs_review BOOLEAN NOT NULL DEFAULT FALSE AFTER purpose;

-- ---------------------------------------------------------------- donor type and walk-in details
ALTER TABLE tbl_donations MODIFY COLUMN donor_id INT NULL;
ALTER TABLE tbl_donations
  ADD COLUMN IF NOT EXISTS donor_type ENUM('registered', 'walk_in') NOT NULL DEFAULT 'registered' AFTER donor_id,
  ADD COLUMN IF NOT EXISTS walk_in_name VARCHAR(100) NULL AFTER donor_type,
  ADD COLUMN IF NOT EXISTS walk_in_contact VARCHAR(30) NULL AFTER walk_in_name,
  ADD COLUMN IF NOT EXISTS receipt_issued BOOLEAN NOT NULL DEFAULT FALSE AFTER qr_receipt_code,
  ADD COLUMN IF NOT EXISTS visit_id INT NULL AFTER walk_in_contact;

-- Donations without an account are walk-ins (earlier walk-in rows stored the name in donor_name).
UPDATE tbl_donations SET donor_type = 'walk_in', walk_in_name = COALESCE(walk_in_name, donor_name)
 WHERE donor_id IS NULL AND donor_type = 'registered';

-- ---------------------------------------------------------------- source (new values)
-- Widen to text, map old values, then lock to the new list.
ALTER TABLE tbl_donations ADD COLUMN IF NOT EXISTS source VARCHAR(20) NOT NULL DEFAULT 'donations_page' AFTER donor_name;
ALTER TABLE tbl_donations MODIFY COLUMN source VARCHAR(20) NOT NULL DEFAULT 'donations_page';
UPDATE tbl_donations SET source = 'portal' WHERE source = 'online' OR submitted_by_donor = TRUE;
UPDATE tbl_donations SET source = 'visitors_page' WHERE source = 'visitor';
UPDATE tbl_donations SET source = 'donations_page' WHERE source NOT IN ('portal', 'visitors_page', 'donations_page') OR source = 'staff';

-- ---------------------------------------------------------------- visit link: move old links to visit_id
-- From the draft (donations.visitor_id)
SET @has := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'tbl_donations' AND COLUMN_NAME = 'visitor_id');
SET @sql := IF(@has > 0, 'UPDATE tbl_donations SET visit_id = visitor_id WHERE visit_id IS NULL AND visitor_id IS NOT NULL', 'DO 0');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
-- From the previous version (donations.visitor_log_id)
SET @has := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'tbl_donations' AND COLUMN_NAME = 'visitor_log_id');
SET @sql := IF(@has > 0, 'UPDATE tbl_donations SET visit_id = visitor_log_id WHERE visit_id IS NULL AND visitor_log_id IS NOT NULL', 'DO 0');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
-- From the reverse link (visitors.donation_id)
SET @has := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'tbl_visitors' AND COLUMN_NAME = 'donation_id');
SET @sql := IF(@has > 0, 'UPDATE tbl_donations d JOIN tbl_visitors v ON v.donation_id = d.donation_id SET d.visit_id = v.visitor_id WHERE d.visit_id IS NULL', 'DO 0');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- Walk-ins that came from a visit were recorded on the Visitors page.
UPDATE tbl_donations SET source = 'visitors_page' WHERE visit_id IS NOT NULL AND source = 'donations_page' AND donor_type = 'walk_in';

ALTER TABLE tbl_donations MODIFY COLUMN source ENUM('portal', 'visitors_page', 'donations_page') NOT NULL DEFAULT 'donations_page';

-- Flag visits that were marked "Donated" but have no matching donation. Nothing is deleted.
SET @has := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'tbl_visitors' AND COLUMN_NAME = 'donation_id');
SET @sql := IF(@has > 0, 'UPDATE tbl_visitors v SET v.needs_review = TRUE WHERE v.donation_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM tbl_donations d WHERE d.visit_id = v.visitor_id)', 'DO 0');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
SET @has := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'tbl_visitors' AND COLUMN_NAME = 'visit_type');
SET @sql := IF(@has > 0, 'UPDATE tbl_visitors v SET v.needs_review = TRUE WHERE v.visit_type = ''Donation'' AND NOT EXISTS (SELECT 1 FROM tbl_donations d WHERE d.visit_id = v.visitor_id)', 'DO 0');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- Drop the old link columns now that visit_id holds the links.
ALTER TABLE tbl_donations DROP FOREIGN KEY IF EXISTS fk_donation_visitor;
ALTER TABLE tbl_donations DROP FOREIGN KEY IF EXISTS fk_donation_visitor_log;
ALTER TABLE tbl_donations DROP INDEX IF EXISTS idx_donations_visitor;
ALTER TABLE tbl_donations DROP INDEX IF EXISTS uq_donation_visitor_log;
ALTER TABLE tbl_donations DROP COLUMN IF EXISTS visitor_id;
ALTER TABLE tbl_donations DROP COLUMN IF EXISTS visitor_log_id;
ALTER TABLE tbl_visitors DROP FOREIGN KEY IF EXISTS fk_visitor_donation;
ALTER TABLE tbl_visitors DROP INDEX IF EXISTS uq_visitor_donation;
ALTER TABLE tbl_visitors DROP COLUMN IF EXISTS donation_id;
ALTER TABLE tbl_visitors DROP INDEX IF EXISTS idx_visitors_type_time;
ALTER TABLE tbl_visitors DROP COLUMN IF EXISTS visit_type;

ALTER TABLE tbl_donations ADD UNIQUE INDEX IF NOT EXISTS uq_donation_visit (visit_id);
ALTER TABLE tbl_donations
  ADD CONSTRAINT fk_donation_visit FOREIGN KEY IF NOT EXISTS (visit_id)
  REFERENCES tbl_visitors(visitor_id) ON DELETE SET NULL;
DROP INDEX IF EXISTS idx_donations_source ON tbl_donations;
CREATE INDEX IF NOT EXISTS idx_donations_type_source ON tbl_donations (donor_type, source, created_at);
CREATE INDEX IF NOT EXISTS idx_donations_walk_in ON tbl_donations (walk_in_name, created_at);

-- ---------------------------------------------------------------- in-kind items
CREATE TABLE IF NOT EXISTS tbl_donation_items (
    donation_id       INT NOT NULL,
    inventory_item_id INT NOT NULL,
    quantity          INT NOT NULL,
    PRIMARY KEY (donation_id, inventory_item_id),
    INDEX idx_donation_items_item (inventory_item_id),
    CONSTRAINT fk_donation_items_donation FOREIGN KEY (donation_id) REFERENCES tbl_donations(donation_id) ON DELETE CASCADE,
    CONSTRAINT fk_donation_items_item FOREIGN KEY (inventory_item_id) REFERENCES tbl_inventory(item_id) ON DELETE RESTRICT
) ENGINE=InnoDB;

-- ---------------------------------------------------------------- inventory stock movements
CREATE TABLE IF NOT EXISTS tbl_inventory_movements (
    movement_id    INT AUTO_INCREMENT PRIMARY KEY,
    item_id        INT NOT NULL,
    movement_type  ENUM('donation_in', 'donation_reversal') NOT NULL,
    change_qty     INT NOT NULL,
    quantity_after INT NOT NULL,
    donation_id    INT NULL,
    created_by     INT NULL,
    created_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_movements_item (item_id, created_at),
    INDEX idx_movements_donation (donation_id),
    CONSTRAINT fk_movement_item FOREIGN KEY (item_id) REFERENCES tbl_inventory(item_id) ON DELETE RESTRICT,
    CONSTRAINT fk_movement_donation FOREIGN KEY (donation_id) REFERENCES tbl_donations(donation_id) ON DELETE SET NULL,
    CONSTRAINT fk_movement_user FOREIGN KEY (created_by) REFERENCES tbl_users(user_id)
) ENGINE=InnoDB;

-- Upgrade from the draft: movement type name, no visitor_id, donation_id ON DELETE SET NULL.
ALTER TABLE tbl_inventory_movements MODIFY COLUMN movement_type VARCHAR(30) NOT NULL;
UPDATE tbl_inventory_movements SET movement_type = 'donation_in' WHERE movement_type = 'Donation in';
-- 'manual_edit' (an item's quantity changed on the Inventory page) was added by 012; listed here so re-runs keep it.
-- (October 2026) the list includes every value added by later migrations, so running all migrations again never narrows it.
ALTER TABLE tbl_inventory_movements MODIFY COLUMN movement_type ENUM('donation_in', 'donation_reversal', 'manual_edit', 'distribution_out', 'void_reversal', 'correction', 'stock_in', 'stock_out', 'adjustment', 'disposal') NOT NULL;

SET @fk := (SELECT CONSTRAINT_NAME FROM information_schema.KEY_COLUMN_USAGE
             WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'tbl_inventory_movements'
               AND COLUMN_NAME = 'visitor_id' AND REFERENCED_TABLE_NAME IS NOT NULL LIMIT 1);
SET @sql := IF(@fk IS NULL, 'DO 0', CONCAT('ALTER TABLE tbl_inventory_movements DROP FOREIGN KEY `', @fk, '`'));
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
ALTER TABLE tbl_inventory_movements DROP INDEX IF EXISTS idx_movements_visitor;
ALTER TABLE tbl_inventory_movements DROP COLUMN IF EXISTS visitor_id;

SET @fk := (SELECT CONSTRAINT_NAME FROM information_schema.KEY_COLUMN_USAGE
             WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'tbl_inventory_movements'
               AND COLUMN_NAME = 'donation_id' AND REFERENCED_TABLE_NAME IS NOT NULL
               AND CONSTRAINT_NAME <> 'fk_movement_donation' LIMIT 1);
SET @sql := IF(@fk IS NULL, 'DO 0', CONCAT('ALTER TABLE tbl_inventory_movements DROP FOREIGN KEY `', @fk, '`'));
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
ALTER TABLE tbl_inventory_movements
  ADD CONSTRAINT fk_movement_donation FOREIGN KEY IF NOT EXISTS (donation_id)
  REFERENCES tbl_donations(donation_id) ON DELETE SET NULL;

INSERT IGNORE INTO tbl_donation_items (donation_id, inventory_item_id, quantity)
SELECT donation_id, item_id, SUM(change_qty) FROM tbl_inventory_movements
 WHERE movement_type = 'donation_in' AND donation_id IS NOT NULL
 GROUP BY donation_id, item_id;
