-- Rollback for migration 035 (inventory movement types, reasons, opening balances).
-- Before running it: move database/035_inventory_movements.sql out of the database folder (the migration runner
-- re-runs every file) and put back the previous backend and frontend files.
--
-- Item quantities are not touched. The previous app does not know the new movement types, so new movements are
-- kept but relabelled to the closest old type before the type list is narrowed:
--   stock_in, stock_out, adjustment, disposal  ->  manual_edit  (the reason is copied into the note)
-- The opening-balance rows added by 035 (note "Recorded by migration 035 ...") are kept as manual_edit history.
-- Export first if you want the exact types:  SELECT * FROM tbl_inventory_movements WHERE movement_type IN
--   ('stock_in', 'stock_out', 'adjustment', 'disposal');
USE caresphere_db;
UPDATE tbl_inventory_movements
   SET note = LEFT(CONCAT_WS(' - ', CONCAT(UPPER(REPLACE(movement_type, '_', ' ')), ': ', reason), note), 255), movement_type = 'manual_edit'
 WHERE movement_type IN ('stock_in', 'stock_out', 'adjustment', 'disposal');
ALTER TABLE tbl_inventory_movements
  MODIFY COLUMN movement_type ENUM('donation_in', 'donation_reversal', 'manual_edit', 'distribution_out', 'void_reversal', 'correction') NOT NULL;
ALTER TABLE tbl_inventory_movements DROP INDEX IF EXISTS idx_movements_type_date,
  DROP COLUMN IF EXISTS reason, DROP COLUMN IF EXISTS quantity_before, DROP COLUMN IF EXISTS reference;
