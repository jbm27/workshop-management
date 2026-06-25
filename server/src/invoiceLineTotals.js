/** Invoice line amounts: unit_price is ex VAT; line and document discounts reduce net before VAT. */

export function normalizeDiscountPercent(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.min(100, n);
}

export function normalizeInvoiceLineVat(input) {
  const exempt = input?.vat_exempt === true || input?.vat_exempt === 1 || input?.vat_exempt === '1';
  let vat_rate;
  if (input?.vat_rate !== undefined && input?.vat_rate !== null && String(input.vat_rate).trim() !== '') {
    vat_rate = Number(input.vat_rate);
  } else if (exempt) {
    vat_rate = 0;
  } else {
    vat_rate = 16;
  }
  if (!Number.isFinite(vat_rate) || vat_rate < 0) vat_rate = 0;
  if (exempt) vat_rate = 0;
  return { vat_rate, vat_exempt: exempt ? 1 : 0 };
}

export function isHeaderLineType(type) {
  return String(type || '').toLowerCase() === 'header';
}

export function invoiceLineGrossBeforeDiscount(line) {
  return (Number(line.quantity) || 0) * (Number(line.unit_price) || 0);
}

export function invoiceLineNet(line) {
  const gross = invoiceLineGrossBeforeDiscount(line);
  const disc = normalizeDiscountPercent(line?.discount_percent);
  return Math.round(gross * (1 - disc / 100) * 100) / 100;
}

export function invoiceLineVat(line) {
  const net = invoiceLineNet(line);
  if (Number(line.vat_exempt) === 1) return 0;
  const r = Number(line.vat_rate) || 0;
  if (r <= 0) return 0;
  return Math.round(net * (r / 100) * 100) / 100;
}

export function invoiceLineGross(line) {
  return Math.round((invoiceLineNet(line) + invoiceLineVat(line)) * 100) / 100;
}

/** Totals from line rows plus optional document-level discount on the invoice. */
export function computeInvoiceTotalsFromLines(lines, docDiscount = {}) {
  let netAfterLineDisc = 0;
  let taxAfterLineDisc = 0;
  let lineDiscountTotal = 0;

  for (const line of lines || []) {
    if (isHeaderLineType(line?.type)) continue;
    const gross = invoiceLineGrossBeforeDiscount(line);
    const net = invoiceLineNet(line);
    lineDiscountTotal += gross - net;
    netAfterLineDisc += net;
    taxAfterLineDisc += invoiceLineVat(line);
  }

  lineDiscountTotal = Math.round(lineDiscountTotal * 100) / 100;
  netAfterLineDisc = Math.round(netAfterLineDisc * 100) / 100;
  taxAfterLineDisc = Math.round(taxAfterLineDisc * 100) / 100;

  let documentDiscountTotal = 0;
  let subtotal = netAfterLineDisc;
  let tax_amount = taxAfterLineDisc;

  const docPct = normalizeDiscountPercent(docDiscount.discount_percent);
  if (docPct > 0) {
    const removed = Math.round(subtotal * (docPct / 100) * 100) / 100;
    documentDiscountTotal = removed;
    const factor = 1 - docPct / 100;
    subtotal = Math.round(subtotal * factor * 100) / 100;
    tax_amount = Math.round(tax_amount * factor * 100) / 100;
  }

  documentDiscountTotal = Math.round(documentDiscountTotal * 100) / 100;
  const total = Math.round((subtotal + tax_amount) * 100) / 100;

  return {
    subtotal,
    tax_amount,
    total,
    line_discount_total: lineDiscountTotal,
    document_discount_total: documentDiscountTotal,
  };
}

/** SQLite expression: VAT amount for one invoice_items row (alias ii). */
export const SQL_INVOICE_LINE_VAT =
  'CASE WHEN IFNULL(ii.vat_exempt, 0) = 1 THEN 0 ELSE ii.quantity * ii.unit_price * (1 - IFNULL(ii.discount_percent, 0) / 100.0) * IFNULL(ii.vat_rate, 0) / 100.0 END';
