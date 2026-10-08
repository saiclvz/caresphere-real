-- Rollback for 022. First move database/022_id_clearance_verification.sql out of the database folder.
-- Removes the ID and clearance details and the verification records and their history.
USE caresphere_db;
DROP TRIGGER IF EXISTS trg_verification_events_no_update;
DROP TRIGGER IF EXISTS trg_verification_events_no_delete;
DROP TABLE IF EXISTS tbl_verification_events;
DROP TABLE IF EXISTS tbl_verifications;
ALTER TABLE tbl_applicant_details DROP COLUMN IF EXISTS id_number, DROP COLUMN IF EXISTS id_expiry, DROP COLUMN IF EXISTS id_name,
  DROP COLUMN IF EXISTS id_dob, DROP COLUMN IF EXISTS clearances;
