-- Migration 002 - Reference data required for the system to run.
-- (Roles and default settings only. User accounts are created with
--  `npm run create-admin`, never with a hard-coded password.)
USE caresphere_db;

INSERT IGNORE INTO tbl_roles (role_name) VALUES ('Admin'), ('Staff'), ('Donor');

INSERT IGNORE INTO tbl_settings (setting_key, setting_value) VALUES
  ('org_name',        'CareSphere Child Welfare Home'),
  ('org_address',     ''),
  ('org_contact',     ''),
  ('receipt_footer',  'Thank you for supporting the children in our care.'),
  ('default_min_threshold', '5');
