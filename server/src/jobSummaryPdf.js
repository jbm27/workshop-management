import PDFDocument from 'pdfkit';
import { drawWorkshopDocumentHeader, kshFormat } from './workshopPdf.js';
import { config } from './config.js';

function pct(numerator, denominator) {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator === 0) return null;
  return (numerator / denominator) * 100;
}

function lineSaleRevenue(it) {
  return (Number(it.quantity) || 0) * (Number(it.unit_price) || 0);
}

function lineInternalCost(it) {
  const lpo = Number(it.lpo_allocated_cost) || 0;
  const ipr = Number(it.ipr_allocated_cost) || 0;
  if (lpo > 0 || ipr > 0) return lpo + ipr;
  return (Number(it.quantity) || 0) * (Number(it.purchase_price) || 0);
}

/** Same basis as job card / reports jobs-financial (ex-VAT subtotal vs LPO/IPR + purchase). */
export function computeInvoiceMarginStats(inv, items) {
  if (!inv || String(inv.type) !== 'invoice' || !Array.isArray(items)) {
    return {
      revenue: 0,
      total_cost: 0,
      profit: 0,
      profit_margin_pct: null,
      labour_margin_pct: null,
      spares_margin_pct: null,
    };
  }
  let labourRevenue = 0;
  let labourCost = 0;
  let sparesRevenue = 0;
  let sparesCost = 0;
  for (const it of items) {
    const rev = lineSaleRevenue(it);
    const cost = lineInternalCost(it);
    const lab = String(it.type || '').toLowerCase() === 'labour';
    if (lab) {
      labourRevenue += rev;
      labourCost += cost;
    } else {
      sparesRevenue += rev;
      sparesCost += cost;
    }
  }
  const sumLineRevenue = items.reduce((s, it) => s + lineSaleRevenue(it), 0);
  const revenue = Number.isFinite(Number(inv.subtotal)) ? Number(inv.subtotal) : sumLineRevenue;
  const totalCost = labourCost + sparesCost;
  const profit = revenue - totalCost;
  return {
    revenue,
    total_cost: totalCost,
    profit,
    profit_margin_pct: pct(profit, revenue),
    labour_margin_pct: pct(labourRevenue - labourCost, labourRevenue),
    spares_margin_pct: pct(sparesRevenue - sparesCost, sparesRevenue),
  };
}

function pageBottom(doc) {
  return doc.page.height - 52;
}

function ensureSpace(doc, y, needed, margin, contentWidth, jobNumber) {
  if (y + needed <= pageBottom(doc)) return y;
  doc.addPage();
  doc.fontSize(8).fillColor('#555555').font('Helvetica');
  doc.text(`Job summary · ${jobNumber} (continued)`, margin, 45, { width: contentWidth });
  doc.fillColor('#000000');
  return 58;
}

function sectionTitle(doc, margin, y, contentWidth, jobNumber, title) {
  y = ensureSpace(doc, y, 22, margin, contentWidth, jobNumber);
  doc.fontSize(9).font('Helvetica-Bold').fillColor('#111').text(title, margin, y, { width: contentWidth });
  return doc.y + 3;
}

function fmtDateShort(iso) {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
  } catch (_) {
    return String(iso).slice(0, 10);
  }
}

function fmtDateTimeShort(iso) {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString('en-GB', { dateStyle: 'short', timeStyle: 'short' });
  } catch (_) {
    return String(iso).slice(0, 16);
  }
}

function trunc(s, max) {
  const t = String(s || '').replace(/\s+/g, ' ').trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1)}…`;
}

/** Wide money columns so large KSh amounts stay on one line at ~6.8pt. */
function tableColumnWidths(contentWidth) {
  const gap = 8;
  const wAmt = 100;
  const wUnit = 84;
  const wQty = 42;
  const wDesc = Math.max(100, contentWidth - wAmt - wUnit - wQty - 3 * gap);
  return { wDesc, wQty, wUnit, wAmt, gap };
}

/** LPO/IPR line receipt attribution (DB: received_confirmed + receiver admin user). */
function formatReceivedLine(ln) {
  if (Number(ln.received_confirmed) === 1) {
    const who = String(ln.received_by_display_name || '').trim() || '—';
    const when = ln.received_confirmed_at ? fmtDateTimeShort(ln.received_confirmed_at) : '';
    return when ? `Received by: ${who} · ${when}` : `Received by: ${who}`;
  }
  const assign = String(ln.assigned_display_name || '').trim();
  if (assign) return `Not received · assigned: ${assign}`;
  return 'Not received';
}

/**
 * @param {import('express').Response} res
 * @param {object} payload
 */
export function streamJobSummaryPdf(res, payload) {
  const {
    job,
    tasks,
    test_drives,
    time_logs,
    quote,
    quoteItems,
    invoice,
    invoiceItems,
    payments,
    lpoDetails,
    iprDetails,
  } = payload;

  const jobNumber = String(job.job_number || `Job-${job.id}`);
  const safeFile = jobNumber.replace(/[^a-zA-Z0-9-_]/g, '_');
  const doc = new PDFDocument({ size: 'A4', margin: 50 });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="JobSummary_${safeFile}.pdf"`);
  doc.pipe(res);

  const { company } = config;
  const headerInv = {
    customer_name: job.customer_name,
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

  const completedStr = job.completed_at
    ? new Date(job.completed_at).toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' })
    : '—';

  const { margin, contentWidth, yContent } = drawWorkshopDocumentHeader(doc, headerInv, company, {
    docBoxTitle: 'JOB SUMMARY',
    docBoxNumber: jobNumber,
    dateLabel: 'Completed',
    dateValue: completedStr,
    showCustomerAndVehicle: true,
  });

  let y = yContent;
  const jn = jobNumber;

  y = sectionTitle(doc, margin, y, contentWidth, jn, 'Job status & dates');
  doc.fontSize(7.5).font('Helvetica');
  const statusLine = [
    `Status: ${String(job.status || '').replace(/_/g, ' ')}`,
    `Created: ${fmtDateShort(job.created_at)}`,
    `Completed: ${fmtDateTimeShort(job.completed_at)}`,
    `Due: ${job.due_date ? fmtDateShort(job.due_date) : '—'}`,
  ].join('   ·   ');
  doc.text(statusLine, margin, y, { width: contentWidth, lineGap: 1 });
  y = doc.y + 4;
  if (job.notes) {
    y = ensureSpace(doc, y, 28, margin, contentWidth, jn);
    doc.font('Helvetica-Bold').text('Job notes:', margin, y);
    y = doc.y + 1;
    doc.font('Helvetica').text(String(job.notes), margin, y, { width: contentWidth, lineGap: 0.5 });
    y = doc.y + 4;
  }
  if (job.customer_rating != null || (job.customer_feedback && String(job.customer_feedback).trim())) {
    y = ensureSpace(doc, y, 20, margin, contentWidth, jn);
    doc.font('Helvetica-Bold').text('Customer feedback:', margin, y);
    y = doc.y + 1;
    const fb = [
      job.customer_rating != null ? `Rating: ${String(job.customer_rating)}/5` : null,
      job.customer_feedback ? trunc(String(job.customer_feedback), 400) : null,
    ]
      .filter(Boolean)
      .join('   ·   ');
    doc.font('Helvetica').text(fb || '—', margin, y, { width: contentWidth, lineGap: 0.5 });
    y = doc.y + 4;
  }

  y = sectionTitle(doc, margin, y, contentWidth, jn, 'Mileage & fuel');
  doc.fontSize(7.5).font('Helvetica');
  doc.text(
    [
      `Odometer in: ${job.odometer_in != null ? Number(job.odometer_in).toLocaleString() + ' km' : '—'}`,
      `Odometer out: ${job.odometer_out != null ? Number(job.odometer_out).toLocaleString() + ' km' : '—'}`,
      `Fuel in: ${job.fuel_in || '—'}`,
      `Fuel out: ${job.fuel_out || '—'}`,
    ].join('   ·   '),
    margin,
    y,
    { width: contentWidth },
  );
  y = doc.y + 6;

  y = sectionTitle(doc, margin, y, contentWidth, jn, 'Valuables in vehicle');
  y = ensureSpace(doc, y, 20, margin, contentWidth, jn);
  doc.fontSize(7.5).font('Helvetica');
  if (job.valuables_in_vehicle && String(job.valuables_in_vehicle).trim()) {
    doc.text(String(job.valuables_in_vehicle), margin, y, { width: contentWidth, lineGap: 0.5 });
    y = doc.y + 4;
  } else {
    doc.text('—', margin, y);
    y = doc.y + 4;
  }

  y = sectionTitle(doc, margin, y, contentWidth, jn, 'Tasks');
  doc.fontSize(7.5).font('Helvetica');
  const taskList = Array.isArray(tasks) ? tasks : [];
  if (!taskList.length) {
    doc.text('—', margin, y);
    y = doc.y + 4;
  } else {
    for (const t of taskList) {
      const mark = Number(t.completed) === 1 ? '☑' : '☐';
      const line = `${mark} ${String(t.description || '').trim()}`;
      y = ensureSpace(doc, y, 12, margin, contentWidth, jn);
      doc.text(trunc(line, 140), margin, y, { width: contentWidth, lineGap: 0.5 });
      y = doc.y + 1;
    }
    y += 3;
  }

  y = sectionTitle(doc, margin, y, contentWidth, jn, 'Test drives');
  const tdList = Array.isArray(test_drives) ? test_drives : [];
  if (!tdList.length) {
    doc.fontSize(7.5).font('Helvetica').text('—', margin, y);
    y = doc.y + 6;
  } else {
    doc.fontSize(7).font('Helvetica-Bold');
    doc.text('When', margin, y, { width: 56 });
    doc.text('Odo (km)', margin + 58, y, { width: 40, align: 'right' });
    doc.text('Fuel', margin + 102, y, { width: 32 });
    doc.text('Logged by', margin + 138, y, { width: contentWidth - 138 });
    y = doc.y + 2;
    doc.moveTo(margin, y).lineTo(margin + contentWidth, y).stroke('#cccccc');
    y += 4;
    doc.font('Helvetica');
    for (const td of tdList) {
      y = ensureSpace(doc, y, 12, margin, contentWidth, jn);
      const who = td.logged_by_display_name || td.logged_by_username || '—';
      doc.text(fmtDateTimeShort(td.created_at), margin, y, { width: 56 });
      doc.text(td.odometer != null ? String(td.odometer) : '—', margin + 58, y, { width: 40, align: 'right' });
      doc.text(String(td.fuel || '—'), margin + 102, y, { width: 32 });
      doc.text(String(who), margin + 138, y, { width: contentWidth - 138 });
      y = doc.y + 1;
    }
    y += 4;
  }

  const drawQuoteInvoiceLineItems = (label, invRow, items, isQuote) => {
    y = sectionTitle(doc, margin, y, contentWidth, jn, label);
    if (!invRow) {
      doc.fontSize(7.5).font('Helvetica').text('—', margin, y);
      y = doc.y + 6;
      return;
    }
    doc.fontSize(7.5).font('Helvetica');
    const no = invRow.invoice_number ? `No. ${invRow.invoice_number}` : '—';
    doc.text(`${no} · Status: ${invRow.status || '—'}`, margin, y, { width: contentWidth, lineGap: 1 });
    y = doc.y + 2;
    const sub = invRow.subtotal != null ? kshFormat(invRow.subtotal) : '—';
    const tot = invRow.total != null ? kshFormat(invRow.total) : '—';
    doc.text(`Subtotal: ${sub}`, margin, y, { width: contentWidth, lineGap: 0.5 });
    y = doc.y + 1;
    doc.text(`Total (incl. VAT where applicable): ${tot}`, margin, y, { width: contentWidth, lineGap: 0.5 });
    y = doc.y + 5;

    const list = Array.isArray(items) ? items : [];
    if (!list.length) {
      doc.fontSize(7.5).font('Helvetica').text('No line items.', margin, y);
      y = doc.y + 6;
      return;
    }

    const { wDesc, wQty, wUnit, wAmt, gap } = tableColumnWidths(contentWidth);
    const xQty = margin + wDesc + gap;
    const xUnit = xQty + wQty + gap;
    const xAmt = xUnit + wUnit + gap;

    doc.fontSize(6.8).font('Helvetica-Bold');
    doc.text('Description', margin, y, { width: wDesc });
    doc.text('Qty', xQty, y, { width: wQty, align: 'right' });
    doc.text('Unit', xUnit, y, { width: wUnit, align: 'right' });
    doc.text('Amount', xAmt, y, { width: wAmt, align: 'right' });
    y = doc.y + 1;
    doc.moveTo(margin, y).lineTo(margin + contentWidth, y).stroke('#dddddd');
    y += 3;
    doc.font('Helvetica');
    for (const it of list) {
      const desc = String(it.description || '—');
      const qty = Number(it.quantity) || 0;
      const unit = Number(it.unit_price) || 0;
      const amt = qty * unit;
      const h = Math.max(
        doc.heightOfString(desc, { width: wDesc, lineGap: 0.3 }),
        doc.heightOfString(qty.toFixed(2), { width: wQty, align: 'right' }),
        doc.heightOfString(kshFormat(unit), { width: wUnit, align: 'right' }),
        doc.heightOfString(kshFormat(amt), { width: wAmt, align: 'right' }),
      );
      y = ensureSpace(doc, y, h + 4, margin, contentWidth, jn);
      doc.text(desc, margin, y, { width: wDesc, lineGap: 0.3 });
      doc.text(qty.toFixed(2), xQty, y, { width: wQty, align: 'right' });
      doc.text(kshFormat(unit), xUnit, y, { width: wUnit, align: 'right' });
      doc.text(kshFormat(amt), xAmt, y, { width: wAmt, align: 'right' });
      y += h + 1;
    }
    if (!isQuote && list.length) {
      doc.fontSize(6.5).fillColor('#444444');
      y = ensureSpace(doc, y, 14, margin, contentWidth, jn);
      doc.text('Invoice line internal cost uses LPO/IPR receipts where present; otherwise purchase × qty.', margin, y, {
        width: contentWidth,
        lineGap: 0.3,
      });
      doc.fillColor('#000000');
      y = doc.y + 4;
    } else {
      y += 2;
    }
  };

  const drawCostLineTable = (lines, unitHeading, amountHeading, options = {}) => {
    const { showReceived = false } = options;
    const { wDesc, wQty, wUnit, wAmt, gap } = tableColumnWidths(contentWidth);
    const xQty = margin + wDesc + gap;
    const xUnit = xQty + wQty + gap;
    const xAmt = xUnit + wUnit + gap;

    doc.fontSize(6.8).font('Helvetica-Bold');
    doc.text('Description', margin, y, { width: wDesc });
    doc.text('Qty', xQty, y, { width: wQty, align: 'right' });
    doc.text(unitHeading, xUnit, y, { width: wUnit, align: 'right' });
    doc.text(amountHeading, xAmt, y, { width: wAmt, align: 'right' });
    y = doc.y + 1;
    doc.moveTo(margin, y).lineTo(margin + contentWidth, y).stroke('#dddddd');
    y += 3;
    doc.font('Helvetica');
    const list = Array.isArray(lines) ? lines : [];
    if (!list.length) {
      doc.fontSize(7).text('No lines.', margin, y);
      y = doc.y + 4;
      return;
    }
    for (const ln of list) {
      const desc = String(ln.description || '—');
      const qty = Number(ln.quantity) || 0;
      const uc = Number(ln.unit_cost) || 0;
      const net = Number(ln.line_net) != null && Number.isFinite(Number(ln.line_net)) ? Number(ln.line_net) : qty * uc;
      doc.fontSize(6.8).font('Helvetica');
      const hDesc = doc.heightOfString(desc, { width: wDesc, lineGap: 0.3 });
      let hRecv = 0;
      let recvText = '';
      if (showReceived) {
        recvText = formatReceivedLine(ln);
        doc.fontSize(5.9).fillColor('#444444');
        hRecv = recvText ? doc.heightOfString(recvText, { width: wDesc, lineGap: 0.2 }) + 1.2 : 0;
        doc.fillColor('#000000').fontSize(6.8).font('Helvetica');
      }
      const h = Math.max(
        hDesc + hRecv,
        doc.heightOfString(qty.toFixed(2), { width: wQty, align: 'right' }),
        doc.heightOfString(kshFormat(uc), { width: wUnit, align: 'right' }),
        doc.heightOfString(kshFormat(net), { width: wAmt, align: 'right' }),
      );
      y = ensureSpace(doc, y, h + 4, margin, contentWidth, jn);
      const rowTop = y;
      doc.text(desc, margin, rowTop, { width: wDesc, lineGap: 0.3 });
      if (showReceived && recvText) {
        doc.fontSize(5.9).fillColor('#444444').font('Helvetica');
        doc.text(recvText, margin, rowTop + hDesc + 1, { width: wDesc, lineGap: 0.2 });
        doc.fillColor('#000000').fontSize(6.8).font('Helvetica');
      }
      doc.text(qty.toFixed(2), xQty, rowTop, { width: wQty, align: 'right' });
      doc.text(kshFormat(uc), xUnit, rowTop, { width: wUnit, align: 'right' });
      doc.text(kshFormat(net), xAmt, rowTop, { width: wAmt, align: 'right' });
      y += h + 1;
    }
    y += 2;
  };

  drawQuoteInvoiceLineItems('Quote', quote, quoteItems, true);
  drawQuoteInvoiceLineItems('Invoice', invoice, invoiceItems, false);

  y = sectionTitle(doc, margin, y, contentWidth, jn, 'LPOs (invoice)');
  doc.fontSize(7.5).font('Helvetica');
  const lpoDocs = Array.isArray(lpoDetails) ? lpoDetails : [];
  if (!invoice || !lpoDocs.length) {
    doc.text(invoice ? '—' : 'No invoice —', margin, y);
    y = doc.y + 6;
  } else {
    for (const l of lpoDocs) {
      y = ensureSpace(doc, y, 28, margin, contentWidth, jn);
      const fin = Number(l.finalized) === 1 ? 'finalised' : 'open';
      const appr = Number(l.approved) === 1 ? 'approved' : 'not appr.';
      doc.font('Helvetica-Bold').text(`${l.ref || '—'} · ${l.supplier_name || '—'} · ${fin} · ${appr}`, margin, y, {
        width: contentWidth,
        lineGap: 0.5,
      });
      y = doc.y + 3;
      doc.font('Helvetica');
      doc.fontSize(6.5).fillColor('#333333').text('Line totals are ex-VAT (qty × unit cost). Receipt shows who confirmed goods received.', margin, y, {
        width: contentWidth,
        lineGap: 0.3,
      });
      doc.fillColor('#000000');
      y = doc.y + 3;
      drawCostLineTable(l.lines, 'Unit (ex)', 'Line (ex)', { showReceived: true });
      y = ensureSpace(doc, y, 14, margin, contentWidth, jn);
      doc.fontSize(7).font('Helvetica-Bold');
      doc.text(`Document total (ex-VAT): ${kshFormat(Number(l.total_ex_vat) || 0)}`, margin, y, { width: contentWidth, align: 'right' });
      y = doc.y + 6;
    }
    y += 2;
  }

  y = sectionTitle(doc, margin, y, contentWidth, jn, 'IPRs (invoice)');
  const iprDocs = Array.isArray(iprDetails) ? iprDetails : [];
  if (!invoice || !iprDocs.length) {
    doc.fontSize(7.5).font('Helvetica').text(invoice ? '—' : 'No invoice —', margin, y);
    y = doc.y + 6;
  } else {
    for (const ip of iprDocs) {
      y = ensureSpace(doc, y, 28, margin, contentWidth, jn);
      const fin = Number(ip.finalized) === 1 ? 'finalised' : 'open';
      const appr = Number(ip.approved) === 1 ? 'approved' : 'not appr.';
      doc.font('Helvetica-Bold').text(`${ip.ref || '—'} · ${fin} · ${appr}`, margin, y, { width: contentWidth, lineGap: 0.5 });
      y = doc.y + 3;
      doc.font('Helvetica');
      doc.fontSize(6.5).fillColor('#333333').text('Line totals are ex-VAT (qty × unit cost). Receipt shows who confirmed stock issued.', margin, y, {
        width: contentWidth,
        lineGap: 0.3,
      });
      doc.fillColor('#000000');
      y = doc.y + 3;
      drawCostLineTable(ip.lines, 'Unit (ex)', 'Line (ex)', { showReceived: true });
      y = ensureSpace(doc, y, 14, margin, contentWidth, jn);
      doc.fontSize(7).font('Helvetica-Bold');
      doc.text(`Document total (ex-VAT): ${kshFormat(Number(ip.total_ex_vat) || 0)}`, margin, y, { width: contentWidth, align: 'right' });
      y = doc.y + 6;
    }
    y += 2;
  }

  y = sectionTitle(doc, margin, y, contentWidth, jn, 'Invoice payments');
  const payList = Array.isArray(payments) ? payments : [];
  if (!invoice || !payList.length) {
    doc.fontSize(7.5).font('Helvetica').text(invoice ? '—' : 'No invoice —', margin, y);
    y = doc.y + 6;
  } else {
    const payAmtW = 92;
    const payDateW = 86;
    const payNotesX = margin + payDateW + payAmtW + 10;
    const payNotesW = margin + contentWidth - payNotesX;
    doc.fontSize(7).font('Helvetica-Bold');
    doc.text('Paid at', margin, y, { width: payDateW });
    doc.text('Amount', margin + payDateW, y, { width: payAmtW, align: 'right' });
    doc.text('Notes', payNotesX, y, { width: payNotesW });
    y = doc.y + 2;
    doc.moveTo(margin, y).lineTo(margin + contentWidth, y).stroke('#cccccc');
    y += 4;
    doc.font('Helvetica');
    for (const p of payList) {
      const payH = Math.max(
        doc.heightOfString(fmtDateTimeShort(p.paid_at), { width: payDateW }),
        doc.heightOfString(kshFormat(p.amount), { width: payAmtW, align: 'right' }),
        doc.heightOfString(trunc(p.notes, 80), { width: payNotesW }),
      );
      y = ensureSpace(doc, y, payH + 4, margin, contentWidth, jn);
      doc.text(fmtDateTimeShort(p.paid_at), margin, y, { width: payDateW });
      doc.text(kshFormat(p.amount), margin + payDateW, y, { width: payAmtW, align: 'right' });
      doc.text(trunc(p.notes, 80), payNotesX, y, { width: payNotesW });
      y += payH + 1;
    }
    y += 4;
  }

  y = sectionTitle(doc, margin, y, contentWidth, jn, 'Time logs (job work)');
  const logs = Array.isArray(time_logs) ? time_logs : [];
  if (!logs.length) {
    doc.fontSize(7.5).font('Helvetica').text('—', margin, y);
    y = doc.y + 6;
  } else {
    doc.fontSize(7).font('Helvetica-Bold');
    doc.text('Date', margin, y, { width: 58 });
    doc.text('Mechanic', margin + 60, y, { width: 92 });
    doc.text('Hrs', margin + 154, y, { width: 28, align: 'right' });
    doc.text('Notes', margin + 186, y, { width: contentWidth - 186 });
    y = doc.y + 2;
    doc.moveTo(margin, y).lineTo(margin + contentWidth, y).stroke('#cccccc');
    y += 4;
    doc.font('Helvetica');
    for (const tl of logs) {
      y = ensureSpace(doc, y, 14, margin, contentWidth, jn);
      const who = tl.admin_display_name || tl.admin_username || '—';
      const note = trunc(tl.notes, 55);
      doc.text(fmtDateShort(tl.worked_at), margin, y, { width: 58 });
      doc.text(trunc(who, 22), margin + 60, y, { width: 92 });
      doc.text((Number(tl.hours) || 0).toFixed(2), margin + 154, y, { width: 28, align: 'right' });
      doc.text(note, margin + 186, y, { width: contentWidth - 186 });
      y = doc.y + 1;
    }
    y += 4;
  }

  y = sectionTitle(doc, margin, y, contentWidth, jn, 'Labour cost (workshop)');
  doc.fontSize(7.5).font('Helvetica');
  const hrs = Number(job.total_labour_hours) || 0;
  const rate = Number(job.average_labour_cost_per_hour) || 0;
  const labCost = Number(job.total_labour_cost) || 0;
  const locked = job.labour_cost_locked ? 'yes' : 'no';
  doc.text(
    `Logged hours: ${hrs.toFixed(2)}   ·   Avg cost / h: ${kshFormat(rate)}   ·   Labour cost: ${kshFormat(labCost)}   ·   Frozen at job close: ${locked}`,
    margin,
    y,
    { width: contentWidth, lineGap: 0.5 },
  );
  y = doc.y + 6;

  const fin = computeInvoiceMarginStats(invoice, invoiceItems);
  y = sectionTitle(doc, margin, y, contentWidth, jn, 'Profit & margin (invoice, ex-VAT subtotal vs cost)');
  doc.fontSize(7.5).font('Helvetica');
  if (!invoice) {
    doc.text('No invoice on this job — margin not applicable.', margin, y, { width: contentWidth });
    y = doc.y + 6;
  } else {
    const lines = [
      `Revenue (invoice subtotal): ${kshFormat(fin.revenue)}`,
      `Estimated cost (LPO/IPR + purchase): ${kshFormat(fin.total_cost)}`,
      `Gross profit: ${kshFormat(fin.profit)}`,
      fin.profit_margin_pct != null ? `Overall margin: ${fin.profit_margin_pct.toFixed(1)}%` : 'Overall margin: —',
      fin.labour_margin_pct != null ? `Labour margin: ${fin.labour_margin_pct.toFixed(1)}%` : 'Labour margin: —',
      fin.spares_margin_pct != null ? `Spares margin: ${fin.spares_margin_pct.toFixed(1)}%` : 'Spares margin: —',
    ];
    for (const line of lines) {
      y = ensureSpace(doc, y, 12, margin, contentWidth, jn);
      doc.text(line, margin, y, { width: contentWidth, lineGap: 0.5 });
      y = doc.y + 1;
    }
    y += 4;
  }

  doc.fontSize(6.5).fillColor('#666666').font('Helvetica');
  y = ensureSpace(doc, y, 20, margin, contentWidth, jn);
  doc.text(
    'Internal summary for workshop use. Margins use invoice subtotal (ex-VAT) and line costs from LPO/IPR unit costs or purchase price.',
    margin,
    y,
    { width: contentWidth, lineGap: 0.5 },
  );

  doc.end();
}
