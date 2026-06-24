import { db, transactionSync } from './db.js';

function finalizedIprQtyForLine(invoiceItemId, stockItemId) {
  const row = db
    .prepare(
      `
    SELECT COALESCE(SUM(il.quantity), 0) AS q
    FROM ipr_lines il
    JOIN iprs ip ON ip.id = il.ipr_id
    WHERE il.invoice_item_id = ? AND il.stock_item_id = ? AND COALESCE(ip.finalized, 0) = 1
  `,
    )
    .get(invoiceItemId, stockItemId);
  return Number(row?.q) || 0;
}

function stockLabel(stockItemId) {
  const row = db.prepare('SELECT code, name FROM stock_items WHERE id = ?').get(stockItemId);
  if (!row) return `stock #${stockItemId}`;
  const code = String(row.code || '').trim();
  const name = String(row.name || '').trim();
  if (code && name) return `${code} — ${name}`;
  return code || name || `stock #${stockItemId}`;
}

/**
 * Deduct store stock for invoice lines linked to stock_item_id.
 * Skips qty already deducted or covered by finalised IPRs.
 */
export function deductOutstandingStockForInvoice(invoiceId) {
  const inv = db.prepare(`SELECT id, type FROM invoices WHERE id = ?`).get(invoiceId);
  if (!inv || inv.type !== 'invoice') return { deducted: [] };

  const items = db
    .prepare(
      `
    SELECT id, stock_item_id, quantity, COALESCE(stock_deducted_qty, 0) AS stock_deducted_qty, type, description
    FROM invoice_items
    WHERE invoice_id = ? AND stock_item_id IS NOT NULL AND type NOT IN ('labour', 'header')
  `,
    )
    .all(invoiceId);

  const deducted = [];

  transactionSync((tx) => {
    for (const item of items) {
      const stockItemId = Number(item.stock_item_id);
      if (!Number.isFinite(stockItemId) || stockItemId <= 0) continue;

      const lineQty = Number(item.quantity) || 0;
      const already = Number(item.stock_deducted_qty) || 0;
      const iprQty = finalizedIprQtyForLine(item.id, stockItemId);
      const toDeduct = Math.round((lineQty - already - iprQty) * 1000) / 1000;
      if (toDeduct <= 0) continue;

      const out = tx.run(
        `UPDATE stock_items SET quantity = quantity - ?, updated_at = datetime('now') WHERE id = ? AND quantity >= ?`,
        [toDeduct, stockItemId, toDeduct],
      );
      if (!out.changes) {
        throw new Error(`Insufficient stock for ${item.description || stockLabel(stockItemId)}`);
      }

      tx.run(`UPDATE invoice_items SET stock_deducted_qty = COALESCE(stock_deducted_qty, 0) + ? WHERE id = ?`, [
        toDeduct,
        item.id,
      ]);
      deducted.push({ invoiceItemId: item.id, stockItemId, quantity: toDeduct });
    }
  });

  return { deducted };
}

/** Restore stock previously auto-deducted for a line (e.g. before delete). */
export function restoreStockDeductionForInvoiceItem(invoiceItemId) {
  const item = db
    .prepare(`SELECT stock_item_id, COALESCE(stock_deducted_qty, 0) AS stock_deducted_qty FROM invoice_items WHERE id = ?`)
    .get(invoiceItemId);
  if (!item?.stock_item_id) return;
  const qty = Number(item.stock_deducted_qty) || 0;
  if (qty <= 0) return;
  db.prepare(`UPDATE stock_items SET quantity = quantity + ?, updated_at = datetime('now') WHERE id = ?`).run(
    qty,
    item.stock_item_id,
  );
  db.prepare(`UPDATE invoice_items SET stock_deducted_qty = 0 WHERE id = ?`).run(invoiceItemId);
}

export function deductOutstandingStockForJob(jobId) {
  const invoices = db.prepare(`SELECT id FROM invoices WHERE job_id = ? AND type = 'invoice'`).all(jobId);
  const all = [];
  for (const { id } of invoices) {
    const result = deductOutstandingStockForInvoice(id);
    all.push(...result.deducted);
  }
  return { deducted: all };
}
