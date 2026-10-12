-- Rollback for 029. First move database/029_adoption_stages.sql out of the database folder and put back
-- the previous backend and frontend files. The stage records, follow-ups, child eligibility, versions and
-- stage timeline recorded since 029 are lost: export them first if you need them. Applications, children,
-- documents, statuses and the audit log are kept.
USE caresphere_db;

DROP TABLE IF EXISTS tbl_adoption_stage_events;
DROP TABLE IF EXISTS tbl_adoption_record_versions;
DROP TABLE IF EXISTS tbl_child_adoption_eligibility;
DROP TABLE IF EXISTS tbl_adoption_stage_entries;
DROP TABLE IF EXISTS tbl_adoption_stage_records;

ALTER TABLE tbl_adoption_matches DROP COLUMN IF EXISTS recommendation_type;

ALTER TABLE tbl_adoption_applications
  DROP FOREIGN KEY IF EXISTS fk_adoption_target_child,
  DROP FOREIGN KEY IF EXISTS fk_adoption_created_by_staff;
ALTER TABLE tbl_adoption_applications
  DROP COLUMN IF EXISTS target_child_id,
  DROP COLUMN IF EXISTS created_by_staff;
