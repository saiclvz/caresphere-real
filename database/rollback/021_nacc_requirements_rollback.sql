-- Rollback for 021. First move database/021_nacc_requirements.sql out of the database folder.
-- Applications of the new types (Stepparent, Relative_own_child, Adult) become 'Relative', the closest
-- earlier type, so the narrower type list fits. Verification columns are removed; files are kept.
USE caresphere_db;
UPDATE tbl_adoption_applications SET application_type = 'Relative' WHERE application_type IN ('Stepparent', 'Relative_own_child', 'Adult');
ALTER TABLE tbl_adoption_applications MODIFY COLUMN application_type ENUM('Regular', 'Relative') NOT NULL DEFAULT 'Regular';
ALTER TABLE tbl_applicant_details DROP COLUMN IF EXISTS citizenship, DROP COLUMN IF EXISTS children_10_plus,
  DROP COLUMN IF EXISTS nonmarital_children_10_plus, DROP COLUMN IF EXISTS has_adopted_before, DROP COLUMN IF EXISTS adoptee_dob,
  DROP COLUMN IF EXISTS adoptee_relationship;
ALTER TABLE tbl_adoption_documents DROP FOREIGN KEY IF EXISTS fk_adoption_documents_reviewer;
ALTER TABLE tbl_adoption_documents DROP INDEX IF EXISTS idx_adoption_documents_verification;
ALTER TABLE tbl_adoption_documents DROP COLUMN IF EXISTS verification_status, DROP COLUMN IF EXISTS issued_date,
  DROP COLUMN IF EXISTS reviewed_by, DROP COLUMN IF EXISTS reviewed_at, DROP COLUMN IF EXISTS review_note;
