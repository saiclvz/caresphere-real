-- Rollback for 009_adoption_v3.sql: restores the adoption tables from the *_backup_v2 copies.
--
-- BEFORE RUNNING:
--   1. Back up the current database (phpMyAdmin > Export).
--   2. Move database/009_adoption_v3.sql out of the database folder, otherwise the next
--      `npm run migrate` converts everything again.
--   3. Put back the previous backend/frontend adoption files (the ones before Part 1).
-- Run in phpMyAdmin (SQL tab) or: mysql -u root caresphere_db < this-file.sql
--
-- Applications, documents and reviews return to exactly what they were before 009.
-- Lost: anything created after 009 (new drafts and applications, new uploads, status
-- history, internal notes, document requests, interviews). Uploaded files stay on disk.
-- A child finalized after 009 stays Adopted in tbl_children.
USE caresphere_db;
SET FOREIGN_KEY_CHECKS = 0;

DROP TABLE IF EXISTS tbl_application_interviews;
DROP TABLE IF EXISTS tbl_application_document_requests;
DROP TABLE IF EXISTS tbl_application_notes;
DROP TABLE IF EXISTS tbl_application_status_history;
DROP TABLE IF EXISTS tbl_household_members;
DROP TABLE IF EXISTS tbl_applicant_spouse;
DROP TABLE IF EXISTS tbl_applicant_details;

DROP TABLE IF EXISTS tbl_adoption_documents;
DROP TABLE IF EXISTS tbl_adoption_applications;
DROP TABLE IF EXISTS tbl_adoption_reviews;
RENAME TABLE tbl_adoption_applications_backup_v2 TO tbl_adoption_applications,
             tbl_adoption_documents_backup_v2 TO tbl_adoption_documents,
             tbl_adoption_reviews_backup_v2 TO tbl_adoption_reviews;

-- CREATE TABLE ... LIKE copies columns and indexes but not foreign keys, so add them back.
ALTER TABLE tbl_adoption_applications
  ADD CONSTRAINT FOREIGN KEY (applicant_id) REFERENCES tbl_users(user_id),
  ADD CONSTRAINT FOREIGN KEY (child_id) REFERENCES tbl_children(child_id) ON DELETE RESTRICT;
ALTER TABLE tbl_adoption_documents
  ADD CONSTRAINT FOREIGN KEY (application_id) REFERENCES tbl_adoption_applications(application_id) ON DELETE CASCADE,
  ADD CONSTRAINT FOREIGN KEY (uploaded_by) REFERENCES tbl_users(user_id);
ALTER TABLE tbl_adoption_reviews
  ADD CONSTRAINT FOREIGN KEY (application_id) REFERENCES tbl_adoption_applications(application_id) ON DELETE CASCADE,
  ADD CONSTRAINT FOREIGN KEY (reviewer_id) REFERENCES tbl_users(user_id);

SET FOREIGN_KEY_CHECKS = 1;
SELECT 'Adoption tables restored from the v2 backups.' AS rollback_note;
