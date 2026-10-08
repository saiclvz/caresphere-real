-- Rollback for 024. First move database/024_id_reading.sql out of the database folder.
-- Removes the ID reading results only. Uploaded IDs and verification records are kept.
USE caresphere_db;
DROP TABLE IF EXISTS tbl_id_ocr;
