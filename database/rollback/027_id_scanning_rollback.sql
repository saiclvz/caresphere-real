-- Rollback for 027. First move database/027_id_scanning.sql out of the database folder.
-- Removes the ID scanning tables and columns. Uploaded ID photos, applications and verification statuses
-- are kept; the official verification details and scan results recorded since 027 are lost, so export them
-- first if you need them.
USE caresphere_db;

ALTER TABLE tbl_verifications
  DROP COLUMN IF EXISTS official_raw_enc,
  DROP COLUMN IF EXISTS official_mode,
  DROP COLUMN IF EXISTS official_by,
  DROP COLUMN IF EXISTS official_at,
  DROP COLUMN IF EXISTS official_reference,
  DROP COLUMN IF EXISTS official_result,
  DROP COLUMN IF EXISTS official_source,
  DROP COLUMN IF EXISTS auto_result;
DROP TABLE IF EXISTS tbl_id_scans;
DROP TABLE IF EXISTS tbl_id_type_rules;
DELETE FROM tbl_settings WHERE setting_key = 'id_scan_retention_days';
