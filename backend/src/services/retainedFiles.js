/**
 * Uploaded files are never deleted (migration 034). When a single-file field is overwritten (a child's profile
 * photo, the CDCLAA copy) the old file stays on disk and is recorded here: which record it belonged to, whether it
 * was Replaced or Removed, who did it, when and why. Nothing reads these files back for normal users; an Admin can
 * see the history through the audit log entry written with it.
 */
async function retain(conn, req, { area, childId = null, key, originalName = null, mime = null, sha = null, status, replacedByKey = null, reason = null }) {
  if (!key) return null;
  const [r] = await conn.query(
    `INSERT INTO tbl_retained_files (area, child_id, storage_key, original_name, mime_type, sha256, status, replaced_by_key, reason, actor_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [area, childId, key, originalName, mime, sha, status, replacedByKey, reason ? String(reason).slice(0, 500) : null, req.user.user_id]);
  return r.insertId;
}

async function history(conn, { area, childId }) {
  const [rows] = await conn.query(
    `SELECT f.file_id, f.area, f.status, f.original_name, f.reason, f.created_at, u.full_name AS by_name
       FROM tbl_retained_files f JOIN tbl_users u ON u.user_id = f.actor_id
      WHERE f.child_id = ? ${area ? 'AND f.area = ?' : ''} ORDER BY f.created_at DESC, f.file_id DESC`, area ? [childId, area] : [childId]);
  return rows;
}

module.exports = { retain, history };
