/** LPO line amounts: unit_cost and line totals are exclusive of VAT; VAT is computed on the line net. */

export function normalizeLpoLineVat(input) {
  const exempt = input?.vat_exempt === true || input?.vat_exempt === 1 || input?.vat_exempt === '1';
  let vat_rate = Number(input?.vat_rate);
  if (!Number.isFinite(vat_rate) || vat_rate < 0) vat_rate = 0;
  if (exempt) vat_rate = 0;
  return { vat_rate, vat_exempt: exempt ? 1 : 0 };
}

export function lpoLineNet(line) {
  return (Number(line.quantity) || 0) * (Number(line.unit_cost) || 0);
}

export function lpoLineVat(line) {
  const net = lpoLineNet(line);
  if (Number(line.vat_exempt) === 1) return 0;
  const r = Number(line.vat_rate) || 0;
  if (r <= 0) return 0;
  return Math.round(net * (r / 100) * 100) / 100;
}

export function lpoLineGross(line) {
  return Math.round((lpoLineNet(line) + lpoLineVat(line)) * 100) / 100;
}

/** SQLite expression: gross amount for one lpo_lines row (alias ll). */
export const SQL_LPO_LINE_GROSS =
  '(ll.quantity * ll.unit_cost + CASE WHEN IFNULL(ll.vat_exempt, 0) = 1 THEN 0 ELSE ll.quantity * ll.unit_cost * IFNULL(ll.vat_rate, 0) / 100.0 END)';
