/**
 * Runs OCR on this server (tesseract.js in a separate process, see ocrWorker.js). If the reading is poor,
 * the image is also tried turned 180, 90 and 270 degrees and the best reading is kept (photos taken
 * sideways or upside down). Tests can replace the engine with setEngine().
 */
const fs = require('fs');
const path = require('path');
const { fork } = require('child_process');
const { rotate } = require('./image');

const DATA_DIR = path.join(__dirname, '..', '..', '..', 'ocr-data');
const TIMEOUT_MS = 120 * 1000;

function installed() {
  try {
    require.resolve('tesseract.js');
    const core = path.dirname(require.resolve('tesseract.js-core/package.json'));
    return fs.readdirSync(core).some((f) => f.endsWith('.wasm'));
  } catch { return false; }
}

/** Default engine: one forked tesseract.js process for a batch of images. */
function tesseractEngine(pngs) {
  return new Promise((resolve) => {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    let settled = false;
    const child = fork(path.join(__dirname, 'ocrWorker.js'), [], { stdio: ['ignore', 'ignore', 'ignore', 'ipc'] });
    const finish = (r) => { if (!settled) { settled = true; clearTimeout(timer); try { child.kill(); } catch { /* ended */ } resolve(r); } };
    const timer = setTimeout(() => finish({ ok: false, error: 'timed out' }), TIMEOUT_MS);
    child.on('message', finish);
    child.on('error', (err) => finish({ ok: false, error: err.message }));
    child.on('exit', (code) => finish({ ok: false, error: `stopped (code ${code})` }));
    child.send({ images: pngs.map((b) => b.toString('base64')), dataDir: DATA_DIR });
  });
}

let engine = null;
const setEngine = (fn) => { engine = fn; };

const score = (r) => (r ? r.confidence * Math.min(1, (r.words?.filter((w) => w.conf > 60 && /[A-Z0-9]{2,}/i.test(w.text)).length || 0) / 15) : 0);

/**
 * Reads one upright PNG. Returns { ok, text, confidence, words, rotated } or { ok: false, error }.
 * minScore: below this, the three rotations are tried as well.
 */
async function read(png, { minScore = 45 } = {}) {
  const run = engine || (installed() ? tesseractEngine : null);
  if (!run) return { ok: false, error: 'not_installed' };
  const first = await run([png]);
  if (!first.ok) return first;
  let best = { ...first.results[0], rotated: 0 };
  if (score(best) < minScore) {
    const turned = await Promise.all([180, 90, 270].map((d) => rotate(png, d)));
    const more = await run(turned);
    if (more.ok) more.results.forEach((r, i) => { if (score(r) > score(best)) best = { ...r, rotated: [180, 90, 270][i] }; });
  }
  return { ok: true, ...best };
}

module.exports = { read, setEngine, installed, DATA_DIR };
