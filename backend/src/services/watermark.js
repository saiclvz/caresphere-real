/**
 * Watermarks for downloads, prints and exports (RA 7610 / RA 11930 child protection):
 * every page carries the user's name and the time, so a leaked copy can be traced.
 *  - PDF files: stamped with pdf-lib (pure JavaScript).
 *  - PNG / JPG: placed on a PDF page with the same stamp (pdfkit, already installed).
 * Output is always a PDF.
 */
const PDFKit = require('pdfkit');

/** Standard PDF fonts only cover Latin-1, so other characters are replaced. */
const latin1 = (s) => String(s).replace(/[^\x20-\x7E\xA0-\xFF]/g, '?');

function stampText(user) {
  const when = new Date().toLocaleString('en-PH', { dateStyle: 'medium', timeStyle: 'short' });
  return latin1(`CONFIDENTIAL - ${user.full_name} (${user.role}) - ${when}`);
}

async function watermarkPdf(buffer, text) {
  // Loaded on first use so the server still starts if the package is missing.
  const { PDFDocument, StandardFonts, rgb, degrees } = require('pdf-lib');
  const pdf = await PDFDocument.load(buffer, { ignoreEncryption: true });
  const font = await pdf.embedFont(StandardFonts.HelveticaBold);
  for (const page of pdf.getPages()) {
    const { width, height } = page.getSize();
    const size = Math.max(12, Math.min(28, width / 26));
    for (let y = height * 0.15; y < height; y += height / 3) {
      page.drawText(text, { x: width * 0.08, y, size, font, color: rgb(0.7, 0.1, 0.1), opacity: 0.18, rotate: degrees(28) });
    }
    page.drawText(text, { x: 18, y: 10, size: 7, font, color: rgb(0.25, 0.25, 0.25), opacity: 0.9 });
  }
  return Buffer.from(await pdf.save());
}

function watermarkImage(buffer, text) {
  return new Promise((resolve, reject) => {
    const doc = new PDFKit({ size: 'A4', margin: 36 });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    const { width, height } = doc.page;
    doc.image(buffer, 36, 36, { fit: [width - 72, height - 96], align: 'center', valign: 'center' });
    doc.page.margins.bottom = 0; // writing near the bottom must not add a page
    doc.save();
    doc.fillColor('#b91c1c').fillOpacity(0.18).font('Helvetica-Bold').fontSize(20);
    for (let y = height * 0.2; y < height; y += height / 3) {
      doc.save().rotate(-28, { origin: [width / 2, y] }).text(text, 0, y, { width, align: 'center' }).restore();
    }
    doc.restore();
    doc.fillOpacity(0.9).fillColor('#333333').font('Helvetica').fontSize(7).text(text, 36, height - 30, { width: width - 72, lineBreak: false });
    doc.end();
  });
}

/** Watermarked PDF of an uploaded file (PDF, PNG or JPG). */
async function watermarkFile(buffer, mime, user) {
  const text = stampText(user);
  return mime === 'application/pdf' ? watermarkPdf(buffer, text) : watermarkImage(buffer, text);
}

module.exports = { watermarkFile, stampText };
