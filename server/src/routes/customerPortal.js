import { Router } from 'express';
import { db } from '../db.js';
import { isHeaderLine } from '../invoiceLineSections.js';
import { refreshInvoiceTotalsFromLineItems } from '../jobInvoiceLabour.js';
import { attachInvoiceLineProgress } from '../invoiceLineProgress.js';
import { moveApprovedQuoteLinesToInvoice } from '../quoteToInvoice.js';
import { checkInvoicePdfAllowedForJobStatus } from '../jobCardRules.js';
import { config } from '../config.js';
import { sendInvoicePdf } from './invoices.js';

/** How customers can pay (shown in the portal next to an invoice balance). */
function paymentDetails() {
  const c = config.company;
  return {
    mpesa_till: c.mpesa?.tillNumber || null,
    bank: c.bank ? { name: c.bank.name, branch: c.bank.branch, account_name: c.legalName, account_number: c.bank.accountNumber, swift_code: c.bank.swiftCode } : null,
    terms: c.paymentTerms || null,
  };
}

/** Can the customer download this quote / invoice as a PDF yet? (Job invoices follow the same rule as staff.) */
function pdfAvailable(inv) {
  if (!inv) return false;
  if (inv.type !== 'invoice' || !inv.job_id) return true;
  const job = db.prepare('SELECT status FROM jobs WHERE id = ?').get(inv.job_id);
  return !!job && checkInvoicePdfAllowedForJobStatus(job.status).ok;
}

/** Default service interval used for an estimate when staff have not set the next service themselves. */
const SERVICE_INTERVAL_KM = 10000;
const SERVICE_INTERVAL_MONTHS = 6;

/**
 * Next service due for a vehicle: what staff set on the vehicle, otherwise an estimate from the
 * last finished job (odometer + 10,000 km / date + 6 months). Null when there is nothing to go on.
 */
function nextServiceFor(vehicle, jobs) {
  if (vehicle.next_service_km != null || vehicle.next_service_date) {
    return { km: vehicle.next_service_km ?? null, date: vehicle.next_service_date || null, estimated: false };
  }
  const finished = jobs
    .filter((j) => j.status === 'completed' || j.status === 'vehicle_released')
    .sort((a, b) => String(b.completed_at || b.created_at).localeCompare(String(a.completed_at || a.created_at)));
  const last = finished[0];
  if (!last) return null;
  const odo = Number(last.odometer_out ?? last.odometer_in);
  const base = new Date(`${String(last.completed_at || last.created_at).replace(' ', 'T')}Z`);
  let date = null;
  if (!Number.isNaN(base.getTime())) {
    base.setUTCMonth(base.getUTCMonth() + SERVICE_INTERVAL_MONTHS);
    date = base.toISOString().slice(0, 10);
  }
  return { km: Number.isFinite(odo) && odo > 0 ? odo + SERVICE_INTERVAL_KM : null, date, estimated: true };
}

/** Vehicles the customer owns or has had work done on. */
function customerVehicles(customerId) {
  return db
    .prepare(`
      SELECT v.id, v.registration, v.make, v.model, v.year, v.next_service_km, v.next_service_date
      FROM vehicles v
      WHERE v.customer_id = ? OR v.id IN (SELECT vehicle_id FROM jobs WHERE customer_id = ?)
      ORDER BY v.registration
    `)
    .all(customerId, customerId);
}

function vehicleJobsForCustomer(vehicleId, customerId) {
  return db
    .prepare(`
      SELECT id, job_number, status, description, created_at, completed_at, odometer_in, odometer_out
      FROM jobs WHERE vehicle_id = ? AND customer_id = ?
      ORDER BY created_at DESC
    `)
    .all(vehicleId, customerId);
}

/** Short summary of what was done on a job: the invoice's item lines, or the approved quote lines. */
function jobWorkSummary(jobId) {
  const pick = (type, onlyApproved) =>
    db
      .prepare(`
        SELECT ii.description FROM invoice_items ii JOIN invoices i ON i.id = ii.invoice_id
        WHERE i.job_id = ? AND i.type = ? AND COALESCE(ii.type, '') NOT IN ('header', 'labour')
          ${onlyApproved ? 'AND COALESCE(ii.approved, 0) = 1' : ''}
        ORDER BY ii.sort_order, ii.id
      `)
      .all(jobId, type)
      .map((r) => r.description)
      .filter(Boolean);
  const fromInvoice = pick('invoice', false);
  return fromInvoice.length ? fromInvoice : pick('quote', true);
}

export const customerPortalRouter = Router();

function findCustomerByToken(token) {
  if (!token) return null;
  return db.prepare('SELECT * FROM customers WHERE portal_token = ?').get(token);
}

/** Jobs where the customer may still approve quote lines in the portal. */
function jobAllowsQuoteApproval(status) {
  return status === 'pending' || status === 'in_progress' || status === 'vehicle_released';
}

function assertQuoteApprovalAllowed(quote) {
  if (!quote?.job_id) return;
  const job = db.prepare('SELECT status FROM jobs WHERE id = ?').get(quote.job_id);
  if (!job) return;
  if (!jobAllowsQuoteApproval(job.status)) {
    const err = new Error('Quote approval is only available while the job is open.');
    err.statusCode = 400;
    throw err;
  }
}

function portalPartsForInvoice(invoiceId) {
  const lpoRows = db
    .prepare(
      `SELECT ll.id, ll.invoice_item_id, ll.description,
              COALESCE(ll.received_confirmed, 0) AS received_confirmed,
              COALESCE(ll.fitted_confirmed, 0) AS fitted_confirmed
       FROM lpo_lines ll
       INNER JOIN lpos l ON l.id = ll.lpo_id
       WHERE l.invoice_id = ? AND ll.invoice_item_id IS NOT NULL
       ORDER BY ll.id`,
    )
    .all(invoiceId);
  const iprRows = db
    .prepare(
      `SELECT il.id, il.invoice_item_id, il.description,
              COALESCE(il.received_confirmed, 0) AS received_confirmed
       FROM ipr_lines il
       INNER JOIN iprs ip ON ip.id = il.ipr_id
       WHERE ip.invoice_id = ?
       ORDER BY il.id`,
    )
    .all(invoiceId);
  const partsByItem = new Map();
  const add = (itemId, part) => {
    const list = partsByItem.get(itemId) || [];
    list.push(part);
    partsByItem.set(itemId, list);
  };
  for (const row of lpoRows) {
    add(row.invoice_item_id, {
      id: `lpo-${row.id}`,
      description: row.description,
      source: 'lpo',
      received_confirmed: Number(row.received_confirmed) === 1 ? 1 : 0,
      fitted_confirmed: Number(row.fitted_confirmed) === 1 ? 1 : 0,
    });
  }
  for (const row of iprRows) {
    add(row.invoice_item_id, {
      id: `ipr-${row.id}`,
      description: row.description,
      source: 'ipr',
      received_confirmed: Number(row.received_confirmed) === 1 ? 1 : 0,
    });
  }
  return partsByItem;
}

function portalDocumentForCustomer(inv, items) {
  if (!inv) return null;
  const fresh = refreshInvoiceTotalsFromLineItems(inv.id);
  const payments = db
    .prepare('SELECT id, amount, paid_at, notes FROM invoice_payments WHERE invoice_id = ? ORDER BY paid_at ASC, id ASC')
    .all(inv.id);
  const amount_paid = payments.reduce((s, p) => s + Number(p.amount || 0), 0);
  const total = Number(fresh?.total ?? inv.total) || 0;
  const balance = inv.type === 'invoice' ? Math.round((total - amount_paid) * 100) / 100 : null;
  return {
    id: inv.id,
    invoice_number: inv.invoice_number,
    status: inv.status,
    tax_rate: inv.tax_rate,
    subtotal: fresh?.subtotal ?? inv.subtotal,
    tax_amount: fresh?.tax_amount ?? inv.tax_amount,
    total,
    discount_percent: inv.discount_percent,
    items,
    payments: inv.type === 'invoice' ? payments : [],
    amount_paid: inv.type === 'invoice' ? amount_paid : 0,
    balance,
    pdf_available: true,
    pdf_provisional: inv.type === 'invoice' && !pdfAvailable(inv),
  };
}

function portalJobPayload(job, { withTasks = false, withMileage = false } = {}) {
  const quote = db.prepare(`
    SELECT * FROM invoices
    WHERE job_id = ? AND type = 'quote'
    ORDER BY created_at DESC LIMIT 1
  `).get(job.id);
  const invoice = db.prepare(`
    SELECT * FROM invoices
    WHERE job_id = ? AND type = 'invoice'
    ORDER BY created_at DESC LIMIT 1
  `).get(job.id);
  const quoteItems = quote
    ? db.prepare('SELECT id, description, quantity, unit_price, type, sort_order, subtext, approved, declined_at, vat_rate, vat_exempt, discount_percent, moved_to_invoice_at FROM invoice_items WHERE invoice_id = ? ORDER BY sort_order, id').all(quote.id)
    : [];
  const invoiceItems = invoice
    ? db
        .prepare(
          `SELECT id, description, quantity, unit_price, purchase_price, type, sort_order, subtext, vat_rate, vat_exempt, discount_percent,
                  approved, approved_at, quote_item_id, lpo_issued_at, received_at, fitted_at
           FROM invoice_items WHERE invoice_id = ? ORDER BY sort_order, id`,
        )
        .all(invoice.id)
    : [];
  if (withTasks && invoice) {
    const partsByItem = portalPartsForInvoice(invoice.id);
    for (const item of invoiceItems) {
      item.parts = partsByItem.get(item.id) || [];
    }
    // Line progress (dates only; staff names stay internal)
    attachInvoiceLineProgress(invoice.id, invoiceItems);
  }
  const out = {
    id: job.id,
    job_number: job.job_number,
    status: job.status,
    created_at: job.created_at,
    completed_at: job.completed_at,
    due_date: job.due_date || null,
    vehicle_released_at: job.vehicle_released_at || null,
    vehicle: {
      registration: job.registration,
      make: job.make,
      model: job.model,
    },
    quote: quote ? portalDocumentForCustomer(quote, quoteItems) : null,
    invoice: invoice ? portalDocumentForCustomer(invoice, invoiceItems) : null,
    vehicle_tested_at: job.vehicle_tested_at || null,
    rating: job.customer_rating,
    feedback: job.customer_feedback,
  };
  if (withTasks) {
    out.tasks = db
      .prepare('SELECT id, description, sort_order, completed FROM job_tasks WHERE job_id = ? ORDER BY sort_order, id')
      .all(job.id);
  }
  if (withMileage) {
    out.odometer_in = job.odometer_in;
    out.odometer_out = job.odometer_out;
    out.fuel_in = job.fuel_in;
    out.fuel_out = job.fuel_out;
    out.test_drives = db
      .prepare('SELECT id, odometer, fuel, notes, created_at FROM job_test_drives WHERE job_id = ? ORDER BY id ASC')
      .all(job.id);
  }
  return out;
}

customerPortalRouter.get('/:token/documents/:invoiceId', (req, res) => {
  const customer = findCustomerByToken(req.params.token);
  if (!customer) return res.status(404).json({ error: 'Customer not found' });
  const invId = Number(req.params.invoiceId);
  if (!Number.isFinite(invId)) return res.status(400).json({ error: 'Invalid document id' });

  const inv = db
    .prepare(`
    SELECT i.*, v.registration, v.make, v.model
    FROM invoices i
    LEFT JOIN vehicles v ON v.id = i.vehicle_id
    WHERE i.id = ? AND i.customer_id = ? AND i.job_id IS NULL
  `)
    .get(invId, customer.id);
  if (!inv) return res.status(404).json({ error: 'Document not found' });

  const docType = String(inv.type || '').toLowerCase();
  const isQuote = docType === 'quote';
  const items = isQuote
    ? db
        .prepare('SELECT id, description, quantity, unit_price, type, sort_order, subtext, approved, declined_at, vat_rate, vat_exempt, discount_percent FROM invoice_items WHERE invoice_id = ? ORDER BY sort_order, id')
        .all(inv.id)
    : db
        .prepare(
          'SELECT id, description, quantity, unit_price, purchase_price, type, sort_order, subtext, approved, vat_rate, vat_exempt, discount_percent FROM invoice_items WHERE invoice_id = ? ORDER BY sort_order, id',
        )
        .all(inv.id);
  const quote = isQuote ? portalDocumentForCustomer(inv, items) : null;
  const invoice = !isQuote ? portalDocumentForCustomer(inv, items) : null;

  res.json({
    customer: {
      id: customer.id,
      name: customer.name,
      email: customer.email,
      phone: customer.phone,
    },
    standalone: true,
    document_type: docType,
    vehicle: {
      registration: inv.registration,
      make: inv.make,
      model: inv.model,
    },
    quote,
    invoice,
    quote_approval_allowed: isQuote,
    payment_details: paymentDetails(),
  });
});

/** Download a quote / invoice PDF (same document staff print). */
customerPortalRouter.get('/:token/documents/:invoiceId/pdf', (req, res) => {
  const customer = findCustomerByToken(req.params.token);
  if (!customer) return res.status(404).json({ error: 'Customer not found' });
  const inv = db
    .prepare("SELECT id, type, job_id FROM invoices WHERE id = ? AND customer_id = ? AND type IN ('quote', 'invoice')")
    .get(Number(req.params.invoiceId), customer.id);
  if (!inv) return res.status(404).json({ error: 'Document not found' });
  // Invoices for jobs still in progress come out marked PROVISIONAL.
  return sendInvoicePdf(inv.id, res, { allowProvisional: true });
});

/** One vehicle's history with this customer, plus when the next service is due. */
customerPortalRouter.get('/:token/vehicles/:vehicleId', (req, res) => {
  const customer = findCustomerByToken(req.params.token);
  if (!customer) return res.status(404).json({ error: 'Customer not found' });
  const vehicle = customerVehicles(customer.id).find((v) => v.id === Number(req.params.vehicleId));
  if (!vehicle) return res.status(404).json({ error: 'Vehicle not found' });
  const jobs = vehicleJobsForCustomer(vehicle.id, customer.id);
  const history = jobs.map((j) => {
    const invoice = db
      .prepare("SELECT id, total FROM invoices WHERE job_id = ? AND type = 'invoice' ORDER BY created_at DESC LIMIT 1")
      .get(j.id);
    const totals = invoice ? refreshInvoiceTotalsFromLineItems(invoice.id) : null;
    return {
      id: j.id,
      job_number: j.job_number,
      status: j.status,
      description: j.description,
      created_at: j.created_at,
      completed_at: j.completed_at,
      odometer_in: j.odometer_in,
      odometer_out: j.odometer_out,
      work: jobWorkSummary(j.id),
      invoice_total: invoice ? Number(totals?.total ?? invoice.total) || 0 : null,
    };
  });
  const lastOdo = jobs.map((j) => Number(j.odometer_out ?? j.odometer_in)).find((n) => Number.isFinite(n) && n > 0) ?? null;
  res.json({
    customer: { id: customer.id, name: customer.name },
    vehicle: { id: vehicle.id, registration: vehicle.registration, make: vehicle.make, model: vehicle.model, year: vehicle.year, last_odometer: lastOdo },
    next_service: nextServiceFor(vehicle, jobs),
    history,
  });
});

customerPortalRouter.get('/:token/jobs/:jobId', (req, res) => {
  const customer = findCustomerByToken(req.params.token);
  if (!customer) return res.status(404).json({ error: 'Customer not found' });
  const jobId = Number(req.params.jobId);
  if (!Number.isFinite(jobId)) return res.status(400).json({ error: 'Invalid job id' });

  const job = db
    .prepare(`
    SELECT j.*, v.registration, v.make, v.model
    FROM jobs j
    JOIN vehicles v ON j.vehicle_id = v.id
    WHERE j.id = ? AND j.customer_id = ?
  `)
    .get(jobId, customer.id);
  if (!job) return res.status(404).json({ error: 'Job not found' });

  res.json({
    customer: {
      id: customer.id,
      name: customer.name,
      email: customer.email,
      phone: customer.phone,
    },
    job: portalJobPayload(job, { withTasks: true, withMileage: true }),
    quote_approval_allowed: jobAllowsQuoteApproval(job.status),
    payment_details: paymentDetails(),
  });
});

customerPortalRouter.get('/:token', (req, res) => {
  const customer = findCustomerByToken(req.params.token);
  if (!customer) return res.status(404).json({ error: 'Customer not found' });

  const jobs = db.prepare(`
    SELECT j.*, v.registration, v.make, v.model
    FROM jobs j
    JOIN vehicles v ON j.vehicle_id = v.id
    WHERE j.customer_id = ?
    ORDER BY j.created_at DESC
  `).all(customer.id);

  const resultJobs = jobs.map((job) => portalJobPayload(job));

  const standaloneDocs = db
    .prepare(`
    SELECT i.id, i.invoice_number, i.type, i.status, i.created_at, i.total, i.subtotal, i.tax_amount,
      v.registration, v.make, v.model
    FROM invoices i
    LEFT JOIN vehicles v ON v.id = i.vehicle_id
    WHERE i.customer_id = ? AND i.job_id IS NULL
    ORDER BY i.created_at DESC
  `)
    .all(customer.id);
  for (const doc of standaloneDocs) {
    const totals = refreshInvoiceTotalsFromLineItems(doc.id);
    if (!totals) continue;
    doc.subtotal = totals.subtotal;
    doc.tax_amount = totals.tax_amount;
    doc.total = totals.total;
  }

  res.json({
    customer: {
      id: customer.id,
      name: customer.name,
      email: customer.email,
      phone: customer.phone,
    },
    jobs: resultJobs,
    standalone_documents: standaloneDocs,
    vehicles: customerVehicles(customer.id).map((v) => {
      const vJobs = vehicleJobsForCustomer(v.id, customer.id);
      return {
        id: v.id,
        registration: v.registration,
        make: v.make,
        model: v.model,
        year: v.year,
        visits: vJobs.length,
        last_visit: vJobs[0]?.created_at || null,
        next_service: nextServiceFor(v, vJobs),
      };
    }),
  });
});

customerPortalRouter.post('/:token/quotes/:quoteId/approve-all', (req, res) => {
  const customer = findCustomerByToken(req.params.token);
  if (!customer) return res.status(404).json({ error: 'Customer not found' });
  const quote = db
    .prepare('SELECT * FROM invoices WHERE id = ? AND type = \'quote\' AND customer_id = ?')
    .get(req.params.quoteId, customer.id);
  if (!quote) return res.status(404).json({ error: 'Quote not found' });
  try {
    assertQuoteApprovalAllowed(quote);
  } catch (e) {
    return res.status(e.statusCode || 500).json({ error: e.message });
  }

  // "Approve all" approves everything still undecided; items the customer declined stay declined.
  db.prepare(
    "UPDATE invoice_items SET approved = 1, approved_at = COALESCE(approved_at, datetime('now')) WHERE invoice_id = ? AND COALESCE(type, '') != 'header' AND declined_at IS NULL",
  ).run(quote.id);
  // Approved items go straight onto the job invoice (if there is one yet)
  if (quote.job_id) moveApprovedQuoteLinesToInvoice(quote.job_id);
  res.status(204).send();
});

/**
 * Customer approves or declines one quote item. Approving is final (the item moves onto the job
 * invoice and can't be changed from the portal); a declined item can still be approved later.
 */
function decideQuoteItem(req, res, decision) {
  const customer = findCustomerByToken(req.params.token);
  if (!customer) return res.status(404).json({ error: 'Customer not found' });
  const quote = db
    .prepare("SELECT * FROM invoices WHERE id = ? AND type = 'quote' AND customer_id = ?")
    .get(req.params.quoteId, customer.id);
  if (!quote) return res.status(404).json({ error: 'Quote not found' });
  try {
    assertQuoteApprovalAllowed(quote);
  } catch (e) {
    return res.status(e.statusCode || 500).json({ error: e.message });
  }
  const item = db.prepare('SELECT * FROM invoice_items WHERE id = ? AND invoice_id = ?').get(req.params.itemId, quote.id);
  if (!item) return res.status(404).json({ error: 'Item not found' });
  if (isHeaderLine(item)) return res.status(400).json({ error: 'Section headers do not require approval' });
  if (String(item.type || '').toLowerCase() === 'labour') {
    return res.status(400).json({ error: 'The labour line is not approved item by item' });
  }

  if (decision === 'approve') {
    db.prepare("UPDATE invoice_items SET approved = 1, approved_at = COALESCE(approved_at, datetime('now')), declined_at = NULL WHERE id = ?").run(item.id);
    if (quote.job_id) moveApprovedQuoteLinesToInvoice(quote.job_id);
    return res.status(204).send();
  }
  // decline: only items not yet approved (approval is final)
  if (Number(item.approved) === 1) {
    return res.status(409).json({
      error: 'This item is already approved and can no longer be changed here. Please call or WhatsApp us if you need to discuss it.',
    });
  }
  db.prepare("UPDATE invoice_items SET declined_at = COALESCE(declined_at, datetime('now')) WHERE id = ?").run(item.id);
  return res.status(204).send();
}

customerPortalRouter.post('/:token/quotes/:quoteId/items/:itemId/decision', (req, res) => {
  const decision = String(req.body?.decision || '').toLowerCase();
  if (decision !== 'approve' && decision !== 'decline') return res.status(400).json({ error: 'decision must be approve or decline' });
  return decideQuoteItem(req, res, decision);
});

/** Older endpoint kept for compatibility: { approved: true } approves, { approved: false } declines. */
customerPortalRouter.post('/:token/quotes/:quoteId/items/:itemId/approve', (req, res) =>
  decideQuoteItem(req, res, req.body?.approved ? 'approve' : 'decline'),
);


customerPortalRouter.post('/:token/jobs/:jobId/rating', (req, res) => {
  const customer = findCustomerByToken(req.params.token);
  if (!customer) return res.status(404).json({ error: 'Customer not found' });
  const { rating, feedback } = req.body;
  const job = db
    .prepare('SELECT * FROM jobs WHERE id = ? AND customer_id = ?')
    .get(req.params.jobId, customer.id);
  if (!job) return res.status(404).json({ error: 'Job not found' });

  const r = Math.max(1, Math.min(5, Number(rating) || 0));
  db.prepare('UPDATE jobs SET customer_rating = ?, customer_feedback = ?, updated_at = datetime("now") WHERE id = ?')
    .run(r || null, feedback || null, job.id);
  res.status(204).send();
});

