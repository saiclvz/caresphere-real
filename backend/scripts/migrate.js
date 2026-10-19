// Runs every .sql file in /database in filename order.
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');

(async () => {
  const dir = path.join(__dirname, '..', '..', 'database');
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST || '127.0.0.1',
    port: Number(process.env.DB_PORT) || 3306,
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    multipleStatements: true,
  });
  try {
    for (const file of files) {
      process.stdout.write(`[migrate] ${file} ... `);
      await conn.query(fs.readFileSync(path.join(dir, file), 'utf8'));
      console.log('done');
    }
    // Encrypt sensitive adoption fields still stored as plain text (safe to repeat).
    await conn.query(`USE \`${process.env.DB_NAME || 'caresphere_db'}\``);
    process.stdout.write('[migrate] encrypting sensitive adoption fields ... ');
    console.log(`${await require('./encryptAdoptionData').run(conn)} row(s) updated`);
    process.stdout.write('[migrate] adding QR references to applications and children ... ');
    console.log(`${await require('../src/utils/publicRef').backfill(conn)} added`);
    // Legacy online payments (migration 037): the mapping is a reviewable step the home runs itself.
    const [[legacy]] = await conn.query('SELECT COUNT(*) AS n FROM tbl_payments p WHERE NOT EXISTS (SELECT 1 FROM tbl_legacy_payment_map m WHERE m.payment_id = p.payment_id)');
    if (Number(legacy.n)) console.log(`[migrate] ${legacy.n} legacy payment record(s) are not mapped yet. Review them: node scripts/mapLegacyPayments.js (then --apply).`);
    console.log('[migrate] Database is up to date. Next: npm run create-admin');
  } catch (err) {
    console.error(`\n[migrate] Failed: ${err.message}`);
    process.exitCode = 1;
  } finally {
    await conn.end();
  }
})();
