/** Mirror server invoiceLineTotals.js for display (unit price ex VAT). */

export function normalizeDiscountPercent(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.min(100, n);
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

export function invoiceVatLabel(line) {
  if (Number(line.vat_exempt) === 1) return 'Exempt';
  const r = Number(line.vat_rate) || 0;
  if (r <= 0) return 'No VAT';
  return `${r}%`;
}

export function defaultInvoiceLineVatFields() {
  return { vat_mode: 'standard', vat_rate_custom: '' };
}

export function vatModeFromLine(line) {
  const ex = Number(line?.vat_exempt) === 1;
  const rate = Number(line?.vat_rate) || 0;
  if (ex) return { vat_mode: 'exempt', vat_rate_custom: '' };
  if (rate === 16) return { vat_mode: 'standard', vat_rate_custom: '' };
  if (rate === 0) return { vat_mode: 'none', vat_rate_custom: '' };
  return { vat_mode: 'custom', vat_rate_custom: String(rate) };
}

export function parseVatPayload({ vat_mode, vat_rate_custom }) {
  let vat_exempt = false;
  let vat_rate = 0;
  if (vat_mode === 'exempt') vat_exempt = true;
  else if (vat_mode === 'standard') vat_rate = 16;
  else if (vat_mode === 'custom') {
    vat_rate = Number(vat_rate_custom);
    if (!Number.isFinite(vat_rate) || vat_rate < 0 || vat_rate > 100) {
      throw new Error('Enter a VAT rate between 0 and 100');
    }
  }
  return { vat_rate, vat_exempt };
}

export function vatFromFormData(fd) {
  return parseVatPayload({
    vat_mode: fd.get('vat_mode') || 'standard',
    vat_rate_custom: fd.get('vat_rate_custom'),
  });
}

export function vatFromElementIds(idPrefix) {
  return parseVatPayload({
    vat_mode: document.getElementById(`${idPrefix}-vat-mode`)?.value || 'standard',
    vat_rate_custom: document.getElementById(`${idPrefix}-vat-custom`)?.value,
  });
}
