-- Rollback for 030. First move database/030_transition_workflow.sql out of the database folder and put back
-- the previous backend and frontend files. Everything recorded in the 9-stage workflow since 030 (assessments,
-- the young person's answers, conferences, decisions, plans, tasks, preparation, transitions, aftercare,
-- uploaded-file records and the review timeline) is lost: export it first if you need it. The uploaded files
-- stay on disk under backend/uploads/transition. Children, reviews, the discharge history and the audit log
-- are kept. A child discharged through Transition Review stays Discharged (with its discharge history row).
USE caresphere_db;

DROP TABLE IF EXISTS tbl_transition_events;
DROP TABLE IF EXISTS tbl_transition_record_versions;
DROP TABLE IF EXISTS tbl_transition_documents;
DROP TABLE IF EXISTS tbl_aftercare_visits;
DROP TABLE IF EXISTS tbl_aftercare_plans;
DROP TABLE IF EXISTS tbl_transition_discharges;
DROP TABLE IF EXISTS tbl_transition_preparation;
DROP TABLE IF EXISTS tbl_transition_tasks;
DROP TABLE IF EXISTS tbl_transition_plans;
DROP TABLE IF EXISTS tbl_transition_decisions;
DROP TABLE IF EXISTS tbl_transition_conference_participants;
DROP TABLE IF EXISTS tbl_transition_conferences;
DROP TABLE IF EXISTS tbl_transition_child_voice;
DROP TABLE IF EXISTS tbl_transition_assessment_items;
DROP TABLE IF EXISTS tbl_transition_assessments;

ALTER TABLE tbl_transition_reviews DROP FOREIGN KEY IF EXISTS fk_transition_closed_by;
ALTER TABLE tbl_transition_reviews
  DROP COLUMN IF EXISTS closed_by,
  DROP COLUMN IF EXISTS closed_at,
  DROP COLUMN IF EXISTS closure_notes_enc,
  DROP COLUMN IF EXISTS closure_date,
  DROP COLUMN IF EXISTS final_assessment_enc,
  DROP COLUMN IF EXISTS final_outcome,
  DROP COLUMN IF EXISTS assessment_started_at,
  DROP COLUMN IF EXISTS next_review_date,
  DROP COLUMN IF EXISTS target_transition_date,
  DROP COLUMN IF EXISTS proposed_pathway;
