-- Migration 026 - health access token method values
--
-- tbl_health_access_tokens.method was ENUM('TYPED_TOKEN', 'PASSWORD'), but the shared unlock flow (015)
-- issues health tokens with method 'unlock', and Admin full access with 'ADMIN_FULL_ACCESS'. In strict
-- SQL mode those inserts failed (health records would not open); in non-strict mode they were saved as ''.
-- The column becomes VARCHAR(30) so every method the code uses is stored as written. Existing rows keep
-- their values ('' rows stay ''; they can't be recovered and are only expired access tokens).
--
-- Safe to run more than once. Rollback: database/rollback/026_health_access_method_rollback.sql
USE caresphere_db;

ALTER TABLE tbl_health_access_tokens MODIFY COLUMN method VARCHAR(30) NOT NULL;
