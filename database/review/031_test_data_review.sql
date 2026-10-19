-- REVIEW SCRIPT (not a migration; `npm run migrate` does not run files in database/review).
-- Donations and donor records that look like test data, for you to check before a demo.
-- Step 1 only READS. Step 2 is commented out: copy only the lines you want, change the values, and run them in
-- phpMyAdmin yourself. Nothing is deleted.
--
-- To VOID a test donation, use the Void button on the Donations page instead of SQL and choose the reason
-- "Test data": it records the reason, reverses any stock the donation added, keeps the donation (never deleted) and
-- its audit history, and leaves it out of every total. Only void what you have checked is really test data.
USE caresphere_db;

-- ---------------------------------------------------------------- 1. find (read-only)
-- Words that usually mean test data. Add your own to the list.
SELECT d.donation_id, d.donation_no, d.status, d.payment_method, d.amount, dr.donor_code,
       COALESCE(d.legacy_allocation, d.allocation_notes) AS allocation_text, d.item_description
  FROM tbl_donations d LEFT JOIN tbl_donors dr ON dr.donor_ref_id = d.donor_ref_id
 WHERE CONCAT_WS(' ', d.legacy_allocation, d.allocation_notes, d.item_description, d.walk_in_name, d.donor_name)
       REGEXP '(squishy|subscription|test|testing|sample|dummy|asdf|qwer|lorem|sdf|xxx|abc)'
 ORDER BY d.created_at;

SELECT r.donor_ref_id, r.donor_code, r.display_name, r.origin
  FROM tbl_donors r
 WHERE r.display_name REGEXP '(test|sample|dummy|asdf|qwer|lorem|xxx|abc)' OR CHAR_LENGTH(TRIM(r.display_name)) < 3
 ORDER BY r.donor_code;

-- Allocation lines still marked Needs review (the original text is kept in original_text).
SELECT d.donation_no, a.program, a.amount, a.intended_use, a.original_text
  FROM tbl_donation_allocations a JOIN tbl_donations d ON d.donation_id = a.donation_id
 WHERE a.superseded_at IS NULL AND a.needs_review = TRUE ORDER BY d.donation_no;

-- ---------------------------------------------------------------- 2. rename (only what you choose; commented out)
-- Rename a test donor record (the donor list and profile). The donation keeps its original walk-in name.
-- UPDATE tbl_donors SET display_name = 'Demo Donor', name_key = 'demo donor' WHERE donor_code = 'DNR-0000';

-- Replace a test allocation description. Better: open the donation and use "Change allocation" (a correction with
-- a reason is recorded after acknowledgment). In SQL, the earlier line is kept and marked superseded:
-- UPDATE tbl_donation_allocations SET superseded_at = NOW() WHERE donation_id = (SELECT donation_id FROM tbl_donations WHERE donation_no = 'DNT-2026-0000') AND superseded_at IS NULL;
-- INSERT INTO tbl_donation_allocations (donation_id, program, amount, intended_use, needs_review, original_text)
--   SELECT donation_id, 'Education', amount, 'School supplies', FALSE, legacy_allocation FROM tbl_donations WHERE donation_no = 'DNT-2026-0000';
-- UPDATE tbl_donations SET purpose = 'Education' WHERE donation_no = 'DNT-2026-0000';
