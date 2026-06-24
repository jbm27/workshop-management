import { invoiceLineNet } from './invoiceLineTotals.js';

export function isHeaderLine(line) {
  return String(line?.type || '').toLowerCase() === 'header';
}

export function sortInvoiceItems(items) {
  return [...items].sort((a, b) => {
    const sa = Number(a.sort_order);
    const sb = Number(b.sort_order);
    const oa = Number.isFinite(sa) ? sa : Number(a.id) || 0;
    const ob = Number.isFinite(sb) ? sb : Number(b.id) || 0;
    if (oa !== ob) return oa - ob;
    return (Number(a.id) || 0) - (Number(b.id) || 0);
  });
}

export function reorderItemsById(items, draggedId, targetId) {
  const sorted = sortInvoiceItems(items);
  const from = sorted.findIndex((i) => Number(i.id) === Number(draggedId));
  const to = sorted.findIndex((i) => Number(i.id) === Number(targetId));
  if (from < 0 || to < 0 || from === to) return sorted;
  const next = [...sorted];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next.map((item, idx) => ({ ...item, sort_order: idx }));
}

/** Flat rows for display/PDF: header rows include sectionNet (ex VAT) for following lines. */
export function enrichItemsWithSectionTotals(items, lineNetFn = invoiceLineNet) {
  const sorted = sortInvoiceItems(items);
  const rows = [];
  let i = 0;
  while (i < sorted.length) {
    const row = sorted[i];
    if (isHeaderLine(row)) {
      let sectionNet = 0;
      let j = i + 1;
      while (j < sorted.length && !isHeaderLine(sorted[j])) {
        sectionNet += lineNetFn(sorted[j]);
        j += 1;
      }
      rows.push({ kind: 'header', item: row, sectionNet });
      i += 1;
      while (i < sorted.length && !isHeaderLine(sorted[i])) {
        rows.push({ kind: 'line', item: sorted[i] });
        i += 1;
      }
    } else {
      rows.push({ kind: 'line', item: row });
      i += 1;
    }
  }
  return rows;
}

export function nextInvoiceItemSortOrder(db, invoiceId) {
  const row = db.prepare('SELECT COALESCE(MAX(sort_order), -1) + 1 AS n FROM invoice_items WHERE invoice_id = ?').get(invoiceId);
  return Number(row?.n) || 0;
}
