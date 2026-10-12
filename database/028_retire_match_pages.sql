-- Migration 028 - retired documents archived, child matching, page completion
--
-- A. Retired document types (divorce_or_death_certificate, child_abuse_clearance, fingerprint_clearance):
--    files already uploaded are marked archived (not deleted). Archived files are hidden from every screen
--    and API and cannot be viewed or downloaded. Admin can securely dispose of one from Data protection
--    (reason required, logged). The file on disk is removed only by that action or by the reviewed bulk
--    script (backend/scripts/disposeArchivedDocuments.js), never by this migration.
-- B. Matching: the applicant's preferences and "About the child" answers, the child's matching profile and
--    child-document verification, the match records (one active match per child and per applicant, enforced
--    by unique keys), their append-only history, and the link-and-verify record for non-Regular adoptions.
-- C. Page completion: which application pages the server has accepted as complete.
--
-- Safe to run more than once. Rollback: database/rollback/028_retire_match_pages_rollback.sql
USE caresphere_db;

-- ------------------------------------------------------------------ A
ALTER TABLE tbl_adoption_documents
  ADD COLUMN IF NOT EXISTS archived_at    DATETIME NULL,
  ADD COLUMN IF NOT EXISTS archive_reason VARCHAR(200) NULL,
  ADD COLUMN IF NOT EXISTS disposed_at    DATETIME NULL,
  ADD COLUMN IF NOT EXISTS disposed_by    INT NULL,
  ADD COLUMN IF NOT EXISTS dispose_reason VARCHAR(500) NULL,
  ADD INDEX IF NOT EXISTS idx_adoption_docs_archived (archived_at);

UPDATE tbl_adoption_documents
   SET archived_at = NOW(), archive_reason = 'Retired document type (no longer required)'
 WHERE doc_type IN ('divorce_or_death_certificate', 'child_abuse_clearance', 'fingerprint_clearance') AND archived_at IS NULL;

-- ------------------------------------------------------------------ B
-- Applicant answers: "About the child" (non-Regular adoptions) and matching preferences (page 8, optional).
ALTER TABLE tbl_applicant_details
  ADD COLUMN IF NOT EXISTS adoptee_name        VARCHAR(255) NULL COMMENT 'AES-256-GCM ciphertext',
  ADD COLUMN IF NOT EXISTS pref_age_range      VARCHAR(20) NULL,
  ADD COLUMN IF NOT EXISTS pref_special_needs  VARCHAR(40) NULL,
  ADD COLUMN IF NOT EXISTS pref_siblings       VARCHAR(40) NULL,
  ADD COLUMN IF NOT EXISTS pref_space          VARCHAR(40) NULL;

-- The child's matching profile (recorded by the home).
ALTER TABLE tbl_children
  ADD COLUMN IF NOT EXISTS special_needs       ENUM('None', 'Some', 'Significant') NULL,
  ADD COLUMN IF NOT EXISTS sibling_group_size  TINYINT UNSIGNED NULL COMMENT 'siblings to be placed with the child; 0 = none',
  ADD COLUMN IF NOT EXISTS needs_own_room      BOOLEAN NULL;

-- The child's documents needed before matching, each verified by a person (Admin). One row per document.
CREATE TABLE IF NOT EXISTS tbl_child_match_documents (
    child_id     VARCHAR(50) NOT NULL,
    doc_key      VARCHAR(40) NOT NULL,
    verified_at  DATETIME NOT NULL,
    verified_by  INT NOT NULL,
    reference    VARCHAR(120) NULL,
    PRIMARY KEY (child_id, doc_key),
    CONSTRAINT fk_child_match_docs_child FOREIGN KEY (child_id) REFERENCES tbl_children(child_id),
    CONSTRAINT fk_child_match_docs_user FOREIGN KEY (verified_by) REFERENCES tbl_users(user_id)
) ENGINE=InnoDB;

-- Match records. A match is "active" while Proposed, Under review, Approved or NACC confirmed; the two
-- generated keys are NULL otherwise, so the unique keys allow only one active match per child and one per
-- applicant, enforced by the database.
CREATE TABLE IF NOT EXISTS tbl_adoption_matches (
    match_id          INT AUTO_INCREMENT PRIMARY KEY,
    application_id    INT NOT NULL,
    applicant_id      INT NOT NULL,
    child_id          VARCHAR(50) NOT NULL,
    status            ENUM('Proposed', 'Under review', 'Approved', 'NACC confirmed', 'Withdrawn', 'Placed') NOT NULL DEFAULT 'Proposed',
    recommendation    TEXT NOT NULL COMMENT 'AES-256-GCM ciphertext: the best-interest recommendation',
    compatibility     JSON NULL,
    mismatch_reason   TEXT NULL COMMENT 'AES-256-GCM ciphertext',
    proposed_by       INT NOT NULL,
    proposed_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    approved_by       INT NULL,
    approved_at       DATETIME NULL,
    nacc_date         DATE NULL,
    nacc_reference    VARCHAR(120) NULL,
    ended_by          INT NULL,
    ended_at          DATETIME NULL,
    end_reason        TEXT NULL COMMENT 'AES-256-GCM ciphertext',
    active_child      VARCHAR(50) AS (CASE WHEN status IN ('Proposed', 'Under review', 'Approved', 'NACC confirmed') THEN child_id END) STORED,
    active_applicant  INT AS (CASE WHEN status IN ('Proposed', 'Under review', 'Approved', 'NACC confirmed') THEN applicant_id END) STORED,
    UNIQUE KEY uq_match_active_child (active_child),
    UNIQUE KEY uq_match_active_applicant (active_applicant),
    INDEX idx_match_application (application_id),
    CONSTRAINT fk_match_application FOREIGN KEY (application_id) REFERENCES tbl_adoption_applications(application_id),
    CONSTRAINT fk_match_child FOREIGN KEY (child_id) REFERENCES tbl_children(child_id)
) ENGINE=InnoDB;

-- Every step of a match (append-only).
CREATE TABLE IF NOT EXISTS tbl_adoption_match_events (
    event_id     INT AUTO_INCREMENT PRIMARY KEY,
    match_id     INT NOT NULL,
    event        VARCHAR(40) NOT NULL,
    from_status  VARCHAR(20) NULL,
    to_status    VARCHAR(20) NULL,
    actor_id     INT NULL,
    detail       TEXT NULL COMMENT 'AES-256-GCM ciphertext',
    created_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_match_events (match_id),
    CONSTRAINT fk_match_events_match FOREIGN KEY (match_id) REFERENCES tbl_adoption_matches(match_id)
) ENGINE=InnoDB;

-- Non-Regular adoptions: the home links and verifies the child and the relationship.
ALTER TABLE tbl_adoption_applications
  ADD COLUMN IF NOT EXISTS link_child_id     VARCHAR(50) NULL,
  ADD COLUMN IF NOT EXISTS link_verified_at  DATETIME NULL,
  ADD COLUMN IF NOT EXISTS link_verified_by  INT NULL,
  ADD COLUMN IF NOT EXISTS link_note         TEXT NULL COMMENT 'AES-256-GCM ciphertext';

-- ------------------------------------------------------------------ C
-- Pages the server accepted as complete, e.g. "1,2,3". Recalculated on every save.
ALTER TABLE tbl_adoption_applications
  ADD COLUMN IF NOT EXISTS completed_pages VARCHAR(40) NULL;
