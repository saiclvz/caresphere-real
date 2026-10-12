-- Rollback for migration 032 (three-level child record access).
-- Before running it: move database/032_child_record_access.sql out of the database folder (the migration runner
-- re-runs every file) and put back the previous backend and frontend files.
-- It drops ONLY the tables 032 added. Children, users, the old assigned_staff_id columns (which always kept the
-- active primary case worker), unlock sessions, notifications and the audit log are untouched.
-- What is lost: assignment history (backup and temporary cover), Care cards, access requests, emergency access
-- reviews, monitoring visits, privacy concerns and the "would be blocked" counts. Export them first if needed:
--   SELECT * FROM tbl_record_assignments;  SELECT * FROM tbl_care_cards;  SELECT * FROM tbl_emergency_access;  ...
USE caresphere_db;
SET FOREIGN_KEY_CHECKS = 0;
DROP TABLE IF EXISTS tbl_child_access_requests;
DROP TABLE IF EXISTS tbl_emergency_access;
DROP TABLE IF EXISTS tbl_monitoring_records;
DROP TABLE IF EXISTS tbl_monitoring_sessions;
DROP TABLE IF EXISTS tbl_care_cards;
DROP TABLE IF EXISTS tbl_child_field_levels;
DROP TABLE IF EXISTS tbl_child_access_shadow;
DROP TABLE IF EXISTS tbl_reassignment_flags;
DROP TABLE IF EXISTS tbl_privacy_concerns;
DROP TABLE IF EXISTS tbl_child_initial_access;
DROP TABLE IF EXISTS tbl_record_assignments;
SET FOREIGN_KEY_CHECKS = 1;
DELETE FROM tbl_settings WHERE setting_key IN ('child_access_mode', 'child_initial_access_days', 'child_emergency_minutes',
  'child_emergency_uses_per_day', 'child_care_card_visibility', 'child_care_card_review_days', 'child_default_case_worker_id');
