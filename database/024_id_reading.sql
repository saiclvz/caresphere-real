-- Migration 024 - ID reading (OCR) results
--
-- One row per uploaded government ID photo that CareSphere tried to read with tesseract.js. Stores the text
-- read from the photo (encrypted), the ID type it looks like, how confident the reading was, and whether
-- the file carries traces of photo-editing software. Used by the ID checks; never treated as proof that
-- an ID is genuine. Safe to run more than once. Rollback: database/rollback/024_id_reading_rollback.sql
USE caresphere_db;

CREATE TABLE IF NOT EXISTS tbl_id_ocr (
    ocr_id        INT AUTO_INCREMENT PRIMARY KEY,
    document_id   INT NOT NULL,
    status        ENUM('read', 'unreadable', 'skipped', 'failed') NOT NULL,
    detail        VARCHAR(255) NULL,               -- why it was skipped or failed (no personal data)
    text_enc      MEDIUMTEXT NULL,                 -- text read from the photo, encrypted
    confidence    TINYINT UNSIGNED NULL,           -- 0-100, from the OCR engine
    detected_type VARCHAR(60) NULL,                -- ID type the text points to, if any
    editing_trace VARCHAR(60) NULL,                -- e.g. 'Adobe Photoshop' found in the file's metadata
    created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_id_ocr_document (document_id, created_at),
    CONSTRAINT fk_id_ocr_document FOREIGN KEY (document_id) REFERENCES tbl_adoption_documents(document_id)
) ENGINE=InnoDB;
