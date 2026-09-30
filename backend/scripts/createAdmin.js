// Creates the first administrator interactively. No default passwords exist.
require('dotenv').config();
const readline = require('readline');
const bcrypt = require('bcryptjs');
const mysql = require('mysql2/promise');

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const ask = (q) => new Promise((resolve) => rl.question(q, (a) => resolve(a.trim())));

(async () => {
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST, port: Number(process.env.DB_PORT) || 3306,
    user: process.env.DB_USER, password: process.env.DB_PASSWORD || '', database: process.env.DB_NAME,
  });
  try {
    const fullName = await ask('Administrator full name: ');
    const email = (await ask('Administrator email: ')).toLowerCase();
    const password = await ask('Password (min 8 characters): ');
    if (fullName.length < 2 || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) || password.length < 8) {
      throw new Error('Invalid input. Name >= 2 chars, valid email, password >= 8 chars.');
    }
    const [[role]] = await conn.query("SELECT role_id FROM tbl_roles WHERE role_name = 'Admin'");
    if (!role) throw new Error('Roles are missing. Run `npm run migrate` first.');
    const hash = await bcrypt.hash(password, Number(process.env.BCRYPT_ROUNDS) || 12);
    const [res] = await conn.query(
      'INSERT INTO tbl_users (full_name, email, password_hash, role_id) VALUES (?, ?, ?, ?)',
      [fullName, email, hash, role.role_id]);
    console.log(`[admin] Created administrator #${res.insertId} (${email}).`);
  } catch (err) {
    console.error(`[admin] ${err.code === 'ER_DUP_ENTRY' ? 'That email is already registered.' : err.message}`);
    process.exitCode = 1;
  } finally {
    rl.close();
    await conn.end();
  }
})();
