require('dotenv').config();

const REQUIRED = [
  'DB_HOST', 'DB_USER', 'DB_NAME', 'JWT_SECRET',
  'PHI_ENCRYPTION_KEY', 'QR_ENCRYPTION_KEY', 'RECEIPT_SIGNING_KEY',
];

const missing = REQUIRED.filter((k) => !process.env[k]);
if (missing.length) {
  console.error(`[config] Missing required environment variables: ${missing.join(', ')}`);
  console.error('[config] Copy .env.example to .env and run `npm run gen-keys`.');
  process.exit(1);
}

function hexKey(name) {
  const value = process.env[name];
  if (!/^[0-9a-fA-F]{64}$/.test(value)) {
    console.error(`[config] ${name} must be 64 hex characters (32 bytes). Run \`npm run gen-keys\`.`);
    process.exit(1);
  }
  return Buffer.from(value, 'hex');
}

if (process.env.JWT_SECRET.length < 32) {
  console.error('[config] JWT_SECRET must be at least 32 characters.');
  process.exit(1);
}

module.exports = {
  port: Number(process.env.PORT) || 5000,
  nodeEnv: process.env.NODE_ENV || 'production',
  corsOrigins: (process.env.CORS_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean),
  db: {
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT) || 3306,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME,
  },
  jwtSecret: process.env.JWT_SECRET,
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '8h',
  phiKey: hexKey('PHI_ENCRYPTION_KEY'),
  qrKey: hexKey('QR_ENCRYPTION_KEY'),
  receiptKey: hexKey('RECEIPT_SIGNING_KEY'),
  bcryptRounds: Number(process.env.BCRYPT_ROUNDS) || 12,
  // Typed tokens (Token ID read from the phone) must be entered within 60 s.
  qrTtlSeconds: 60,
  // Elevated access to health records and case files lasts 180 s.
  healthAccessTtlSeconds: 180,
  // Eligibility rule: children older than this cannot be newly registered.
  maxAdmissionAge: 17,
  // Adults (18+) are flagged for Transition Review, never auto-discharged.
  transitionAge: 18,
  uploadDir: require('path').join(__dirname, '..', '..', 'uploads'),
};
