/**
 * OCR in its own process (started by ocr.js with child_process.fork), so a crash in tesseract.js can't
 * stop the API. Message in: { images: [base64 PNG], dataDir }. Message out: { ok: true, results: [{ text,
 * confidence, words: [{ text, conf, x0, y0, x1, y1 }] }] } or { ok: false, error }.
 * Runs entirely on this server: no image is sent anywhere.
 */
const fs = require('fs');
const path = require('path');

const wordsOf = (data) => {
  if (Array.isArray(data.words) && data.words.length) return data.words;
  const out = [];
  for (const b of data.blocks || []) for (const p of b.paragraphs || []) for (const l of p.lines || []) for (const w of l.words || []) out.push(w);
  return out;
};

process.on('message', async ({ images, dataDir }) => {
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
    const results = [];
    for (const image of images) {
      const { data } = await worker.recognize(Buffer.from(image, 'base64'), {}, { text: true, blocks: true });
      results.push({
        text: String(data.text || '').slice(0, 20000),
        confidence: Math.round(Number(data.confidence) || 0),
        words: wordsOf(data).slice(0, 800).map((w) => ({ text: w.text, conf: Math.round(w.confidence || 0), ...w.bbox })),
      });
    }
    await worker.terminate().catch(() => {});
    done({ ok: true, results });
  } catch (err) {
    if (worker) await worker.terminate().catch(() => {});
    done({ ok: false, error: String(err?.message || err).slice(0, 200) });
  }
});
process.on('uncaughtException', (err) => { try { process.send({ ok: false, error: String(err?.message || err).slice(0, 200) }); } catch { /* parent gone */ } process.exit(1); });
