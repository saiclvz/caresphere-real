-- Migration 004 - Merge the Applicant role into Donor
-- Adoption features (Adopt a Child, My applications) now live inside Donor accounts.
-- 1. Every user with the Applicant role becomes a Donor (their applications,
--    documents and donations stay linked, because they are keyed by user_id).
-- 2. The Applicant role is removed only once no user references it.
--
-- Safe to run more than once (npm run migrate re-runs every file).
USE caresphere_db;

-- Make sure the Donor role exists before moving anyone to it.
INSERT IGNORE INTO tbl_roles (role_name) VALUES ('Donor');

-- 1. Move Applicant users to Donor.
UPDATE tbl_users u
  JOIN tbl_roles applicant ON applicant.role_id = u.role_id AND applicant.role_name = 'Applicant'
  JOIN tbl_roles donor     ON donor.role_name = 'Donor'
   SET u.role_id = donor.role_id;

-- 2. Remove the Applicant role (only if nobody still uses it).
DELETE FROM tbl_roles
 WHERE role_name = 'Applicant'
   AND NOT EXISTS (SELECT 1 FROM tbl_users u WHERE u.role_id = tbl_roles.role_id);
