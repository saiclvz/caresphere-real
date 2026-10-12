-- Migration 031 - Donations: lifecycle, donor records, item lines, lots, allocation lines, void, acknowledgments
--
-- Schema only, plus donation numbers. It changes no existing value: the status column only gains the new
-- lifecycle values (existing values stay), and every new column starts empty. Converting existing donations
-- (status, allocation lines, purpose, donor records, item lines) is a separate, reviewable step:
--     node scripts/migrateDonations.js            (dry run: prints what it would do, changes nothing)
--     node scripts/migrateDonations.js --apply    (applies it in one transaction)
-- Donation numbers (DNT-YYYY-NNNN) are backfilled here in date order, per year, with no gaps or duplicates.
-- Nothing is deleted. Safe to run more than once.
-- Rollback: database/rollback/031_donations_lifecycle_rollback.sql
USE caresphere_db;

-- ---------------------------------------------------------------- donor records (DNR-NNNN)
CREATE TABLE IF NOT EXISTS tbl_donors (
    donor_ref_id  INT AUTO_INCREMENT PRIMARY KEY,
    donor_code    VARCHAR(20) NOT NULL UNIQUE,
    donor_type    ENUM('Individual', 'Organization') NOT NULL DEFAULT 'Individual',
    display_name  VARCHAR(150) NOT NULL,
    name_key      VARCHAR(150) NOT NULL COMMENT 'lower-case name without extra spaces, for the duplicate check',
    user_id       INT NULL UNIQUE COMMENT 'the donor account, when there is one',
    contact_enc   TEXT NULL COMMENT 'AES-256-GCM ciphertext (walk-in contact number)',
    origin        ENUM('account', 'walk_in', 'staff') NOT NULL,
    created_by    INT NULL,
    created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_donors_name_key (name_key),
    CONSTRAINT fk_donors_user FOREIGN KEY (user_id) REFERENCES tbl_users(user_id),
    CONSTRAINT fk_donors_creator FOREIGN KEY (created_by) REFERENCES tbl_users(user_id)
) ENGINE=InnoDB;

-- ---------------------------------------------------------------- donations: new columns
ALTER TABLE tbl_donations
  MODIFY COLUMN status ENUM('Pending', 'Pending verification', 'Received', 'Under inspection', 'Accepted', 'Acknowledged', 'Allocated',
                            'Partially distributed', 'Fully distributed', 'Closed', 'Rejected', 'Voided', 'Cancelled') NOT NULL DEFAULT 'Received';
ALTER TABLE tbl_donations
  ADD COLUMN IF NOT EXISTS donation_no        VARCHAR(20) NULL,
  ADD COLUMN IF NOT EXISTS legacy_status      VARCHAR(30) NULL COMMENT 'the status before the lifecycle conversion (kept, not shown)',
  ADD COLUMN IF NOT EXISTS legacy_allocation  TEXT NULL COMMENT 'the original free-text allocation (kept)',
  ADD COLUMN IF NOT EXISTS donor_ref_id       INT NULL,
  ADD COLUMN IF NOT EXISTS is_anonymous       BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS purpose            VARCHAR(40) NULL,
  ADD COLUMN IF NOT EXISTS last_activity_at   DATETIME NULL,
  ADD COLUMN IF NOT EXISTS void_reason        VARCHAR(40) NULL,
  ADD COLUMN IF NOT EXISTS void_note          VARCHAR(500) NULL,
  ADD COLUMN IF NOT EXISTS voided_by          INT NULL,
  ADD COLUMN IF NOT EXISTS voided_at          DATETIME NULL,
  ADD COLUMN IF NOT EXISTS lifecycle_converted_at DATETIME NULL COMMENT 'set by scripts/migrateDonations.js';
ALTER TABLE tbl_donations ADD UNIQUE INDEX IF NOT EXISTS uq_donation_no (donation_no);
CREATE INDEX IF NOT EXISTS idx_donations_activity ON tbl_donations (last_activity_at);
CREATE INDEX IF NOT EXISTS idx_donations_donor_ref ON tbl_donations (donor_ref_id);
ALTER TABLE tbl_donations
  ADD CONSTRAINT fk_donation_donor_ref FOREIGN KEY IF NOT EXISTS (donor_ref_id) REFERENCES tbl_donors(donor_ref_id),
  ADD CONSTRAINT fk_donation_voided_by FOREIGN KEY IF NOT EXISTS (voided_by) REFERENCES tbl_users(user_id);
UPDATE tbl_donations SET last_activity_at = COALESCE(received_at, created_at) WHERE last_activity_at IS NULL;

-- ---------------------------------------------------------------- numbers: DNT-YYYY-NNNN and DNR-NNNN
CREATE TABLE IF NOT EXISTS tbl_number_sequences (
    seq_key    VARCHAR(20) PRIMARY KEY,
    next_value INT NOT NULL
) ENGINE=InnoDB;

-- Backfill in date order (then id), per year, continuing after any number already given that year.
-- Worked out in a temporary table first, so the update never reads the table it changes.
DROP TEMPORARY TABLE IF EXISTS tmp_dnt_max;
CREATE TEMPORARY TABLE tmp_dnt_max AS
  SELECT YEAR(created_at) AS y, MAX(CAST(SUBSTRING(donation_no, 10) AS UNSIGNED)) AS mx
    FROM tbl_donations WHERE donation_no IS NOT NULL GROUP BY YEAR(created_at);
DROP TEMPORARY TABLE IF EXISTS tmp_dnt_new;
CREATE TEMPORARY TABLE tmp_dnt_new AS
  SELECT donation_id, YEAR(created_at) AS y,
         ROW_NUMBER() OVER (PARTITION BY YEAR(created_at) ORDER BY created_at, donation_id) AS rn
    FROM tbl_donations WHERE donation_no IS NULL;
UPDATE tbl_donations d
  JOIN tmp_dnt_new n ON n.donation_id = d.donation_id
  LEFT JOIN tmp_dnt_max m ON m.y = n.y
   SET d.donation_no = CONCAT('DNT-', n.y, '-', IF(COALESCE(m.mx, 0) + n.rn > 9999, COALESCE(m.mx, 0) + n.rn, LPAD(COALESCE(m.mx, 0) + n.rn, 4, '0')));
DROP TEMPORARY TABLE IF EXISTS tmp_dnt_new;
DROP TEMPORARY TABLE IF EXISTS tmp_dnt_max;

INSERT INTO tbl_number_sequences (seq_key, next_value)
SELECT CONCAT('DNT-', YEAR(created_at)), MAX(CAST(SUBSTRING(donation_no, 10) AS UNSIGNED)) + 1
  FROM tbl_donations WHERE donation_no IS NOT NULL GROUP BY YEAR(created_at)
ON DUPLICATE KEY UPDATE next_value = GREATEST(next_value, VALUES(next_value));
INSERT INTO tbl_number_sequences (seq_key, next_value)
SELECT 'DNR', COALESCE(MAX(CAST(SUBSTRING(donor_code, 5) AS UNSIGNED)), 0) + 1 FROM tbl_donors
ON DUPLICATE KEY UPDATE next_value = GREATEST(next_value, VALUES(next_value));

-- ---------------------------------------------------------------- in-kind item lines (name, quantity, estimated value)
CREATE TABLE IF NOT EXISTS tbl_donation_item_lines (
    line_id              INT AUTO_INCREMENT PRIMARY KEY,
    donation_id          INT NOT NULL,
    item_name            VARCHAR(100) NOT NULL,
    quantity             INT NOT NULL,
    unit                 VARCHAR(20) NULL,
    estimated_value      DECIMAL(12,2) NULL COMMENT 'total estimated value of the line; NULL = value not set',
    inventory_item_id    INT NULL COMMENT 'the inventory item the stock went into',
    expiry_date          DATE NULL,
    item_condition       VARCHAR(30) NULL,
    created_at           DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_item_lines_donation (donation_id),
    CONSTRAINT fk_item_lines_donation FOREIGN KEY (donation_id) REFERENCES tbl_donations(donation_id),
    CONSTRAINT fk_item_lines_item FOREIGN KEY (inventory_item_id) REFERENCES tbl_inventory(item_id)
) ENGINE=InnoDB;

-- ---------------------------------------------------------------- inventory lots and movements
CREATE TABLE IF NOT EXISTS tbl_inventory_lots (
    lot_id        INT AUTO_INCREMENT PRIMARY KEY,
    item_id       INT NOT NULL,
    donation_id   INT NULL,
    line_id       INT NULL,
    received_qty  INT NOT NULL,
    remaining_qty INT NOT NULL,
    expiry_date   DATE NULL,
    received_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    created_by    INT NULL,
    INDEX idx_lots_item (item_id, expiry_date),
    INDEX idx_lots_donation (donation_id),
    CONSTRAINT fk_lots_item FOREIGN KEY (item_id) REFERENCES tbl_inventory(item_id),
    CONSTRAINT fk_lots_donation FOREIGN KEY (donation_id) REFERENCES tbl_donations(donation_id),
    CONSTRAINT fk_lots_line FOREIGN KEY (line_id) REFERENCES tbl_donation_item_lines(line_id),
    CONSTRAINT fk_lots_user FOREIGN KEY (created_by) REFERENCES tbl_users(user_id)
) ENGINE=InnoDB;
ALTER TABLE tbl_inventory_movements
  MODIFY COLUMN movement_type ENUM('donation_in', 'donation_reversal', 'manual_edit', 'distribution_out', 'void_reversal', 'correction') NOT NULL;
ALTER TABLE tbl_inventory_movements
  ADD COLUMN IF NOT EXISTS lot_id INT NULL,
  ADD COLUMN IF NOT EXISTS note   VARCHAR(255) NULL;
ALTER TABLE tbl_inventory_movements
  ADD CONSTRAINT fk_movement_lot FOREIGN KEY IF NOT EXISTS (lot_id) REFERENCES tbl_inventory_lots(lot_id);

-- ---------------------------------------------------------------- allocation lines (program + amount, or intended use)
CREATE TABLE IF NOT EXISTS tbl_donation_allocations (
    allocation_id INT AUTO_INCREMENT PRIMARY KEY,
    donation_id   INT NOT NULL,
    program       VARCHAR(40) NOT NULL,
    amount        DECIMAL(12,2) NULL COMMENT 'cash lines; NULL for in-kind or when the amount needs review',
    intended_use  VARCHAR(500) NULL,
    needs_review  BOOLEAN NOT NULL DEFAULT FALSE,
    original_text TEXT NULL COMMENT 'the free text this line came from',
    created_by    INT NULL,
    created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    superseded_at DATETIME NULL COMMENT 'set when the allocation is changed; the row is kept',
    INDEX idx_alloc_donation (donation_id, superseded_at),
    CONSTRAINT fk_alloc_donation FOREIGN KEY (donation_id) REFERENCES tbl_donations(donation_id),
    CONSTRAINT fk_alloc_user FOREIGN KEY (created_by) REFERENCES tbl_users(user_id)
) ENGINE=InnoDB;

-- ---------------------------------------------------------------- status history (immutable timeline)
CREATE TABLE IF NOT EXISTS tbl_donation_status_history (
    history_id   INT AUTO_INCREMENT PRIMARY KEY,
    donation_id  INT NOT NULL,
    from_status  VARCHAR(30) NULL,
    to_status    VARCHAR(30) NOT NULL,
    note         VARCHAR(255) NULL COMMENT 'no names or contact details',
    actor_id     INT NULL,
    created_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_dhist_donation (donation_id, created_at),
    CONSTRAINT fk_dhist_donation FOREIGN KEY (donation_id) REFERENCES tbl_donations(donation_id),
    CONSTRAINT fk_dhist_user FOREIGN KEY (actor_id) REFERENCES tbl_users(user_id)
) ENGINE=InnoDB;

-- ---------------------------------------------------------------- acknowledgments (the receipt, with its code and QR)
CREATE TABLE IF NOT EXISTS tbl_donation_acknowledgments (
    ack_id         INT AUTO_INCREMENT PRIMARY KEY,
    donation_id    INT NOT NULL,
    version        INT NOT NULL,
    issued_by      INT NULL,
    issued_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    reissue_reason VARCHAR(255) NULL,
    UNIQUE KEY uq_ack_version (donation_id, version),
    CONSTRAINT fk_ack_donation FOREIGN KEY (donation_id) REFERENCES tbl_donations(donation_id),
    CONSTRAINT fk_ack_user FOREIGN KEY (issued_by) REFERENCES tbl_users(user_id)
) ENGINE=InnoDB;

-- ---------------------------------------------------------------- distribution (in-kind) and utilization (cash)
CREATE TABLE IF NOT EXISTS tbl_donation_distributions (
    distribution_id INT AUTO_INCREMENT PRIMARY KEY,
    donation_id     INT NOT NULL,
    kind            ENUM('distribution', 'utilization') NOT NULL,
    line_id         INT NULL,
    lot_id          INT NULL,
    quantity        INT NULL,
    amount          DECIMAL(12,2) NULL,
    program         VARCHAR(40) NOT NULL,
    used_on         DATE NOT NULL,
    note            VARCHAR(500) NULL COMMENT 'what it was used for; never a child''s name',
    recorded_by     INT NOT NULL,
    created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_dist_donation (donation_id),
    CONSTRAINT fk_dist_donation FOREIGN KEY (donation_id) REFERENCES tbl_donations(donation_id),
    CONSTRAINT fk_dist_line FOREIGN KEY (line_id) REFERENCES tbl_donation_item_lines(line_id),
    CONSTRAINT fk_dist_lot FOREIGN KEY (lot_id) REFERENCES tbl_inventory_lots(lot_id),
    CONSTRAINT fk_dist_user FOREIGN KEY (recorded_by) REFERENCES tbl_users(user_id)
) ENGINE=InnoDB;

-- ---------------------------------------------------------------- void requests (Staff ask, Admin decides) and corrections
CREATE TABLE IF NOT EXISTS tbl_donation_void_requests (
    request_id    INT AUTO_INCREMENT PRIMARY KEY,
    donation_id   INT NOT NULL,
    reason        VARCHAR(40) NOT NULL,
    note          VARCHAR(500) NULL,
    requested_by  INT NOT NULL,
    requested_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    status        ENUM('Pending', 'Approved', 'Declined') NOT NULL DEFAULT 'Pending',
    decided_by    INT NULL,
    decided_at    DATETIME NULL,
    decision_note VARCHAR(500) NULL,
    INDEX idx_void_req (donation_id, status),
    CONSTRAINT fk_voidreq_donation FOREIGN KEY (donation_id) REFERENCES tbl_donations(donation_id),
    CONSTRAINT fk_voidreq_user FOREIGN KEY (requested_by) REFERENCES tbl_users(user_id),
    CONSTRAINT fk_voidreq_decider FOREIGN KEY (decided_by) REFERENCES tbl_users(user_id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS tbl_donation_corrections (
    correction_id INT AUTO_INCREMENT PRIMARY KEY,
    donation_id   INT NOT NULL,
    field         VARCHAR(40) NOT NULL,
    old_value     VARCHAR(500) NULL,
    new_value     VARCHAR(500) NULL,
    reason        VARCHAR(500) NOT NULL,
    made_by       INT NOT NULL,
    made_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_corr_donation (donation_id),
    CONSTRAINT fk_corr_donation FOREIGN KEY (donation_id) REFERENCES tbl_donations(donation_id),
    CONSTRAINT fk_corr_user FOREIGN KEY (made_by) REFERENCES tbl_users(user_id)
) ENGINE=InnoDB;

-- ---------------------------------------------------------------- documents (delivery receipt, proof of transfer, photos)
CREATE TABLE IF NOT EXISTS tbl_donation_documents (
    document_id   INT AUTO_INCREMENT PRIMARY KEY,
    donation_id   INT NOT NULL,
    kind          ENUM('delivery_receipt', 'proof_of_transfer', 'photo', 'other') NOT NULL,
    label         VARCHAR(150) NOT NULL,
    original_name VARCHAR(200) NOT NULL,
    mime_type     VARCHAR(50) NOT NULL,
    size_bytes    INT NOT NULL,
    storage_key   VARCHAR(255) NOT NULL,
    sha256        CHAR(64) NULL,
    no_children_confirmed BOOLEAN NOT NULL DEFAULT FALSE COMMENT 'photos: the uploader confirmed no child is shown',
    uploaded_by   INT NOT NULL,
    uploaded_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_ddoc_donation (donation_id),
    CONSTRAINT fk_ddoc_donation FOREIGN KEY (donation_id) REFERENCES tbl_donations(donation_id),
    CONSTRAINT fk_ddoc_user FOREIGN KEY (uploaded_by) REFERENCES tbl_users(user_id)
) ENGINE=InnoDB;

-- New Staff duty "donor_directory" (donor identity and contact details) is NOT given to anyone automatically:
-- Staff keep exactly what they see today (initials and masked contacts). Admin grants it under User accounts.
