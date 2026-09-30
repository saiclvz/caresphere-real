const path = require('path');
const fs = require('fs');
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');

const env = require('./src/config/env');
const { verifyConnection } = require('./src/config/db');
const routes = require('./src/routes');
const { notFound, errorHandler } = require('./src/middleware/errorHandler');
const { purgeExpired } = require('./src/services/qrService');
const mfa = require('./src/services/mfaService');
const healthAccess = require('./src/services/healthAccessService');
const { syncFlags } = require('./src/controllers/childController');

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
    },
  },
}));

app.use(cors({
  origin(origin, cb) {
    // Same-origin requests and tools like curl send no Origin header.
    if (!origin || env.corsOrigins.includes(origin)) return cb(null, true);
    return cb(new Error(`Origin ${origin} is not allowed. Add it to CORS_ORIGINS in .env.`));
  },
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Health-Access', 'Idempotency-Key'],
  exposedHeaders: ['Content-Disposition'],
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
}));

// Uploads (child photos up to 5 MB, adoption documents up to 10 MB) arrive as
// base64 JSON, about 4/3 of the file size. Only those routes get the larger limit.
const UPLOAD_ROUTES = [/^\/api\/children$/, /^\/api\/children\/[^/]+\/photo$/, /^\/api\/adoptions\/\d+\/documents$/];
const jsonLarge = express.json({ limit: '15mb' });
const jsonSmall = express.json({ limit: '1mb' });
app.use((req, res, next) => (UPLOAD_ROUTES.some((r) => r.test(req.path)) ? jsonLarge : jsonSmall)(req, res, next));

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

  // Housekeeping: drop expired QR sessions and JWT denylist entries hourly.
  const cleanup = () => Promise.all([purgeExpired(), healthAccess.purgeExpired(), mfa.purgeExpired()]).catch((e) => console.error('[cleanup]', e.message));
  setInterval(cleanup, 60 * 60 * 1000).unref();

  // Flag children who have turned 18 for Transition Review (at start-up and every 6 hours).
  const flag = () => syncFlags(true).catch((e) => console.error('[transition]', e.message));
  flag();
  setInterval(flag, 6 * 60 * 60 * 1000).unref();

  app.listen(env.port, '0.0.0.0', () => {
    console.log(`[api] CareSphere API listening on http://0.0.0.0:${env.port} (reachable on your LAN)`);
  });
}

start();

module.exports = app;
