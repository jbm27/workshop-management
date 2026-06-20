/** Mirror server invoiceLineTotals.js for display (unit price ex VAT). */

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
