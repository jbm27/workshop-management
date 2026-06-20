/** Invoice line amounts: unit_price and line totals are exclusive of VAT; VAT is computed per line. */

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

export function invoiceLineNet(line) {
  return (Number(line.quantity) || 0) * (Number(line.unit_price) || 0);
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

/** SQLite expression: VAT amount for one invoice_items row (alias ii). */
export const SQL_INVOICE_LINE_VAT =
  'CASE WHEN IFNULL(ii.vat_exempt, 0) = 1 THEN 0 ELSE ii.quantity * ii.unit_price * IFNULL(ii.vat_rate, 0) / 100.0 END';
