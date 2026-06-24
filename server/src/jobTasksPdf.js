import PDFDocument from 'pdfkit';
import { drawWorkshopDocumentHeader } from './workshopPdf.js';
import { config } from './config.js';

function pageBottom(doc) {
  return doc.page.height - 52;
}

function ensureSpace(doc, y, needed, margin, contentWidth, jobNumber) {
  if (y + needed <= pageBottom(doc)) return y;
  doc.addPage();
  doc.fontSize(8).fillColor('#555555').font('Helvetica');
  doc.text(`Job tasks · ${jobNumber} (continued)`, margin, 45, { width: contentWidth });
  doc.fillColor('#000000');
  return 58;
}

/**
 * @param {import('express').Response} res
 * @param {{ job: object, tasks: object[] }} payload
 */
export function streamJobTasksPdf(res, payload) {
  const { job, tasks } = payload;
  const jobNumber = String(job.job_number || `Job-${job.id}`);
  const safeFile = jobNumber.replace(/[^a-zA-Z0-9-_]/g, '_');
  const doc = new PDFDocument({ size: 'A4', margin: 50 });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="JobTasks_${safeFile}.pdf"`);
  doc.pipe(res);

  const { company } = config;
  const companyName = job.customer_company_name ? String(job.customer_company_name).trim() : '';
  const contactName = job.customer_name ? String(job.customer_name).trim() : '';
  const displayCustomer = companyName || contactName || '—';

  const headerInv = {
    customer_name: displayCustomer,
    customer_address: job.customer_address || '',
    customer_phone: job.customer_phone || '',
    customer_email: job.customer_email || '',
    registration: job.registration,
    make: job.make,
    model: job.model,
    vin: job.vin,
    year: job.year,
    odometer: job.odometer,
    odometer_in: job.odometer_in,
    odometer_out: job.odometer_out,
    job_number: job.job_number,
  };

  const printedAt = new Date().toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' });

  const { margin, contentWidth, yContent } = drawWorkshopDocumentHeader(doc, headerInv, company, {
    docBoxTitle: 'JOB TASKS',
    docBoxNumber: jobNumber,
    dateLabel: 'Printed',
    dateValue: printedAt,
    showCustomerAndVehicle: true,
  });

  let y = yContent;
  const jn = jobNumber;

  if (companyName && contactName && contactName.toLowerCase() !== companyName.toLowerCase()) {
    doc.fontSize(9).font('Helvetica').text(`Contact: ${contactName}`, margin, y, { width: contentWidth });
    y = doc.y + 4;
  }
  if (job.customer_registration_number) {
    doc.text(`Reg No: ${job.customer_registration_number}`, margin, y, { width: contentWidth });
    y = doc.y + 4;
  }

  if (job.description) {
    doc.font('Helvetica-Bold').text('Job description:', margin, y);
    y = doc.y + 2;
    doc.font('Helvetica').text(String(job.description), margin, y, { width: contentWidth });
    y = doc.y + 8;
  }

  doc.fontSize(10).font('Helvetica-Bold').text('Tasks', margin, y);
  y = doc.y + 6;
  doc.fontSize(10).font('Helvetica');

  const taskList = Array.isArray(tasks) ? tasks.filter((t) => String(t.description || '').trim()) : [];
  if (!taskList.length) {
    doc.text('No tasks recorded for this job.', margin, y, { width: contentWidth });
  } else {
    taskList.forEach((t, i) => {
      const mark = Number(t.completed) === 1 ? '☑' : '☐';
      const line = `${i + 1}. ${mark}  ${String(t.description || '').trim()}`;
      const h = doc.heightOfString(line, { width: contentWidth, lineGap: 2 });
      y = ensureSpace(doc, y, h + 6, margin, contentWidth, jn);
      doc.text(line, margin, y, { width: contentWidth, lineGap: 2 });
      y = doc.y + 4;
    });
  }

  doc.end();
}
