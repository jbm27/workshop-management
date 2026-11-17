import { db } from './db.js';
import { nextInvoiceItemSortOrder } from './invoiceLineSections.js';
import { syncLabourLinesForJob } from './jobInvoiceLabour.js';

function sameDescription(a, b) {
  return String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();
}

/**
 * Move every customer-approved quote line of a job onto the job's invoice.
 *
 * - Only approved lines move; unapproved lines never reach the invoice this way.
 * - Each quote line moves once (`moved_to_invoice_at` is stamped on it), so if staff later
 *   remove it from the invoice it does not come back.
 * - Section headers and the labour line are not moved (labour is already synced to the invoice).
 * - Jobs set up before this existed may already have the item copied by hand; a matching
 *   unlinked invoice line is linked instead of adding a duplicate.
 * - No invoice yet → nothing moves; it happens when staff create the invoice.
 *
 * Returns the number of quote lines moved or linked.
 */
export function moveApprovedQuoteLinesToInvoice(jobId) {
  const jid = parseInt(jobId, 10);
  if (!Number.isFinite(jid) || jid <= 0) return 0;

  const job = db.prepare('SELECT id, is_repeat_job FROM jobs WHERE id = ?').get(jid);
  if (!job || Number(job.is_repeat_job) === 1) return 0;

  const invoice = db
    .prepare("SELECT id FROM invoices WHERE job_id = ? AND type = 'invoice' ORDER BY created_at DESC, id DESC LIMIT 1")
    .get(jid);
  if (!invoice) return 0;

  const pending = db
    .prepare(`
      SELECT qi.*
      FROM invoice_items qi
      JOIN invoices q ON q.id = qi.invoice_id
      WHERE q.job_id = ? AND q.type = 'quote'
        AND COALESCE(qi.approved, 0) = 1
        AND qi.moved_to_invoice_at IS NULL
        AND COALESCE(qi.type, '') NOT IN ('header', 'labour')
      ORDER BY qi.sort_order, qi.id
    `)
    .all(jid);
  if (pending.length === 0) return 0;

  const unlinkedInvoiceLines = db
    .prepare(`
      SELECT id, description FROM invoice_items
      WHERE invoice_id = ? AND quote_item_id IS NULL
        AND COALESCE(type, '') NOT IN ('header', 'labour')
    `)
    .all(invoice.id);

  const insert = db.prepare(`
    INSERT INTO invoice_items (
      invoice_id, description, quantity, unit_price, purchase_price, type, stock_item_id,
      vat_rate, vat_exempt, sort_order, subtext, discount_percent,
      approved, approved_at, quote_item_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, COALESCE(?, datetime('now')), ?)
  `);
  const linkExisting = db.prepare(
    "UPDATE invoice_items SET quote_item_id = ?, approved = 1, approved_at = COALESCE(?, datetime('now')) WHERE id = ?",
  );
  const markMoved = db.prepare("UPDATE invoice_items SET moved_to_invoice_at = datetime('now') WHERE id = ?");
  const stockCost = db.prepare('SELECT cost_price FROM stock_items WHERE id = ?');

  for (const line of pending) {
    const matchIdx = unlinkedInvoiceLines.findIndex((l) => sameDescription(l.description, line.description));
    if (matchIdx !== -1) {
      linkExisting.run(line.id, line.approved_at || null, unlinkedInvoiceLines[matchIdx].id);
      unlinkedInvoiceLines.splice(matchIdx, 1);
    } else {
      const stockId = line.stock_item_id || null;
      const cost = stockId ? Number(stockCost.get(stockId)?.cost_price) || 0 : 0;
      const lineType = stockId ? 'part' : String(line.type || 'other') === 'part' ? 'other' : line.type || 'other';
      insert.run(
        invoice.id,
        line.description,
        line.quantity ?? 1,
        line.unit_price ?? 0,
        cost,
        lineType,
        stockId,
        line.vat_rate ?? 16,
        line.vat_exempt ?? 0,
        nextInvoiceItemSortOrder(db, invoice.id),
        line.subtext || null,
        line.discount_percent || 0,
        line.approved_at || null,
        line.id,
      );
    }
    markMoved.run(line.id);
  }

  syncLabourLinesForJob(jid); // also refreshes invoice totals
  return pending.length;
}
