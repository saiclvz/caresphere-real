// Emergency recovery: turns off two-step verification for one account, for when
// the only administrator has lost both their phone and their backup codes.
// Needs access to this server and its .env, so it can't be used remotely.
// Usage: npm run reset-mfa -- admin@example.com
require('dotenv').config();
const mysql = require('mysql2/promise');

(async () => {
  const email = String(process.argv[2] || '').trim().toLowerCase();
  if (!email) {
    console.error('Usage: npm run reset-mfa -- admin@example.com');
    process.exit(1);
  }
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST, port: Number(process.env.DB_PORT) || 3306,
    user: process.env.DB_USER, password: process.env.DB_PASSWORD || '', database: process.env.DB_NAME,
  });
  try {
    const [[user]] = await conn.query('SELECT user_id FROM tbl_users WHERE email = ?', [email]);
    if (!user) throw new Error(`No account with email ${email}.`);
    await conn.beginTransaction();
    await conn.query(
      `UPDATE tbl_users SET mfa_enabled = FALSE, mfa_secret_enc = NULL, mfa_last_step = NULL, mfa_enrolled_at = NULL,
              tokens_valid_after = NOW() WHERE user_id = ?`, [user.user_id]);
    await conn.query('DELETE FROM tbl_mfa_backup_codes WHERE user_id = ?', [user.user_id]);
    await conn.query('UPDATE tbl_mfa_challenges SET consumed_at = NOW() WHERE user_id = ? AND consumed_at IS NULL', [user.user_id]);
    await conn.query(
      "INSERT INTO tbl_activity_logs (user_id, action_performed, target_entity, ip_address) VALUES (?, 'MFA_RESET (server console)', ?, 'console')",
      [user.user_id, `User #${user.user_id}`]);
    await conn.commit();
    console.log(`[mfa] Two-step verification reset for ${email}. They will set it up again at their next sign-in.`);
  } catch (err) {
    await conn.rollback().catch(() => {});
    console.error(`[mfa] ${err.message}`);
    process.exitCode = 1;
  } finally {
    await conn.end();
  }
})();
