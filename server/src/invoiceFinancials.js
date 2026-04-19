/** Shared invoice P&L (ex-VAT revenue vs internal costs) for job reports and repeat-job costing. */

export function pct(numerator, denominator) {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator === 0) return null;
  return (numerator / denominator) * 100;
}

export function computeInvoiceFinancials(inv, items) {
  if (!inv) {
    return {
      revenue: 0,
      total_cost: 0,
      profit: 0,
      profit_margin_pct: null,
      labour_margin_pct: null,
      spares_margin_pct: null,
    };
  }
  const list = items || [];
  let labourRevenue = 0;
  let labourCost = 0;
  let sparesRevenue = 0;
  let sparesCost = 0;
  for (const it of list) {
    const rev = (Number(it.quantity) || 0) * (Number(it.unit_price) || 0);
    const lpo = Number(it.lpo_allocated_cost) || 0;
    const ipr = Number(it.ipr_allocated_cost) || 0;
    const cost = lpo > 0 || ipr > 0 ? lpo + ipr : (Number(it.quantity) || 0) * (Number(it.purchase_price) || 0);
    const lab = String(it.type || '').toLowerCase() === 'labour';
    if (lab) {
      labourRevenue += rev;
      labourCost += cost;
    } else {
      sparesRevenue += rev;
      sparesCost += cost;
    }
  }
  const sumLineRevenue = list.reduce((s, it) => s + (Number(it.quantity) || 0) * (Number(it.unit_price) || 0), 0);
  const revenue = Number.isFinite(Number(inv.subtotal)) ? Number(inv.subtotal) : sumLineRevenue;
  const totalCost = labourCost + sparesCost;
  const profit = revenue - totalCost;
  return {
    revenue,
    total_cost: totalCost,
    profit,
    profit_margin_pct: pct(profit, revenue),
    labour_margin_pct: pct(labourRevenue - labourCost, labourRevenue),
    spares_margin_pct: pct(sparesRevenue - sparesCost, sparesRevenue),
  };
}
