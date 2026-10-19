/**
 * Bulk secure disposal of ARCHIVED documents (retired document types; see migration 028). Review first:
 * run without options for a dry run that only lists what would be disposed. Nothing is changed unless you
 * pass --confirm and a --reason. Each file is overwritten with random bytes and removed; its row is kept
 * and marked disposed (who: --admin-email, when, why), and each disposal is written to the activity log.
 * Only rows with archived_at set can be touched. Never run automatically.
 *
 *   node scripts/disposeArchivedDocuments.js
 *   node scripts/disposeArchivedDocuments.js --confirm --reason "Retired type; not needed (RA 10173 data minimization)" --admin-email admin@example.com [--older-than-days 30]
 */
require('dotenv').config();
const mysql = require('mysql2/promise');

const arg = (name) => { const i = process.argv.indexOf(`--${name}`); return i === -1 ? null : (process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : true); };

(async () => {
  const confirm = arg('confirm') === true;
  const reason = typeof arg('reason') === 'string' ? arg('reason').trim() : '';
  const email = typeof arg('admin-email') === 'string' ? arg('admin-email').trim() : '';
  const days = Number(arg('older-than-days')) || 0;
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST || '127.0.0.1', port: Number(process.env.DB_PORT) || 3306, user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '', database: process.env.DB_NAME || 'caresphere_db',
  });
  try {
    const [rows] = await conn.query(
      `SELECT d.document_id, a.reference_no, d.doc_type, d.uploaded_at, d.storage_key FROM tbl_adoption_documents d
         JOIN tbl_adoption_applications a ON a.application_id = d.application_id
        WHERE d.archived_at IS NOT NULL AND d.disposed_at IS NULL AND d.archived_at <= NOW() - INTERVAL ? DAY
          AND d.doc_type IN ('divorce_or_death_certificate', 'child_abuse_clearance', 'fingerprint_clearance')
        ORDER BY d.uploaded_at`, [days]); // retired types only (028); removed or replaced copies are kept
    console.log(`${rows.length} archived document(s) not yet disposed of${days ? ` (archived at least ${days} days ago)` : ''}:`);
    rows.forEach((r) => console.log(`  #${r.document_id}  ${r.reference_no || 'Draft'}  ${r.doc_type}  uploaded ${new Date(r.uploaded_at).toISOString().slice(0, 10)}`));
    if (!confirm) { console.log('\nDry run: nothing was changed. Add --confirm --reason "..." --admin-email ... to dispose of these.'); return; }
    if (reason.length < 10) throw new Error('Give --reason with at least 10 characters.');
    const [[admin]] = await conn.query("SELECT u.user_id FROM tbl_users u JOIN tbl_roles r ON r.role_id = u.role_id WHERE u.email = ? AND r.role_name = 'Admin' AND u.is_active = TRUE", [email]);
    if (!admin) throw new Error('Give --admin-email of an active Admin account (recorded as the person who disposed of the files).');
    const { secureDeleteUpload } = require('../src/utils/files');
    let done = 0;
    for (const r of rows) {
      await conn.beginTransaction();
      try {
        const [u] = await conn.query('UPDATE tbl_adoption_documents SET disposed_at = NOW(), disposed_by = ?, dispose_reason = ? WHERE document_id = ? AND archived_at IS NOT NULL AND disposed_at IS NULL',
          [admin.user_id, reason.slice(0, 500), r.document_id]);
        if (!u.affectedRows) { await conn.rollback(); continue; }
        await conn.query("INSERT INTO tbl_activity_logs (user_id, user_role, action_performed, target_entity, ip_address, device_type) VALUES (?, 'Admin', ?, 'Data protection', NULL, NULL)",
          [admin.user_id, `ARCHIVED_DOCUMENT_DISPOSED (#${r.document_id}; bulk script)`]);
        await conn.commit();
        // The file is removed only after the row and the log entry are saved.
        secureDeleteUpload(r.storage_key);
        done += 1;
      } catch (err) { await conn.rollback(); console.error(`  #${r.document_id}: ${err.message}`); }
    }
    console.log(`\nDisposed of ${done} file(s).`);
  } catch (err) {
    console.error(`[dispose] ${err.message}`);
    process.exitCode = 1;
  } finally { await conn.end(); }
})();
