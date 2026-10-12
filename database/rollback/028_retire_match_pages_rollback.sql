-- Rollback for 028. First move database/028_retire_match_pages.sql out of the database folder, and put
-- back the previous backend and frontend files.
-- Removes the matching tables and columns, the page completion state and the archive columns.
-- After this, archived documents are no longer marked archived. Files already disposed of (removed from
-- disk) cannot be restored. Match records and their history are lost: export them first if you need them.
USE caresphere_db;

DROP TABLE IF EXISTS tbl_adoption_match_events;
DROP TABLE IF EXISTS tbl_adoption_matches;
DROP TABLE IF EXISTS tbl_child_match_documents;

ALTER TABLE tbl_adoption_applications
  DROP COLUMN IF EXISTS completed_pages,
  DROP COLUMN IF EXISTS link_note,
  DROP COLUMN IF EXISTS link_verified_by,
  DROP COLUMN IF EXISTS link_verified_at,
  DROP COLUMN IF EXISTS link_child_id;

ALTER TABLE tbl_children
  DROP COLUMN IF EXISTS needs_own_room,
  DROP COLUMN IF EXISTS sibling_group_size,
  DROP COLUMN IF EXISTS special_needs;

ALTER TABLE tbl_applicant_details
  DROP COLUMN IF EXISTS pref_space,
  DROP COLUMN IF EXISTS pref_siblings,
  DROP COLUMN IF EXISTS pref_special_needs,
  DROP COLUMN IF EXISTS pref_age_range,
  DROP COLUMN IF EXISTS adoptee_name;

ALTER TABLE tbl_adoption_documents
  DROP INDEX IF EXISTS idx_adoption_docs_archived,
  DROP COLUMN IF EXISTS dispose_reason,
  DROP COLUMN IF EXISTS disposed_by,
  DROP COLUMN IF EXISTS disposed_at,
  DROP COLUMN IF EXISTS archive_reason,
  DROP COLUMN IF EXISTS archived_at;
