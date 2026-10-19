const path = require('path');
const fs = require('fs');
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');

const env = require('./src/config/env');
const { verifyConnection, pool } = require('./src/config/db');
const routes = require('./src/routes');
const { notFound, errorHandler } = require('./src/middleware/errorHandler');
const { purgeExpired } = require('./src/services/qrService');
const mfa = require('./src/services/mfaService');
const protectedRecords = require('./src/services/protectedRecords');
const healthAccess = require('./src/services/healthAccessService');
const { syncFlags } = require('./src/controllers/childController');
const idScan = require('./src/services/idScan');

const app = express();
app.disable('x-powered-by');

app.use(helmet({
  crossOriginResourcePolicy: { policy: 'same-site' },
  contentSecurityPolicy: {
    useDefaults: true,
    directives: {
      'img-src': ["'self'", 'data:', 'blob:'],
      'media-src': ["'self'", 'blob:'],
      'upgrade-insecure-requests': null, // LAN deployments are often plain HTTP
      'frame-ancestors': ["'none'"],
      'form-action': ["'self'"],
    },
  },
  referrerPolicy: { policy: 'no-referrer' },
  // HSTS only matters over HTTPS; browsers ignore it on plain HTTP.
  hsts: { maxAge: 15552000, includeSubDomains: false },
}));
app.use((req, res, next) => { res.set('Permissions-Policy', 'camera=(self), microphone=(), geolocation=(), payment=()'); next(); });

app.use(cors({
  origin(origin, cb) {
    // Same-origin requests and tools like curl send no Origin header.
    if (!origin || env.corsOrigins.includes(origin)) return cb(null, true);
    return cb(new Error(`Origin ${origin} is not allowed. Add it to CORS_ORIGINS in .env.`));
  },
  // Cookies are sent only to the allowed origins (credentials), and changes must carry X-CSRF-Token.
  credentials: true,
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Health-Access', 'X-Unlock-Session', 'X-Protected-Access', 'X-Background', 'Idempotency-Key', 'X-CSRF-Token', 'X-Reauth'],
  exposedHeaders: ['Content-Disposition'],
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
}));

// Uploads (child photos up to 5 MB, adoption documents up to 10 MB) arrive as
// base64 JSON, about 4/3 of the file size. Only those routes get the larger limit.
const UPLOAD_ROUTES = [/^\/api\/children$/, /^\/api\/children\/[^/]+\/photo$/, /^\/api\/adoptions\/\d+\/documents$/, /^\/api\/donor\/donation-reports(\/\d+\/info)?$/,
  /^\/api\/payment-qr\/(preview|changes)$/, /^\/api\/donations\/\d+\/documents$/];

const jsonLarge = express.json({ limit: '15mb' });
const jsonSmall = express.json({ limit: '1mb' });
app.use((req, res, next) => (UPLOAD_ROUTES.some((r) => r.test(req.path)) ? jsonLarge : jsonSmall)(req, res, next));

// API responses can hold personal data: never cache them in the browser or shared caches.
app.use('/api', (req, res, next) => { res.set('Cache-Control', 'no-store'); res.set('Pragma', 'no-cache'); next(); });
app.use('/api', routes);
app.use('/api', notFound);

// Serve the production React build from the same LAN server when present.
const dist = path.join(__dirname, '..', 'frontend', 'dist');
if (fs.existsSync(dist)) {
  app.use(express.static(dist, { index: false, maxAge: '1h' }));
  app.get('*', (req, res) => res.sendFile(path.join(dist, 'index.html')));
}

app.use(errorHandler);

async function start() {
  try {
    await verifyConnection();
    console.log(`[db] Connected to MySQL ${env.db.host}:${env.db.port}/${env.db.database}`);
  } catch (err) {
    console.error('[db] Cannot connect to MySQL. Is XAMPP MySQL running and have you run `npm run migrate`?');
    console.error(`[db] ${err.message}`);
    process.exit(1);
  }

  // Load the ID type rules once so form validation uses the Admin-edited number formats from the start.
  require('./src/services/idTypes').all().catch(() => {});

  // Housekeeping: drop expired QR sessions and JWT denylist entries hourly.
  const cleanup = () => Promise.all([purgeExpired(), healthAccess.purgeExpired(), mfa.purgeExpired(), protectedRecords.cleanupGrants(), require('./src/services/donationClaims').staleSweep(), require('./src/services/reauth').purgeOld(), idScan.purgeOld(),
    pool.query('DELETE FROM tbl_session_activity WHERE last_seen < NOW() - INTERVAL 1 DAY')]).catch((e) => console.error('[cleanup]', e.message));
  setInterval(cleanup, 60 * 60 * 1000).unref();

  // Flag children who have turned 18 for Transition Review (at start-up and every 6 hours).
  // Then the Transition Review reminders (assessment overdue, tasks due, transition date, aftercare follow-ups).
  const flag = () => syncFlags(true).then(() => require('./src/services/transitionWorkflow').sweepReminders()).catch((e) => console.error('[transition]', e.message));
  flag();
  setInterval(flag, 6 * 60 * 60 * 1000).unref();

  // Child record access: end what expired (initial access, temporary covers, emergency access, monitoring visits),
  // alert Admin (unassigned records, covers ending), remind case workers about Care card reviews. Every 15 minutes.
  // Expiry itself is checked live on every request; this job only records it and sends the alerts.
  const childAccessSweep = () => require('./src/services/childAccess').sweep().catch((e) => console.error('[child-access]', e.message));
  childAccessSweep();
  setInterval(childAccessSweep, 15 * 60 * 1000).unref();

  app.listen(env.port, '0.0.0.0', () => {
    console.log(`[api] CareSphere API listening on http://0.0.0.0:${env.port} (reachable on your LAN)`);
  });
}

start();

module.exports = app;
