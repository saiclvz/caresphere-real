-- Migration 035 - traceable inventory: every quantity change is a stock movement with a type and a reason.
--
-- A. Movement types. stock_in, stock_out, adjustment and disposal are added to tbl_inventory_movements.movement_type.
--    Existing values stay (donation_in, donation_reversal, manual_edit, distribution_out, void_reversal, correction)
--    and are shown under the matching type in the history (donation_in = Stock in, distribution_out = Stock out, ...).
-- B. Reason, previous quantity and reference. reason (the chosen reason: "Opening balance", "Purchase",
--    "Meal preparation", "Expired", ...), quantity_before, and reference (a related record, e.g. a purchase receipt
--    number). The note column (031) keeps the free-text detail.
-- C. Opening balances (one-time backfill, safe to re-run). For every item that has no "Opening balance" movement yet
--    and whose opening quantity is above 0, one stock_in movement "Opening balance" is added, dated just before the
--    item's first movement. The opening quantity is what the item had before its first recorded movement (or its
--    current quantity when it has none), so  opening + every movement = current quantity. tbl_inventory.quantity is
--    NOT changed (nothing is counted twice). Re-running finds the existing "Opening balance" rows and adds nothing.
--
-- No row is changed or removed. Rollback: database/rollback/035_inventory_movements_rollback.sql
USE caresphere_db;

-- ------------------------------------------------------------------ A
ALTER TABLE tbl_inventory_movements
  MODIFY COLUMN movement_type ENUM('donation_in', 'donation_reversal', 'manual_edit', 'distribution_out', 'void_reversal', 'correction',
                                   'stock_in', 'stock_out', 'adjustment', 'disposal') NOT NULL;

-- ------------------------------------------------------------------ B
ALTER TABLE tbl_inventory_movements
  ADD COLUMN IF NOT EXISTS reason          VARCHAR(60)  NULL,
  ADD COLUMN IF NOT EXISTS quantity_before INT          NULL,
  ADD COLUMN IF NOT EXISTS reference       VARCHAR(100) NULL,
  ADD INDEX IF NOT EXISTS idx_movements_type_date (movement_type, created_at);

-- ------------------------------------------------------------------ C
INSERT INTO tbl_inventory_movements (item_id, movement_type, change_qty, quantity_before, quantity_after, reason, note, created_by, created_at)
SELECT i.item_id, 'stock_in', o.opening, 0, o.opening, 'Opening balance', 'Recorded by migration 035 (stock on hand before movements were tracked)',
       i.last_updated_by, COALESCE(o.first_at - INTERVAL 1 SECOND, i.updated_at, NOW())
  FROM tbl_inventory i
  JOIN (
    SELECT x.item_id,
           COALESCE((SELECT m.quantity_after - m.change_qty FROM tbl_inventory_movements m
                      WHERE m.item_id = x.item_id ORDER BY m.created_at, m.movement_id LIMIT 1), x.quantity) AS opening,
           (SELECT MIN(m2.created_at) FROM tbl_inventory_movements m2 WHERE m2.item_id = x.item_id) AS first_at
      FROM tbl_inventory x
  ) o ON o.item_id = i.item_id
 WHERE o.opening > 0
   AND NOT EXISTS (SELECT 1 FROM tbl_inventory_movements e WHERE e.item_id = i.item_id AND e.reason = 'Opening balance');
