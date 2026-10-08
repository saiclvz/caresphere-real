-- Migration 005 - "Available for adoption" flag on the child record
-- Staff and Admin can set it. Only Active children under 18 with this flag
-- appear on Adopt a Child. Default is FALSE (not available), so existing and
-- new children keep saving without it.
--
-- Safe to run more than once (npm run migrate re-runs every file).
USE caresphere_db;

ALTER TABLE tbl_children
  ADD COLUMN IF NOT EXISTS available_for_adoption BOOLEAN NOT NULL DEFAULT FALSE AFTER is_public;

CREATE INDEX IF NOT EXISTS idx_children_adoption ON tbl_children (available_for_adoption, status);
