-- Review only (not run by npm run migrate: it is in database/review). Lists archived documents (retired
-- document types) that still have a file on disk, oldest first, with no personal data.
-- To dispose of them, use Data protection > Archived documents (one at a time), or the bulk script:
--   node scripts/disposeArchivedDocuments.js                       (dry run: lists what would be disposed)
--   node scripts/disposeArchivedDocuments.js --confirm --reason "..."
-- Do not delete these rows with SQL: the rows record that each file existed and when it was disposed of.
USE caresphere_db;

SELECT d.document_id, a.reference_no, d.doc_type, d.uploaded_at, d.archived_at
  FROM tbl_adoption_documents d JOIN tbl_adoption_applications a ON a.application_id = d.application_id
 WHERE d.archived_at IS NOT NULL AND d.disposed_at IS NULL
 ORDER BY d.uploaded_at;

SELECT COUNT(*) AS already_disposed FROM tbl_adoption_documents WHERE disposed_at IS NOT NULL;
