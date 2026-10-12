-- Migration 030 - Transition Review (18+) in 9 stages
--
-- Adds only transition-specific records. Children, users, the discharge history, notifications and the audit
-- log are the existing tables; every record here points to an existing review (and through it the existing
-- child) by its key. Nothing is copied from the child record.
-- * tbl_transition_reviews: proposed pathway, target transition date, next review date, closure fields.
-- * tbl_transition_assessments (+ _items): readiness assessment, one per review; ratings per item, notes per
--   category (encrypted), overall readiness. Every saved version is kept in tbl_transition_record_versions.
-- * tbl_transition_child_voice: the young person's own answers (encrypted).
-- * tbl_transition_conferences (+ _participants): case conferences and scheduled follow-ups.
-- * tbl_transition_decisions: formal decisions, append-only (the latest one counts).
-- * tbl_transition_plans / tbl_transition_tasks: the plan created on approval, and its tasks.
-- * tbl_transition_preparation: the pre-transition checklist.
-- * tbl_transition_discharges: the transition / placement, linked to the existing discharge history row.
-- * tbl_aftercare_plans / tbl_aftercare_visits: aftercare created at discharge, and the follow-ups.
-- * tbl_transition_documents: uploaded files (encrypted on disk, as other uploads).
-- * tbl_transition_events: the review timeline with previous and new values (append-only).
-- No existing data is changed or deleted. Safe to run more than once.
-- Rollback: database/rollback/030_transition_workflow_rollback.sql
USE caresphere_db;

ALTER TABLE tbl_transition_reviews
  ADD COLUMN IF NOT EXISTS proposed_pathway       VARCHAR(60) NULL,
  ADD COLUMN IF NOT EXISTS target_transition_date DATE NULL,
  ADD COLUMN IF NOT EXISTS next_review_date       DATE NULL,
  ADD COLUMN IF NOT EXISTS assessment_started_at  DATETIME NULL,
  ADD COLUMN IF NOT EXISTS final_outcome          VARCHAR(80) NULL,
  ADD COLUMN IF NOT EXISTS final_assessment_enc   TEXT NULL COMMENT 'AES-256-GCM ciphertext',
  ADD COLUMN IF NOT EXISTS closure_date           DATE NULL,
  ADD COLUMN IF NOT EXISTS closure_notes_enc      TEXT NULL COMMENT 'AES-256-GCM ciphertext',
  ADD COLUMN IF NOT EXISTS closed_at              DATETIME NULL,
  ADD COLUMN IF NOT EXISTS closed_by              INT NULL;
ALTER TABLE tbl_transition_reviews
  ADD CONSTRAINT fk_transition_closed_by FOREIGN KEY IF NOT EXISTS (closed_by) REFERENCES tbl_users(user_id);

CREATE TABLE IF NOT EXISTS tbl_transition_assessments (
    assessment_id      INT AUTO_INCREMENT PRIMARY KEY,
    review_id          INT NOT NULL UNIQUE,
    overall_readiness  ENUM('Ready for Transition', 'Ready with Conditions', 'Not Yet Ready', 'Further Assessment Required') NULL,
    category_notes_enc MEDIUMTEXT NULL COMMENT 'AES-256-GCM ciphertext (JSON: notes per category)',
    completed_at       DATETIME NULL,
    updated_by         INT NOT NULL,
    created_at         DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at         DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT fk_tassess_review FOREIGN KEY (review_id) REFERENCES tbl_transition_reviews(review_id),
    CONSTRAINT fk_tassess_user FOREIGN KEY (updated_by) REFERENCES tbl_users(user_id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS tbl_transition_assessment_items (
    item_id        INT AUTO_INCREMENT PRIMARY KEY,
    assessment_id  INT NOT NULL,
    category_key   VARCHAR(20) NOT NULL,
    item_key       VARCHAR(40) NOT NULL,
    rating         ENUM('Not Assessed', 'Needs Improvement', 'Partially Ready', 'Ready') NOT NULL DEFAULT 'Not Assessed',
    UNIQUE KEY uq_tassess_item (assessment_id, item_key),
    CONSTRAINT fk_titem_assessment FOREIGN KEY (assessment_id) REFERENCES tbl_transition_assessments(assessment_id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS tbl_transition_child_voice (
    review_id      INT PRIMARY KEY,
    answers_enc    MEDIUMTEXT NOT NULL COMMENT 'AES-256-GCM ciphertext (JSON: the young person''s answers)',
    declined       BOOLEAN NOT NULL DEFAULT FALSE,
    recorded_by    INT NOT NULL,
    recorded_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT fk_tvoice_review FOREIGN KEY (review_id) REFERENCES tbl_transition_reviews(review_id),
    CONSTRAINT fk_tvoice_user FOREIGN KEY (recorded_by) REFERENCES tbl_users(user_id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS tbl_transition_conferences (
    conference_id    INT AUTO_INCREMENT PRIMARY KEY,
    review_id        INT NOT NULL,
    status           ENUM('Scheduled', 'Held') NOT NULL DEFAULT 'Held',
    conference_date  DATE NOT NULL,
    location         VARCHAR(150) NULL,
    meeting_type     VARCHAR(30) NULL,
    facilitator      VARCHAR(150) NULL,
    recommendation   ENUM('Proceed to Transition Planning', 'Transition with Conditions', 'Continue Preparation', 'Further Assessment Required') NULL,
    data_enc         MEDIUMTEXT NULL COMMENT 'AES-256-GCM ciphertext (JSON: summary, strengths, concerns, notes)',
    follow_up_of     INT NULL,
    created_by       INT NOT NULL,
    created_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_tconf_review (review_id),
    CONSTRAINT fk_tconf_review FOREIGN KEY (review_id) REFERENCES tbl_transition_reviews(review_id),
    CONSTRAINT fk_tconf_follow FOREIGN KEY (follow_up_of) REFERENCES tbl_transition_conferences(conference_id),
    CONSTRAINT fk_tconf_user FOREIGN KEY (created_by) REFERENCES tbl_users(user_id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS tbl_transition_conference_participants (
    participant_id INT AUTO_INCREMENT PRIMARY KEY,
    conference_id  INT NOT NULL,
    role           VARCHAR(60) NOT NULL,
    name_enc       TEXT NOT NULL COMMENT 'AES-256-GCM ciphertext',
    user_id        INT NULL,
    superseded_at  DATETIME NULL COMMENT 'set when the conference was edited; the row is kept',
    INDEX idx_tpart_conf (conference_id),
    CONSTRAINT fk_tpart_conf FOREIGN KEY (conference_id) REFERENCES tbl_transition_conferences(conference_id),
    CONSTRAINT fk_tpart_user FOREIGN KEY (user_id) REFERENCES tbl_users(user_id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS tbl_transition_decisions (
    decision_id      INT AUTO_INCREMENT PRIMARY KEY,
    review_id        INT NOT NULL,
    pathway          VARCHAR(60) NOT NULL,
    decision         ENUM('Approved', 'Approved with Conditions', 'Deferred', 'Continue Residential Care') NOT NULL,
    decision_date    DATE NOT NULL,
    decision_maker   INT NOT NULL,
    conditions_enc   TEXT NULL COMMENT 'AES-256-GCM ciphertext',
    justification_enc TEXT NOT NULL COMMENT 'AES-256-GCM ciphertext',
    next_review_date DATE NULL,
    created_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_tdec_review (review_id),
    CONSTRAINT fk_tdec_review FOREIGN KEY (review_id) REFERENCES tbl_transition_reviews(review_id),
    CONSTRAINT fk_tdec_user FOREIGN KEY (decision_maker) REFERENCES tbl_users(user_id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS tbl_transition_plans (
    plan_id      INT AUTO_INCREMENT PRIMARY KEY,
    review_id    INT NOT NULL UNIQUE,
    decision_id  INT NOT NULL,
    created_by   INT NOT NULL,
    created_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_tplan_review FOREIGN KEY (review_id) REFERENCES tbl_transition_reviews(review_id),
    CONSTRAINT fk_tplan_decision FOREIGN KEY (decision_id) REFERENCES tbl_transition_decisions(decision_id),
    CONSTRAINT fk_tplan_user FOREIGN KEY (created_by) REFERENCES tbl_users(user_id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS tbl_transition_tasks (
    task_id        INT AUTO_INCREMENT PRIMARY KEY,
    plan_id        INT NOT NULL,
    task_key       VARCHAR(40) NULL COMMENT 'standard task; NULL for a custom task',
    name           VARCHAR(150) NOT NULL,
    description    VARCHAR(500) NULL,
    assigned_to    INT NULL COMMENT 'a staff account, or',
    assigned_name  VARCHAR(150) NULL COMMENT 'another person (free text)',
    due_date       DATE NULL,
    priority       ENUM('Low', 'Medium', 'High') NOT NULL DEFAULT 'Medium',
    status         ENUM('Pending', 'In Progress', 'Completed', 'Not Applicable') NOT NULL DEFAULT 'Pending',
    notes_enc      TEXT NULL COMMENT 'AES-256-GCM ciphertext',
    updated_by     INT NULL,
    created_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uq_ttask_key (plan_id, task_key),
    CONSTRAINT fk_ttask_plan FOREIGN KEY (plan_id) REFERENCES tbl_transition_plans(plan_id),
    CONSTRAINT fk_ttask_assignee FOREIGN KEY (assigned_to) REFERENCES tbl_users(user_id),
    CONSTRAINT fk_ttask_user FOREIGN KEY (updated_by) REFERENCES tbl_users(user_id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS tbl_transition_preparation (
    review_id    INT NOT NULL,
    item_key     VARCHAR(40) NOT NULL,
    status       ENUM('Done', 'Not Applicable', 'Not Done') NOT NULL COMMENT 'Not Done: ticked, then undone (the row is kept)',
    note_enc     TEXT NULL COMMENT 'AES-256-GCM ciphertext',
    done_by      INT NOT NULL,
    done_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (review_id, item_key),
    CONSTRAINT fk_tprep_review FOREIGN KEY (review_id) REFERENCES tbl_transition_reviews(review_id),
    CONSTRAINT fk_tprep_user FOREIGN KEY (done_by) REFERENCES tbl_users(user_id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS tbl_transition_discharges (
    review_id            INT PRIMARY KEY,
    transition_date      DATE NOT NULL,
    destination_type     VARCHAR(40) NOT NULL,
    data_enc             MEDIUMTEXT NOT NULL COMMENT 'AES-256-GCM ciphertext (JSON: name, address, receiving person, contact, reason, notes)',
    discharge_history_id INT NULL COMMENT 'the row in the existing discharge history',
    recorded_by          INT NOT NULL,
    recorded_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_tdis_review FOREIGN KEY (review_id) REFERENCES tbl_transition_reviews(review_id),
    CONSTRAINT fk_tdis_history FOREIGN KEY (discharge_history_id) REFERENCES tbl_child_discharge_history(discharge_id),
    CONSTRAINT fk_tdis_user FOREIGN KEY (recorded_by) REFERENCES tbl_users(user_id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS tbl_aftercare_plans (
    aftercare_id  INT AUTO_INCREMENT PRIMARY KEY,
    review_id     INT NOT NULL UNIQUE,
    status        ENUM('Active', 'Completed') NOT NULL DEFAULT 'Active',
    created_by    INT NOT NULL,
    created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_aplan_review FOREIGN KEY (review_id) REFERENCES tbl_transition_reviews(review_id),
    CONSTRAINT fk_aplan_user FOREIGN KEY (created_by) REFERENCES tbl_users(user_id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS tbl_aftercare_visits (
    visit_id        INT AUTO_INCREMENT PRIMARY KEY,
    aftercare_id    INT NOT NULL,
    round_label     ENUM('Week 1', 'Month 1', 'Month 3', 'Month 6', 'Custom') NOT NULL,
    scheduled_date  DATE NULL,
    visit_date      DATE NULL COMMENT 'NULL while only scheduled',
    contact_type    VARCHAR(30) NULL,
    data_enc        MEDIUMTEXT NULL COMMENT 'AES-256-GCM ciphertext (JSON: the follow-up answers)',
    recorded_by     INT NULL,
    recorded_at     DATETIME NULL,
    created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_avisit_plan (aftercare_id),
    CONSTRAINT fk_avisit_plan FOREIGN KEY (aftercare_id) REFERENCES tbl_aftercare_plans(aftercare_id),
    CONSTRAINT fk_avisit_user FOREIGN KEY (recorded_by) REFERENCES tbl_users(user_id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS tbl_transition_documents (
    document_id    INT AUTO_INCREMENT PRIMARY KEY,
    review_id      INT NOT NULL,
    stage_key      VARCHAR(20) NOT NULL,
    conference_id  INT NULL,
    visit_id       INT NULL,
    label          VARCHAR(150) NOT NULL,
    original_name  VARCHAR(200) NOT NULL,
    mime_type      VARCHAR(50) NOT NULL,
    size_bytes     INT NOT NULL,
    storage_key    VARCHAR(255) NOT NULL,
    sha256         CHAR(64) NULL,
    uploaded_by    INT NOT NULL,
    uploaded_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_tdoc_review (review_id),
    CONSTRAINT fk_tdoc_review FOREIGN KEY (review_id) REFERENCES tbl_transition_reviews(review_id),
    CONSTRAINT fk_tdoc_conf FOREIGN KEY (conference_id) REFERENCES tbl_transition_conferences(conference_id),
    CONSTRAINT fk_tdoc_visit FOREIGN KEY (visit_id) REFERENCES tbl_aftercare_visits(visit_id),
    CONSTRAINT fk_tdoc_user FOREIGN KEY (uploaded_by) REFERENCES tbl_users(user_id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS tbl_transition_record_versions (
    version_id   INT AUTO_INCREMENT PRIMARY KEY,
    review_id    INT NOT NULL,
    record_kind  VARCHAR(30) NOT NULL,
    record_ref   INT NULL,
    data_enc     MEDIUMTEXT NOT NULL COMMENT 'AES-256-GCM ciphertext (JSON snapshot)',
    saved_by     INT NOT NULL,
    saved_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_tver_review (review_id, record_kind),
    CONSTRAINT fk_tver_review FOREIGN KEY (review_id) REFERENCES tbl_transition_reviews(review_id),
    CONSTRAINT fk_tver_user FOREIGN KEY (saved_by) REFERENCES tbl_users(user_id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS tbl_transition_events (
    event_id    INT AUTO_INCREMENT PRIMARY KEY,
    review_id   INT NOT NULL,
    stage_key   VARCHAR(20) NOT NULL,
    action      VARCHAR(40) NOT NULL,
    summary     VARCHAR(255) NOT NULL COMMENT 'no names or case details: statuses and labels only',
    from_value  VARCHAR(100) NULL,
    to_value    VARCHAR(100) NULL,
    actor_id    INT NULL,
    created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_tevent_review (review_id, created_at),
    CONSTRAINT fk_tevent_review FOREIGN KEY (review_id) REFERENCES tbl_transition_reviews(review_id),
    CONSTRAINT fk_tevent_user FOREIGN KEY (actor_id) REFERENCES tbl_users(user_id)
) ENGINE=InnoDB;
