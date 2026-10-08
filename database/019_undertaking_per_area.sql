-- Migration 019 - Confidentiality undertaking per area, the first time each sign-in session opens it
--
-- Replaces the "on every sign-in" behaviour of 018. Admin and Staff accept it when they first open
-- Adoption or Transition Review in a session (config: backend/src/config/undertaking.js).
-- * tbl_confidentiality_undertakings: adds `area` (adoption, transition, or shared). Rows from before
--   keep area NULL and stay as history. The unique key becomes (session, area).
-- * tbl_undertaking_versions: adds `area`; existing versions are Adoption versions. The Transition
--   Review first version (CU-TR-2026-1) is added by the server on first use.
-- * The undertaking_timeout_minutes setting from 018 is no longer used (the row is left in place).
--
-- Safe to run more than once. Rollback: database/rollback/019_undertaking_per_area_rollback.sql
USE caresphere_db;

ALTER TABLE tbl_confidentiality_undertakings ADD COLUMN IF NOT EXISTS area VARCHAR(20) NULL AFTER version_id;
ALTER TABLE tbl_confidentiality_undertakings DROP INDEX IF EXISTS uq_undertaking_session;
CREATE UNIQUE INDEX IF NOT EXISTS uq_undertaking_session_area ON tbl_confidentiality_undertakings (session_jti, area);

ALTER TABLE tbl_undertaking_versions ADD COLUMN IF NOT EXISTS area VARCHAR(20) NOT NULL DEFAULT 'adoption' AFTER version;
CREATE INDEX IF NOT EXISTS idx_undertaking_versions_area ON tbl_undertaking_versions (area, version_id);
