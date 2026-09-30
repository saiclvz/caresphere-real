const PDFDocument = require('pdfkit');
const QRCode = require('qrcode');

const NAVY = '#0F172A';
const BLUE = '#2563EB';
const MUTED = '#64748B';

// PDFKit's built-in Helvetica has no peso glyph, so amounts print as "PHP".
const money = (n) => `PHP ${Number(n).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function header(doc, settings, title) {
  doc.rect(0, 0, doc.page.width, 90).fill(NAVY);
  doc.fillColor('#FFFFFF').font('Helvetica-Bold').fontSize(18).text(settings.org_name || 'CareSphere', 50, 28);
  doc.font('Helvetica').fontSize(10).fillColor('#CBD5E1')
    .text([settings.org_address, settings.org_contact].filter(Boolean).join('  |  ') || 'Child Registry and Welfare Home Operations', 50, 54);
  doc.fillColor(NAVY).font('Helvetica-Bold').fontSize(16).text(title, 50, 120);
  doc.moveDown(0.5);
}

function row(doc, label, value, y) {
  doc.font('Helvetica').fontSize(10).fillColor(MUTED).text(label, 50, y, { width: 150 });
  doc.font('Helvetica-Bold').fontSize(11).fillColor(NAVY).text(value ?? '-', 200, y, { width: 345 });
}

/** Streams a donation receipt PDF with an embedded verification QR. */
async function donationReceipt(res, donation, settings) {
  const doc = new PDFDocument({ size: 'A4', margin: 50, info: { Title: `Receipt ${donation.qr_receipt_code}` } });
  doc.pipe(res);
  header(doc, settings, 'Official Donation Receipt');

  const qrPng = await QRCode.toBuffer(donation.qr_receipt_code, { errorCorrectionLevel: 'M', margin: 1, width: 300 });
  doc.image(qrPng, 405, 150, { width: 140 });
  doc.font('Helvetica').fontSize(8).fillColor(MUTED).text('Scan to verify this receipt', 405, 294, { width: 140, align: 'center' });

  let y = 160;
  const gap = 26;
  row(doc, 'Receipt no.', `#${String(donation.donation_id).padStart(6, '0')}`, y); y += gap;
  row(doc, 'Date', donation.created_at, y); y += gap;
  row(doc, 'Donor', donation.donor_name, y); y += gap;
  row(doc, 'Payment method', donation.payment_method, y); y += gap;

  y += 10;
  doc.roundedRect(50, y, 330, 60, 6).fill('#EFF6FF');
  doc.font('Helvetica').fontSize(10).fillColor(MUTED).text('Amount received', 66, y + 12);
  doc.font('Helvetica-Bold').fontSize(20).fillColor(BLUE).text(money(donation.amount), 66, y + 28);
  y += 90;

  doc.font('Helvetica-Bold').fontSize(11).fillColor(NAVY).text('How this donation is being used', 50, y);
  doc.font('Helvetica').fontSize(10).fillColor('#334155')
    .text(donation.allocation_notes || 'Allocation has not been recorded yet. It will appear in your donor portal once assigned.', 50, y + 18, { width: 495 });

  doc.font('Helvetica').fontSize(8).fillColor(MUTED)
    .text(`Verification code: ${donation.qr_receipt_code}`, 50, 740, { width: 495 })
    .text(settings.receipt_footer || '', 50, 756, { width: 495 });
  doc.end();
}

/** Compliance summary report for administrators. */
function complianceReport(res, data, settings) {
  const doc = new PDFDocument({ size: 'A4', margin: 50, info: { Title: 'CareSphere Compliance Report' } });
  doc.pipe(res);
  header(doc, settings, 'Operations and Compliance Report');
  doc.font('Helvetica').fontSize(10).fillColor(MUTED)
    .text(`Period: ${data.from} to ${data.to}    Generated: ${data.generated_at} by ${data.generated_by}`, 50, 145);

  let y = 180;
  const section = (title) => {
    if (y > 700) { doc.addPage(); y = 60; }
    doc.font('Helvetica-Bold').fontSize(12).fillColor(NAVY).text(title, 50, y);
    doc.moveTo(50, y + 17).lineTo(545, y + 17).strokeColor('#E2E8F0').stroke();
    y += 26;
  };
  const line = (label, value) => {
    if (y > 760) { doc.addPage(); y = 60; }
    doc.font('Helvetica').fontSize(10).fillColor('#334155').text(label, 60, y, { width: 330 });
    doc.font('Helvetica-Bold').text(String(value), 400, y, { width: 145, align: 'right' });
    y += 18;
  };

  section('Child registry');
  line('Active children', data.children.active);
  line('Discharged children', data.children.discharged);
  line('Adopted children', data.children.adopted);
  line('Flagged for Transition Review (18+)', data.children.transition_flagged);
  line('Discharges recorded in period', data.discharges.count);
  line('Adoption applications in period', data.adoptions.submitted);
  line('Adoptions completed in period', data.adoptions.completed);
  line('Active children without a health record', data.children.missing_health);

  y += 10; section('Protected health information access');
  line('3-minute access grants issued', data.phi.grants);
  line('Health record views', data.phi.views);
  line('Health record / case file updates', data.phi.updates);
  line('Access attempts denied', data.phi.denied);
  line('Expired access attempts blocked', data.phi.expired);

  y += 10; section('Inventory');
  line('Items tracked', data.inventory.total);
  line('Items at or below minimum threshold', data.inventory.low);
  for (const item of data.inventory.low_items.slice(0, 15)) line(`   Low: ${item.item_name}`, `${item.quantity} / min ${item.min_threshold}`);

  y += 10; section('Donations');
  line('Donations received', data.donations.count);
  line('Total amount', money(data.donations.total));
  line('Donor pledges awaiting confirmation', data.donations.pending);
  line('Donations without allocation notes', data.donations.unallocated);

  y += 10; section('Visitors and meals');
  line('Visitor check-ins', data.visitors.count);
  line('Visits not checked out', data.visitors.open);
  line('Meals logged', data.meals.count);

  doc.end();
}

module.exports = { donationReceipt, complianceReport, money };
