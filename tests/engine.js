// Test OCR engine: the tesseract CLI (Tesseract 5, same LSTM engine family as tesseract.js 5), TSV output.
const { execFileSync } = require('child_process');
const fs = require('fs'); const os = require('os'); const path = require('path');
module.exports = async function cliEngine(pngs) {
  const results = [];
  for (const png of pngs) {
    const f = path.join(os.tmpdir(), `ocr-${process.pid}-${Math.random().toString(36).slice(2)}.png`);
    fs.writeFileSync(f, png);
    const tsv = execFileSync('tesseract', [f, 'stdout', '--psm', '3', 'tsv'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    fs.unlinkSync(f);
    const rows = tsv.trim().split('\n').slice(1).map((l) => l.split('\t'));
    const words = rows.filter((r) => r[0] === '5' && r[11] && r[11].trim()).map((r) => ({ text: r[11], conf: Math.round(Number(r[10])), x0: +r[6], y0: +r[7], x1: +r[6] + +r[8], y1: +r[7] + +r[9], line: `${r[2]}-${r[3]}-${r[4]}` }));
    const lines = []; let cur = null;
    for (const w of words) { if (!cur || cur.key !== w.line) { cur = { key: w.line, t: [] }; lines.push(cur); } cur.t.push(w.text); }
    const conf = words.length ? Math.round(words.reduce((a, w) => a + w.conf, 0) / words.length) : 0;
    results.push({ text: lines.map((l) => l.t.join(' ')).join('\n'), confidence: conf, words });
  }
  return { ok: true, results };
};
