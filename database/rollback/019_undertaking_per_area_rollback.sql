-- Rollback for 019. First move database/019_undertaking_per_area.sql out of the database folder.
-- Removes the area columns. Acceptance rows and versions are kept; Transition Review versions stay as
-- rows (without their area). The session-only unique key from 018 is not restored, because one
-- session may now hold two acceptances; a plain index takes its place.
USE caresphere_db;
ALTER TABLE tbl_confidentiality_undertakings DROP INDEX IF EXISTS uq_undertaking_session_area;
CREATE INDEX IF NOT EXISTS idx_undertaking_session ON tbl_confidentiality_undertakings (session_jti);
ALTER TABLE tbl_confidentiality_undertakings DROP COLUMN IF EXISTS area;
ALTER TABLE tbl_undertaking_versions DROP INDEX IF EXISTS idx_undertaking_versions_area;
ALTER TABLE tbl_undertaking_versions DROP COLUMN IF EXISTS area;
