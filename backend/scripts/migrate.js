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
    console.log('[migrate] Database is up to date. Next: npm run create-admin');
  } catch (err) {
    console.error(`\n[migrate] Failed: ${err.message}`);
    process.exitCode = 1;
  } finally {
    await conn.end();
  }
})();
