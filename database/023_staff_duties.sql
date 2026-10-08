-- Migration 023 - Staff duties
--
-- Admin chooses which areas each Staff account works in: child records, health records, adoption,
-- transition review, donations, visitors, inventory and meals (backend/src/config/staffDuties.js).
-- The server only lets Staff use the areas in their duties. Admin has every area; Donors are unaffected.
--
-- Existing Staff accounts get every duty, so nothing changes for them until Admin edits their duties.
-- Safe to run more than once: the seeding step runs only once, so duties Admin removed stay removed.
-- Rollback: database/rollback/023_staff_duties_rollback.sql
USE caresphere_db;

CREATE TABLE IF NOT EXISTS tbl_staff_duties (
    user_id    INT NOT NULL,
    duty       VARCHAR(20) NOT NULL,
    granted_by INT NULL,
    granted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id, duty),
    CONSTRAINT fk_staff_duties_user FOREIGN KEY (user_id) REFERENCES tbl_users(user_id),
    CONSTRAINT fk_staff_duties_granter FOREIGN KEY (granted_by) REFERENCES tbl_users(user_id)
) ENGINE=InnoDB;

-- Marker so "give existing Staff every duty" runs only once (the migration runner re-runs every file).
CREATE TABLE IF NOT EXISTS tbl_migration_markers (marker VARCHAR(60) PRIMARY KEY, done_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP) ENGINE=InnoDB;

INSERT IGNORE INTO tbl_staff_duties (user_id, duty)
SELECT u.user_id, d.duty
  FROM tbl_users u JOIN tbl_roles r ON r.role_id = u.role_id
  CROSS JOIN (SELECT 'children' AS duty UNION ALL SELECT 'health' UNION ALL SELECT 'adoption' UNION ALL SELECT 'transition'
              UNION ALL SELECT 'donations' UNION ALL SELECT 'visitors' UNION ALL SELECT 'inventory' UNION ALL SELECT 'meals') d
 WHERE r.role_name = 'Staff'
   AND NOT EXISTS (SELECT 1 FROM tbl_migration_markers WHERE marker = '023_staff_duties_seeded');

INSERT IGNORE INTO tbl_migration_markers (marker) VALUES ('023_staff_duties_seeded');
