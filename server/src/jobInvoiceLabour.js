import { db } from './db.js';
import { getAverageLabourCostPerHour } from './workshopSettings.js';

function syncInvoicePaymentStatusAfterTotalChange(invoiceId) {
  const inv = db.prepare('SELECT * FROM invoices WHERE id = ?').get(invoiceId);
  if (!inv || inv.type !== 'invoice' || inv.status === 'cancelled') return;

  const paid =
    Number(db.prepare('SELECT COALESCE(SUM(amount), 0) as s FROM invoice_payments WHERE invoice_id = ?').get(invoiceId).s) || 0;
  const total = Number(inv.total) || 0;

  let status;
  let paid_at = null;
  if (paid <= 0) {
    status = 'draft';
  } else if (total > 0 && paid >= total) {
    status = 'paid';
    paid_at =
      db.prepare('SELECT paid_at FROM invoice_payments WHERE invoice_id = ? ORDER BY paid_at DESC, id DESC LIMIT 1').get(invoiceId)
        ?.paid_at ?? null;
  } else {
    status = 'sent';
  }

  db.prepare('UPDATE invoices SET status = ?, paid_at = ?, updated_at = datetime(\'now\') WHERE id = ?').run(status, paid_at, invoiceId);
}

export function refreshInvoiceTotalsFromLineItems(invoiceId) {
  const inv = db.prepare('SELECT type, tax_rate FROM invoices WHERE id = ?').get(invoiceId);
  if (!inv) return;
  const subtotal =
    Number(db.prepare('SELECT COALESCE(SUM(quantity * unit_price), 0) AS s FROM invoice_items WHERE invoice_id = ?').get(invoiceId).s) || 0;
  const tax_amount = subtotal * (Number(inv.tax_rate) || 0);
  const total = subtotal + tax_amount;
  db.prepare('UPDATE invoices SET subtotal = ?, tax_amount = ?, total = ?, updated_at = datetime(\'now\') WHERE id = ?').run(
    subtotal,
    tax_amount,
    total,
    invoiceId,
  );
  if (inv.type === 'invoice') syncInvoicePaymentStatusAfterTotalChange(invoiceId);
}

/** Logged hours and internal cost rate (KES/h) for labour purchase_price on invoice lines. */
export function computeJobLabourHoursAndCostRate(jobId) {
  const jid = parseInt(jobId, 10);
  if (!Number.isFinite(jid) || jid <= 0) return { hours: 0, costPerHour: 0 };

  const job = db
    .prepare(
      `SELECT id, labour_hours_frozen, labour_rate_frozen, labour_cost_frozen FROM jobs WHERE id = ?`,
    )
    .get(jid);
  if (!job) return { hours: 0, costPerHour: 0 };

  const frozenCost = job.labour_cost_frozen;
  const hasFrozen = frozenCost != null && Number.isFinite(Number(frozenCost));
  if (hasFrozen) {
    return {
      hours: Number(job.labour_hours_frozen) || 0,
      costPerHour: Number(job.labour_rate_frozen) || 0,
    };
  }

  const sumRow = db.prepare('SELECT COALESCE(SUM(hours), 0) AS h FROM job_time_logs WHERE job_id = ?').get(jid);
  const hours = Number(sumRow?.h) || 0;
  return {
    hours,
    costPerHour: getAverageLabourCostPerHour(),
  };
}

const insertLabourLine = db.prepare(`
  INSERT INTO invoice_items (invoice_id, description, quantity, unit_price, purchase_price, type, stock_item_id)
  VALUES (?, 'Labour', ?, ?, ?, 'labour', NULL)
`);

/**
 * Keeps the canonical `type = labour` line on every job-linked quote/invoice in sync with
 * logged hours (quantity) and internal cost rate (purchase_price on invoices only).
 */
export function syncLabourLinesForJob(jobId) {
  const jid = parseInt(jobId, 10);
  if (!Number.isFinite(jid) || jid <= 0) return;

  const { hours, costPerHour } = computeJobLabourHoursAndCostRate(jid);
  const docs = db.prepare(`SELECT id, type FROM invoices WHERE job_id = ? AND type IN ('quote', 'invoice')`).all(jid);

  for (const doc of docs) {
    const purchase = doc.type === 'quote' ? 0 : costPerHour;
    const existing = db
      .prepare(`SELECT id, unit_price FROM invoice_items WHERE invoice_id = ? AND type = 'labour' ORDER BY id ASC LIMIT 1`)
      .get(doc.id);
    if (!existing) {
      insertLabourLine.run(doc.id, hours, 0, purchase);
    } else {
      db.prepare(
        `UPDATE invoice_items SET quantity = ?, purchase_price = ?, description = 'Labour', created_at = created_at WHERE id = ?`,
      ).run(hours, purchase, existing.id);
    }
    refreshInvoiceTotalsFromLineItems(doc.id);
  }
}

/** Standalone document (no job): ensure a single Labour line exists. */
export function ensureStandaloneLabourLineIfMissing(invoiceId) {
  const invId = parseInt(invoiceId, 10);
  if (!Number.isFinite(invId) || invId <= 0) return;
  const inv = db.prepare(`SELECT id, job_id, type FROM invoices WHERE id = ?`).get(invId);
  if (!inv || inv.job_id) return;
  const has = db.prepare(`SELECT 1 FROM invoice_items WHERE invoice_id = ? AND type = 'labour' LIMIT 1`).get(invId);
  if (has) return;
  const purchase = inv.type === 'quote' ? 0 : 0;
  insertLabourLine.run(invId, 1, 0, purchase);
  refreshInvoiceTotalsFromLineItems(invId);
}

export function applyLabourPurchaseCostToInvoiceItem(invoiceItemId) {
  const id = parseInt(invoiceItemId, 10);
  if (!Number.isFinite(id) || id <= 0) return false;
  const meta = db
    .prepare(
      `
    SELECT i.type AS inv_type, i.job_id, ii.type AS line_type
    FROM invoice_items ii
    JOIN invoices i ON i.id = ii.invoice_id
    WHERE ii.id = ?
  `,
    )
    .get(id);
  if (!meta || String(meta.inv_type) !== 'invoice' || String(meta.line_type) !== 'labour' || !meta.job_id) return false;
  const { costPerHour } = computeJobLabourHoursAndCostRate(meta.job_id);
  db.prepare('UPDATE invoice_items SET purchase_price = ? WHERE id = ?').run(costPerHour, id);
  return true;
}
