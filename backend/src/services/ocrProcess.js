/**
 * Runs one OCR reading in its own process (started by services/idReader.js with child_process.fork).
 * If tesseract.js is missing, incomplete or crashes, only this process ends; the API keeps running.
 * Message in: { image: base64, dataDir }. Message out: { ok: true, text, confidence } or { ok: false, error }.
 */
const fs = require('fs');
const path = require('path');

process.on('message', async ({ image, dataDir }) => {
  let worker;
  const done = (msg) => { try { process.send(msg, () => process.exit(0)); } catch { process.exit(0); } };
  try {
    const T = require('tesseract.js');
    const local = fs.existsSync(path.join(dataDir, 'eng.traineddata'));
    worker = await T.createWorker('eng', 1, {
      ...(local ? { langPath: dataDir, gzip: false } : {}),
      cachePath: dataDir,
      errorHandler: (err) => done({ ok: false, error: String(err?.message || err).slice(0, 200) }),
    });
    const { data } = await worker.recognize(Buffer.from(image, 'base64'));
    await worker.terminate().catch(() => {});
    done({ ok: true, text: String(data.text || '').slice(0, 20000), confidence: Math.round(Number(data.confidence) || 0) });
  } catch (err) {
    if (worker) await worker.terminate().catch(() => {});
    done({ ok: false, error: String(err?.message || err).slice(0, 200) });
  }
});
process.on('uncaughtException', (err) => { try { process.send({ ok: false, error: String(err?.message || err).slice(0, 200) }); } catch { /* parent gone */ } process.exit(1); });
