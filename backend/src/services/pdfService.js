const PDFDocument = require('pdfkit');
const QRCode = require('qrcode');

const NAVY = '#1B2A6B'; // CareSphere brand navy (logo)
const BLUE = '#1D5FD6'; // CareSphere brand blue (logo)
const MUTED = '#64748B';

// PDFKit's built-in Helvetica has no peso glyph, so amounts print as "PHP".
const money = (n) => `PHP ${Number(n).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** The CareSphere mark (same paths as frontend Logo.jsx), dark-theme colours, drawn at x,y with size s. */
function drawMark(doc, x, y, s) {
  doc.save().translate(x, y).scale(s / 100);
  doc.path('M90.8 33.5 A44 44 0 1 1 70.6 11.1').lineWidth(5).lineCap('round').stroke('#FFFFFF');
  doc.path('M27 42 L50 22 L73 42').lineWidth(4.5).lineJoin('round').stroke('#FFFFFF');
  doc.circle(37.5, 47, 4.2).fill('#BFDBFE');
  doc.path('M30 63 C30 55 33 52 37.5 52 C41 52 43 54 44 57 L44 63Z').fill('#BFDBFE');
  doc.circle(62.5, 47, 4.2).fill('#BFDBFE');
  doc.path('M70 63 C70 55 67 52 62.5 52 C59 52 57 54 56 57 L56 63Z').fill('#BFDBFE');
  doc.circle(50, 41, 5.2).fill('#60A5FA');
  doc.path('M41 63 C41 53 45 49 50 49 C55 49 59 53 59 63Z').fill('#60A5FA');
  doc.path('M18 66 Q22 84 50 84 Q78 84 82 66 Q66 76 50 76 Q34 76 18 66Z').fill('#FFFFFF');
  doc.path('M80 30 C73 25 70 21 72.5 17.5 C74.5 14.5 78.5 15 80 18 C81.5 15 85.5 14.5 87.5 17.5 C90 21 87 25 80 30Z').fill('#60A5FA');
  doc.restore();
}

/** Report header: navy band with the full CareSphere logo, the home's name and contact line, then the title. */
function header(doc, settings, title) {
  doc.rect(0, 0, doc.page.width, 96).fill(NAVY);
  drawMark(doc, 46, 16, 64);
  doc.font('Times-Bold').fontSize(22).fillColor('#FFFFFF').text('Care', 120, 24, { continued: true }).fillColor('#60A5FA').text('Sphere');
  doc.font('Helvetica').fontSize(8.5).fillColor('#CBD5E1').text('Every child deserves a loving home.', 121, 50);
  doc.font('Helvetica-Bold').fontSize(10).fillColor('#FFFFFF').text(settings.org_name || 'CareSphere', 300, 26, { width: doc.page.width - 350, align: 'right' });
  doc.font('Helvetica').fontSize(8.5).fillColor('#CBD5E1')
    .text([settings.org_address, settings.org_contact].filter(Boolean).join('  |  ') || 'Child Registry and Welfare Home Operations', 300, 42, { width: doc.page.width - 350, align: 'right' });
  doc.fillColor(NAVY).font('Helvetica-Bold').fontSize(16).text(title, 50, 124);
  doc.moveDown(0.5);
}

function row(doc, label, value, y) {
  doc.font('Helvetica').fontSize(10).fillColor(MUTED).text(label, 50, y, { width: 150 });
  doc.font('Helvetica-Bold').fontSize(11).fillColor(NAVY).text(value ?? '-', 200, y, { width: 345 });
}

/** Streams a donation receipt PDF with an embedded verification QR. */
async function donationReceipt(res, donation, settings) {
  const doc = new PDFDocument({ size: 'A4', margin: 50, info: { Title: `CareSphere acknowledgment ${donation.donation_no || donation.donation_id}` } });
  doc.pipe(res);
  header(doc, settings, 'Official Donation Receipt');

  const qrPng = await QRCode.toBuffer(donation.qr_receipt_code, { errorCorrectionLevel: 'M', margin: 1, width: 300 });
  doc.image(qrPng, 405, 150, { width: 140 });
  // The code under the QR image is how receipts are verified, so it is printed as readable text.
  doc.font('Helvetica').fontSize(8).fillColor(MUTED).text('Receipt code', 405, 294, { width: 140, align: 'center' });
  doc.font('Courier-Bold').fontSize(9).fillColor(NAVY).text(donation.qr_receipt_code, 405, 306, { width: 140, align: 'center' });
  doc.font('Helvetica').fontSize(7).fillColor(MUTED).text('Staff verify this code under Donations > Verify receipt.', 405, 340, { width: 140, align: 'center' });

  let y = 160;
  const gap = 26;
  row(doc, 'Acknowledgment no.', donation.ack_no || `#${String(donation.donation_id).padStart(6, '0')}`, y); y += gap;
  if (donation.donation_no) { row(doc, 'Donation no.', donation.donation_no, y); y += gap; }
  row(doc, 'Date', donation.created_at, y); y += gap;
  row(doc, 'Donor', donation.donor_type === 'walk_in' ? `${donation.donor_name} (walk-in)` : donation.donor_name, y); y += gap;
  row(doc, 'Payment method', donation.payment_method, y); y += gap;

  y += 10;
  doc.roundedRect(50, y, 330, 60, 6).fill('#EFF6FF');
  doc.font('Helvetica').fontSize(10).fillColor(MUTED).text('Amount received', 66, y + 12);
  doc.font('Helvetica-Bold').fontSize(20).fillColor(BLUE).text(money(donation.amount), 66, y + 28);
  y += 90;

  doc.font('Helvetica-Bold').fontSize(11).fillColor(NAVY).text('How this donation is being used', 50, y);
  doc.font('Helvetica').fontSize(10).fillColor('#334155')
    .text(donation.allocation_notes || (donation.donor_type === 'walk_in'
      ? 'Allocation has not been recorded yet.'
      : 'Allocation has not been recorded yet. It will appear in your donor portal once assigned.'), 50, y + 18, { width: 495 });

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
  line('Adoptions finalized in period', data.adoptions.completed);
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

  if (data.audit) {
    y += 10; section('Audit log (filters applied)');
    line('Filters', data.audit.filters);
    line('Entries matching the filters', data.audit.total);
    for (const c of data.audit.by_category) line(`   ${c.label}`, c.count);
  }

  y += 10; section('Visitors and meals');
  line('Visitor check-ins', data.visitors.count);
  line('Visits not checked out', data.visitors.open);
  line('Meals logged', data.meals.count);

  doc.end();
}

module.exports = { donationReceipt, complianceReport, money };
