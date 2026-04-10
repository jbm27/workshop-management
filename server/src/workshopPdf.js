import { readFileSync, existsSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function kshFormat(n) {
  const r = Math.round(Number(n) || 0);
  return `KSh ${r.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`;
}

function resolveLogoPath() {
  const candidates = [
    path.resolve(__dirname, '..', 'logo1.png'),
    path.resolve(__dirname, '..', '..', 'logo1.png'),
    path.resolve(process.cwd(), 'server', 'logo1.png'),
    path.resolve(process.cwd(), 'logo1.png'),
    path.resolve(__dirname, '..', 'logo.png'),
    path.resolve(__dirname, '..', '..', 'logo.png'),
    path.resolve(process.cwd(), 'server', 'logo.png'),
    path.resolve(process.cwd(), 'logo.png'),
  ];
  for (const p of candidates) {
    try {
      if (existsSync(path.resolve(p))) return path.resolve(p);
    } catch (_) {}
  }
  return null;
}

/**
 * Workshop letterhead + document box; below that either customer/vehicle (quotes/invoices) or job-only (LPO).
 * @param {object} options
 * @param {boolean} [options.showCustomerAndVehicle=true] If false, only job no. — no customer or vehicle block.
 * @returns {{ margin: number, contentWidth: number, pageWidth: number, yContent: number }}
 */
export function drawWorkshopDocumentHeader(
  doc,
  inv,
  company,
  { docBoxTitle, docBoxNumber, dateLabel, dateValue, showCustomerAndVehicle = true },
) {
  const pageWidth = doc.page.width;
  const margin = 50;
  const contentWidth = pageWidth - margin * 2;

  let headerY = margin;
  const logoWidth = 260;
  const logoHeight = 200;
  const logoPath = resolveLogoPath();
  if (logoPath) {
    try {
      doc.image(readFileSync(logoPath), margin, headerY, { fit: [logoWidth, logoHeight] });
    } catch (_) {}
  }

  const contactX = pageWidth - margin - 200;
  let contactY = headerY;
  doc.fontSize(9).font('Helvetica');
  doc.text(company.name, contactX, contactY, { width: 200, align: 'left' });
  contactY += 12;
  doc.text(company.address, contactX, contactY, { width: 200, align: 'left' });
  contactY += 12;
  doc.text(`VAT Registration No.: ${company.vatRegistration}`, contactX, contactY, { width: 200, align: 'left' });
  contactY += 12;
  doc.text(`Licence: PIN: ${company.pin}`, contactX, contactY, { width: 200, align: 'left' });
  contactY += 12;
  const phoneFormatted = String(company.phone || '').replace(/(\+254)(\d{3})(\d{6})/, '$1$2 $3');
  doc.text(`Tel: ${phoneFormatted}`, contactX, contactY, { width: 200, align: 'left' });
  contactY += 12;
  doc.text(`Email: ${company.email}`, contactX, contactY, { width: 200, align: 'left' });

  const docBoxWidth = 200;
  const docBoxX = contactX;
  const docBoxY = contactY + 15;
  const boxPad = 10;
  const innerW = docBoxWidth - 2 * boxPad;
  const boxGap = 4;

  // Title can wrap (e.g. "LOCAL PURCHASE ORDER"); fixed Y for the next lines caused overlap.
  doc.fontSize(14).font('Helvetica-Bold');
  const hTitle = doc.heightOfString(String(docBoxTitle), { width: innerW });
  doc.fontSize(11).font('Helvetica-Bold');
  const hNumber = doc.heightOfString(String(docBoxNumber ?? ''), { width: innerW });
  doc.fontSize(9).font('Helvetica');
  const hDate = doc.heightOfString(`${dateLabel}: ${dateValue}`, { width: innerW });

  const boxHeight = boxPad + hTitle + boxGap + hNumber + boxGap + hDate + boxPad;
  doc.rect(docBoxX, docBoxY, docBoxWidth, boxHeight).stroke();

  let ty = docBoxY + boxPad;
  doc.fontSize(14).font('Helvetica-Bold').text(String(docBoxTitle), docBoxX + boxPad, ty, { width: innerW, align: 'left' });
  ty += hTitle + boxGap;
  doc.fontSize(11).font('Helvetica-Bold').text(String(docBoxNumber ?? ''), docBoxX + boxPad, ty, { width: innerW, align: 'left' });
  ty += hNumber + boxGap;
  doc.fontSize(9).font('Helvetica').text(`${dateLabel}: ${dateValue}`, docBoxX + boxPad, ty, { width: innerW, align: 'left' });

  const headerBottom = headerY + logoHeight;
  const detailsTop = headerBottom + 4;

  let yContent;
  if (!showCustomerAndVehicle) {
    let y = detailsTop;
    doc.fontSize(10).font('Helvetica-Bold').text(`Job no.: ${inv.job_number || '—'}`, margin, y, { width: contentWidth });
    y = doc.y + 4;
    yContent = y + 12;
  } else {
    const colWidth = contentWidth * 0.45;
    const rightColX = margin + colWidth + 20;

    let leftY = detailsTop;
    doc.fontSize(10).font('Helvetica-Bold').text('PREPARED FOR:', margin, leftY);
    leftY = doc.y + 4;
    doc.fontSize(11).font('Helvetica-Bold').text(inv.customer_name || '—', margin, leftY);
    leftY = doc.y + 6;
    doc.fontSize(9).font('Helvetica');
    if (inv.customer_address) {
      doc.text(inv.customer_address, margin, leftY, { width: colWidth });
      leftY = doc.y + 4;
    }
    if (inv.customer_phone) {
      doc.text(`Tel: ${inv.customer_phone}`, margin, leftY, { width: colWidth });
      leftY = doc.y + 4;
    }
    if (inv.customer_email) {
      doc.text(`Email: ${inv.customer_email}`, margin, leftY, { width: colWidth });
      leftY = doc.y + 4;
    }

    let rightY = detailsTop;
    doc.fontSize(10).font('Helvetica-Bold').text('VEHICLE:', rightColX, rightY);
    rightY = doc.y + 4;
    doc.fontSize(9).font('Helvetica');
    doc.text(`Vehicle Owner: ${inv.customer_name || '—'}`, rightColX, rightY, { width: colWidth });
    rightY = doc.y + 4;
    if (inv.registration) {
      doc.text(`Reg No: ${inv.registration}`, rightColX, rightY, { width: colWidth });
      rightY = doc.y + 4;
    }
    if (inv.vin) {
      doc.text(`VIN: ${inv.vin}`, rightColX, rightY, { width: colWidth });
      rightY = doc.y + 4;
    }
    if (inv.make || inv.model) {
      doc.text(`Model: ${[inv.make, inv.model].filter(Boolean).join(' ')}`, rightColX, rightY, { width: colWidth });
      rightY = doc.y + 4;
    }
    if (inv.year) {
      doc.text(`Year: ${inv.year}`, rightColX, rightY, { width: colWidth });
      rightY = doc.y + 4;
    }
    const odometer = inv.odometer_out || inv.odometer_in || inv.odometer;
    if (odometer) {
      doc.text(`Odometer: ${Number(odometer).toLocaleString()} Kms`, rightColX, rightY, { width: colWidth });
      rightY = doc.y + 4;
    }

    yContent = Math.max(leftY, rightY) + 16;
  }
  return { margin, contentWidth, pageWidth, yContent };
}

/**
 * Letterhead + document box for store stock intake LPOs (no customer/job/vehicle).
 * @returns {{ margin: number, contentWidth: number, pageWidth: number, yContent: number }}
 */
export function drawStockStoreLpoHeader(doc, company, { docBoxTitle, docBoxNumber, dateLabel, dateValue }) {
  const pageWidth = doc.page.width;
  const margin = 50;
  const contentWidth = pageWidth - margin * 2;

  let headerY = margin;
  const logoWidth = 260;
  const logoHeight = 200;
  const logoPath = resolveLogoPath();
  if (logoPath) {
    try {
      doc.image(readFileSync(logoPath), margin, headerY, { fit: [logoWidth, logoHeight] });
    } catch (_) {}
  }

  const contactX = pageWidth - margin - 200;
  let contactY = headerY;
  doc.fontSize(9).font('Helvetica');
  doc.text(company.name, contactX, contactY, { width: 200, align: 'left' });
  contactY += 12;
  doc.text(company.address, contactX, contactY, { width: 200, align: 'left' });
  contactY += 12;
  doc.text(`VAT Registration No.: ${company.vatRegistration}`, contactX, contactY, { width: 200, align: 'left' });
  contactY += 12;
  doc.text(`Licence: PIN: ${company.pin}`, contactX, contactY, { width: 200, align: 'left' });
  contactY += 12;
  const phoneFormatted = String(company.phone || '').replace(/(\+254)(\d{3})(\d{6})/, '$1$2 $3');
  doc.text(`Tel: ${phoneFormatted}`, contactX, contactY, { width: 200, align: 'left' });
  contactY += 12;
  doc.text(`Email: ${company.email}`, contactX, contactY, { width: 200, align: 'left' });

  const docBoxWidth = 200;
  const docBoxX = contactX;
  const docBoxY = contactY + 15;
  const boxPad = 10;
  const innerW = docBoxWidth - 2 * boxPad;
  const boxGap = 4;

  doc.fontSize(14).font('Helvetica-Bold');
  const hTitle = doc.heightOfString(String(docBoxTitle), { width: innerW });
  doc.fontSize(11).font('Helvetica-Bold');
  const hNumber = doc.heightOfString(String(docBoxNumber ?? ''), { width: innerW });
  doc.fontSize(9).font('Helvetica');
  const hDate = doc.heightOfString(`${dateLabel}: ${dateValue}`, { width: innerW });

  const boxHeight = boxPad + hTitle + boxGap + hNumber + boxGap + hDate + boxPad;
  doc.rect(docBoxX, docBoxY, docBoxWidth, boxHeight).stroke();

  let ty = docBoxY + boxPad;
  doc.fontSize(14).font('Helvetica-Bold').text(String(docBoxTitle), docBoxX + boxPad, ty, { width: innerW, align: 'left' });
  ty += hTitle + boxGap;
  doc.fontSize(11).font('Helvetica-Bold').text(String(docBoxNumber ?? ''), docBoxX + boxPad, ty, { width: innerW, align: 'left' });
  ty += hNumber + boxGap;
  doc.fontSize(9).font('Helvetica').text(`${dateLabel}: ${dateValue}`, docBoxX + boxPad, ty, { width: innerW, align: 'left' });

  const headerBottom = headerY + logoHeight;
  const detailsTop = headerBottom + 4;
  let y = detailsTop;
  doc.fontSize(10).font('Helvetica-Bold').text('Purpose: Receive stock into stores', margin, y, { width: contentWidth });
  y = doc.y + 4;
  doc.fontSize(9).font('Helvetica').text(
    'This purchase order records supplier stock received into inventory. The stock code identifies the store item.',
    margin,
    y,
    { width: contentWidth },
  );
  const yContent = doc.y + 12;
  return { margin, contentWidth, pageWidth, yContent };
}
