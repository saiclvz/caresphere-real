-- Migration 021 - Adoption requirements by NACC adoption type, document verification statuses
--
-- * tbl_adoption_applications.application_type gains the NACC types: Stepparent, Relative_own_child
--   (adoption of one's own non-marital child) and Adult. Existing Regular and Relative rows are unchanged.
-- * tbl_applicant_details: citizenship, children aged 10+, previous adoption, and the adoptee's date of
--   birth and relationship (for non-Regular types): the answers that decide which documents apply.
-- * tbl_adoption_documents gets a verification status (Submitted, Under validation, Verified, Rejected,
--   Requires correction, Manual verification required), the date the document was issued or taken
--   (for validity periods such as "clearance issued within one year"), and who reviewed it, when and why.
--   Existing files start as "Manual verification required": nothing is marked verified automatically.
--   "Expired" is worked out from the issue date and the document's validity, not stored.
--
-- No file or record is deleted. Safe to run more than once.
-- Rollback: database/rollback/021_nacc_requirements_rollback.sql
USE caresphere_db;

ALTER TABLE tbl_adoption_applications
  MODIFY COLUMN application_type ENUM('Regular', 'Relative', 'Stepparent', 'Relative_own_child', 'Adult') NOT NULL DEFAULT 'Regular';

-- Answers that decide which NACC documents apply. The adoptee's date of birth and relationship are
-- stored encrypted, like the applicant's own details.
ALTER TABLE tbl_applicant_details
  ADD COLUMN IF NOT EXISTS citizenship VARCHAR(20) NULL,
  ADD COLUMN IF NOT EXISTS children_10_plus VARCHAR(3) NULL,
  ADD COLUMN IF NOT EXISTS nonmarital_children_10_plus VARCHAR(3) NULL,
  ADD COLUMN IF NOT EXISTS has_adopted_before VARCHAR(3) NULL,
  ADD COLUMN IF NOT EXISTS adoptee_dob VARCHAR(255) NULL,
  ADD COLUMN IF NOT EXISTS adoptee_relationship VARCHAR(255) NULL;

ALTER TABLE tbl_adoption_documents
  ADD COLUMN IF NOT EXISTS verification_status ENUM('Submitted', 'Under validation', 'Verified', 'Rejected', 'Requires correction', 'Manual verification required')
      NOT NULL DEFAULT 'Manual verification required' AFTER status,
  ADD COLUMN IF NOT EXISTS issued_date DATE NULL AFTER verification_status,
  ADD COLUMN IF NOT EXISTS reviewed_by INT NULL AFTER issued_date,
  ADD COLUMN IF NOT EXISTS reviewed_at DATETIME NULL AFTER reviewed_by,
  ADD COLUMN IF NOT EXISTS review_note VARCHAR(500) NULL AFTER reviewed_at;
ALTER TABLE tbl_adoption_documents
  ADD CONSTRAINT fk_adoption_documents_reviewer FOREIGN KEY IF NOT EXISTS (reviewed_by) REFERENCES tbl_users(user_id);
CREATE INDEX IF NOT EXISTS idx_adoption_documents_verification ON tbl_adoption_documents (application_id, verification_status);
