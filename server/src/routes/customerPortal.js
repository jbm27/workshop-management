import { Router } from 'express';
import { db } from '../db.js';

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

function portalDocumentForCustomer(inv, items) {
  if (!inv) return null;
  const payments = db
    .prepare('SELECT id, amount, paid_at, notes FROM invoice_payments WHERE invoice_id = ? ORDER BY paid_at ASC, id ASC')
    .all(inv.id);
  const amount_paid = payments.reduce((s, p) => s + Number(p.amount || 0), 0);
  const total = Number(inv.total || 0);
  const balance = inv.type === 'invoice' ? Math.round((total - amount_paid) * 100) / 100 : null;
  return {
    id: inv.id,
    invoice_number: inv.invoice_number,
    status: inv.status,
    tax_rate: inv.tax_rate,
    subtotal: inv.subtotal,
    tax_amount: inv.tax_amount,
    total: inv.total,
    items,
    payments: inv.type === 'invoice' ? payments : [],
    amount_paid: inv.type === 'invoice' ? amount_paid : 0,
    balance,
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
    ? db.prepare('SELECT id, description, quantity, unit_price, approved FROM invoice_items WHERE invoice_id = ? ORDER BY id').all(quote.id)
    : [];
  const invoiceItems = invoice
    ? db.prepare('SELECT id, description, quantity, unit_price, purchase_price FROM invoice_items WHERE invoice_id = ? ORDER BY id').all(invoice.id)
    : [];
  const out = {
    id: job.id,
    job_number: job.job_number,
    status: job.status,
    created_at: job.created_at,
    completed_at: job.completed_at,
    vehicle: {
      registration: job.registration,
      make: job.make,
      model: job.model,
    },
    quote: quote ? portalDocumentForCustomer(quote, quoteItems) : null,
    invoice: invoice ? portalDocumentForCustomer(invoice, invoiceItems) : null,
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
      .prepare('SELECT id, odometer, fuel, created_at FROM job_test_drives WHERE job_id = ? ORDER BY id ASC')
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
        .prepare('SELECT id, description, quantity, unit_price, approved FROM invoice_items WHERE invoice_id = ? ORDER BY id')
        .all(inv.id)
    : db
        .prepare(
          'SELECT id, description, quantity, unit_price, purchase_price, approved FROM invoice_items WHERE invoice_id = ? ORDER BY id',
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

  res.json({
    customer: {
      id: customer.id,
      name: customer.name,
      email: customer.email,
      phone: customer.phone,
    },
    jobs: resultJobs,
    standalone_documents: standaloneDocs,
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

  db.prepare('UPDATE invoice_items SET approved = 1 WHERE invoice_id = ?').run(quote.id);
  res.status(204).send();
});

customerPortalRouter.post('/:token/quotes/:quoteId/items/:itemId/approve', (req, res) => {
  const customer = findCustomerByToken(req.params.token);
  if (!customer) return res.status(404).json({ error: 'Customer not found' });
  const approved = !!req.body.approved;
  const quote = db
    .prepare("SELECT * FROM invoices WHERE id = ? AND type = 'quote' AND customer_id = ?")
    .get(req.params.quoteId, customer.id);
  if (!quote) return res.status(404).json({ error: 'Quote not found' });
  try {
    assertQuoteApprovalAllowed(quote);
  } catch (e) {
    return res.status(e.statusCode || 500).json({ error: e.message });
  }

  const item = db
    .prepare('SELECT * FROM invoice_items WHERE id = ? AND invoice_id = ?')
    .get(req.params.itemId, quote.id);
  if (!item) return res.status(404).json({ error: 'Item not found' });

  const already = item.approved ? 1 : 0;
  if (!approved) {
    if (already) return res.status(400).json({ error: 'Approval cannot be removed once it has been given.' });
    return res.status(204).send();
  }
  if (already) return res.status(204).send();
  db.prepare('UPDATE invoice_items SET approved = 1 WHERE id = ?').run(item.id);
  res.status(204).send();
});

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

