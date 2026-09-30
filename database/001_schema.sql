-- =====================================================================
-- CareSphere: QR Code Integrated Web Based Dashboard System for
-- Child Registry and Welfare Home Operations Management
-- Migration 001 - Core schema (MySQL 8 / MariaDB 10.4+ via XAMPP)
-- =====================================================================
CREATE DATABASE IF NOT EXISTS caresphere_db
  CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE caresphere_db;

SET FOREIGN_KEY_CHECKS = 0;

-- ---------------------------------------------------------------------
-- tbl_roles
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS tbl_roles (
    role_id   INT AUTO_INCREMENT PRIMARY KEY,
    role_name VARCHAR(50) NOT NULL UNIQUE
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------
-- tbl_users
-- (added: is_active so accounts can be disabled without deleting the
--  audit trail that references them)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS tbl_users (
    user_id       INT AUTO_INCREMENT PRIMARY KEY,
    full_name     VARCHAR(100) NOT NULL,
    email         VARCHAR(100) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    role_id       INT NOT NULL,
    is_active     BOOLEAN NOT NULL DEFAULT TRUE,
    created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (role_id) REFERENCES tbl_roles(role_id)
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------
-- tbl_children
-- qr_token stores the SHA-256 hash of the most recently issued
-- 180-second QR token. The raw token is never persisted.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS tbl_children (
    child_id      VARCHAR(50) PRIMARY KEY,
    first_name    VARCHAR(50) NOT NULL,
    last_name     VARCHAR(50) NOT NULL,
    gender        ENUM('Male', 'Female') NOT NULL,
    dob           DATE NOT NULL,
    status        ENUM('Active', 'Discharged') DEFAULT 'Active',
    urgent_needs  TEXT NULL,
    qr_token      VARCHAR(255) NOT NULL,
    qr_created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------
-- tbl_health_history (Protected Health Information - PHI)
-- Every PHI column holds AES-256-GCM ciphertext ("iv.tag.ciphertext").
-- blood_type widened from VARCHAR(10) to VARCHAR(255) to fit ciphertext.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS tbl_health_history (
    health_id       INT AUTO_INCREMENT PRIMARY KEY,
    child_id        VARCHAR(50) NOT NULL UNIQUE,
    blood_type      VARCHAR(255),
    allergies       TEXT,
    vaccinations    TEXT,
    prescriptions   TEXT,
    doctor_notes    TEXT,
    last_updated_by INT,
    updated_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (child_id) REFERENCES tbl_children(child_id) ON DELETE CASCADE,
    FOREIGN KEY (last_updated_by) REFERENCES tbl_users(user_id)
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------
-- tbl_inventory
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS tbl_inventory (
    item_id             INT AUTO_INCREMENT PRIMARY KEY,
    item_name           VARCHAR(100) NOT NULL,
    category            VARCHAR(50) NOT NULL,
    quantity            INT NOT NULL DEFAULT 0,
    min_threshold       INT NOT NULL DEFAULT 5,
    is_restricted       BOOLEAN DEFAULT FALSE,
    is_needed_by_donors BOOLEAN DEFAULT FALSE,
    last_updated_by     INT,
    updated_at          TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (last_updated_by) REFERENCES tbl_users(user_id)
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------
-- tbl_donations
-- qr_receipt_code is HMAC-signed so receipts can be verified offline.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS tbl_donations (
    donation_id      INT AUTO_INCREMENT PRIMARY KEY,
    donor_id         INT NOT NULL,
    donor_name       VARCHAR(100) NOT NULL,
    amount           DECIMAL(10,2) NOT NULL,
    payment_method   VARCHAR(50) NOT NULL,
    allocation_notes TEXT NULL,
    qr_receipt_code  VARCHAR(255) UNIQUE,
    created_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (donor_id) REFERENCES tbl_users(user_id)
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------
-- tbl_visitors
-- (added: check_out_time so a visit can be closed by scanning the pass)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS tbl_visitors (
    visitor_id     INT AUTO_INCREMENT PRIMARY KEY,
    visitor_name   VARCHAR(100) NOT NULL,
    purpose        TEXT NOT NULL,
    check_in_time  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    check_out_time TIMESTAMP NULL DEFAULT NULL,
    qr_pass_code   VARCHAR(255) UNIQUE
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------
-- tbl_meals
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS tbl_meals (
    meal_id          INT AUTO_INCREMENT PRIMARY KEY,
    meal_type        ENUM('Breakfast', 'Lunch', 'Dinner', 'Snack') NOT NULL,
    menu_description TEXT NOT NULL,
    scheduled_date   DATE NOT NULL,
    logged_by        INT,
    FOREIGN KEY (logged_by) REFERENCES tbl_users(user_id)
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------
-- tbl_activity_logs (Audit Trail)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS tbl_activity_logs (
    log_id           INT AUTO_INCREMENT PRIMARY KEY,
    user_id          INT NOT NULL,
    action_performed VARCHAR(255) NOT NULL,
    target_entity    VARCHAR(100) NOT NULL,
    ip_address       VARCHAR(45),
    timestamp        TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES tbl_users(user_id),
    INDEX idx_logs_timestamp (timestamp),
    INDEX idx_logs_entity (target_entity)
) ENGINE=InnoDB;

-- =====================================================================
-- Supporting tables required by the specified modules
-- =====================================================================

-- Staff schedules module (Admin: "Staff schedules", Staff: "My schedule")
CREATE TABLE IF NOT EXISTS tbl_staff_schedules (
    schedule_id INT AUTO_INCREMENT PRIMARY KEY,
    user_id     INT NOT NULL,
    shift_date  DATE NOT NULL,
    start_time  TIME NOT NULL,
    end_time    TIME NOT NULL,
    assignment  VARCHAR(150) NOT NULL,
    created_by  INT,
    created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES tbl_users(user_id) ON DELETE CASCADE,
    FOREIGN KEY (created_by) REFERENCES tbl_users(user_id),
    INDEX idx_sched_date (shift_date)
) ENGINE=InnoDB;

-- Every QR token issued (children PHI + restricted inventory).
-- Lets the server reject forged/replayed tokens and revoke early.
CREATE TABLE IF NOT EXISTS tbl_qr_sessions (
    session_id INT AUTO_INCREMENT PRIMARY KEY,
    token_hash CHAR(64) NOT NULL UNIQUE,
    scope      ENUM('child', 'inventory') NOT NULL,
    target_id  VARCHAR(50) NOT NULL,
    issued_by  INT NOT NULL,
    issued_at  DATETIME NOT NULL,
    expires_at DATETIME NOT NULL,
    revoked    BOOLEAN NOT NULL DEFAULT FALSE,
    FOREIGN KEY (issued_by) REFERENCES tbl_users(user_id),
    INDEX idx_qr_expires (expires_at)
) ENGINE=InnoDB;

-- JWT denylist so POST /api/auth/logout actually ends the session.
CREATE TABLE IF NOT EXISTS tbl_revoked_tokens (
    jti        CHAR(36) PRIMARY KEY,
    expires_at DATETIME NOT NULL,
    INDEX idx_revoked_expires (expires_at)
) ENGINE=InnoDB;

-- System settings (Admin > Settings)
CREATE TABLE IF NOT EXISTS tbl_settings (
    setting_key   VARCHAR(100) PRIMARY KEY,
    setting_value TEXT NOT NULL,
    updated_by    INT NULL,
    updated_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (updated_by) REFERENCES tbl_users(user_id)
) ENGINE=InnoDB;

SET FOREIGN_KEY_CHECKS = 1;
