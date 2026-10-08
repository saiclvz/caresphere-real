-- REVIEW BEFORE RUNNING. Renames test child records to neutral names before a demo.
-- Nothing in CareSphere runs this file automatically, and `npm run migrate` does not read the
-- review/ folder. Run it yourself in phpMyAdmin (SQL tab) after checking each line.
USE caresphere_db;

-- 1) Look first: every child currently in Transition Review (18+), with the name shown in the list.
SELECT c.child_id AS case_number, c.first_name, c.last_name, c.full_name, tr.review_status
  FROM tbl_transition_reviews tr JOIN tbl_children c ON c.child_id = tr.child_id
 ORDER BY c.child_id;

-- 2) For each record whose name you want to replace, copy one line below, put its case number in,
--    and remove the leading "-- ". Example neutral names: Test Youth A, Test Youth B, ...
--    (full_name is updated too, because lists and search read it.)
-- UPDATE tbl_children SET first_name = 'Test', last_name = 'Youth A', full_name = 'Test Youth A' WHERE child_id = 'CS-2026-0004';
-- UPDATE tbl_children SET first_name = 'Test', last_name = 'Youth B', full_name = 'Test Youth B' WHERE child_id = 'CS-2026-0005';

-- 3) Check again.
SELECT child_id, full_name FROM tbl_children ORDER BY child_id;
