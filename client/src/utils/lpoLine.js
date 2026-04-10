/** Mirror server lpoLineTotals.js for display (unit cost ex VAT). */

export function lpoLineNet(ln) {
  return (Number(ln.quantity) || 0) * (Number(ln.unit_cost) || 0);
}

export function lpoLineVat(ln) {
  const net = lpoLineNet(ln);
  if (Number(ln.vat_exempt) === 1) return 0;
  const r = Number(ln.vat_rate) || 0;
  if (r <= 0) return 0;
  return Math.round(net * (r / 100) * 100) / 100;
}

export function lpoLineGross(ln) {
  return Math.round((lpoLineNet(ln) + lpoLineVat(ln)) * 100) / 100;
}

export function lpoVatLabel(ln) {
  if (Number(ln.vat_exempt) === 1) return 'Exempt';
  const r = Number(ln.vat_rate) || 0;
  if (r <= 0) return 'No VAT';
  return `${r}%`;
}
