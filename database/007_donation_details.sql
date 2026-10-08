-- Migration 007 - Staff-recorded donation details
-- * reason_category: the "Reason" dropdown (list in backend/src/config/donationOptions.js)
-- * is_general: TRUE when the donation is not for specific children
-- Children links reuse the existing tbl_donation_children table.
-- "Description" uses the existing item_description column and
-- "How it will be used" uses the existing allocation_notes column.
--
-- Safe to run more than once (npm run migrate re-runs every file).
USE caresphere_db;

ALTER TABLE tbl_donations
  ADD COLUMN IF NOT EXISTS reason_category VARCHAR(60) NULL AFTER reason_for_donation,
  ADD COLUMN IF NOT EXISTS is_general BOOLEAN NOT NULL DEFAULT FALSE AFTER reason_category;

-- Existing donations with no linked children were general gifts.
UPDATE tbl_donations d
   SET d.is_general = TRUE
 WHERE d.is_general = FALSE
   AND NOT EXISTS (SELECT 1 FROM tbl_donation_children dc WHERE dc.donation_id = d.donation_id);

CREATE INDEX IF NOT EXISTS idx_donation_children_child ON tbl_donation_children (child_id);
