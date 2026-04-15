import { Router } from 'express';
import { db } from '../db.js';

export const reportsRouter = Router();

// Dashboard summary
reportsRouter.get('/dashboard', (req, res) => {
  const jobsByStatus = db.prepare(`
    SELECT status, COUNT(*) as count FROM jobs GROUP BY status
  `).all();
  const pendingJobs = db.prepare(`
    SELECT COUNT(*) as count FROM jobs WHERE status IN ('in_progress', 'vehicle_released')
  `).get();
  const overdueInvoices = db.prepare(`
    SELECT COUNT(*) as count FROM invoices
    WHERE type = 'invoice' AND status NOT IN ('paid', 'cancelled') AND due_date < date('now')
  `).get();
  const revenueThisMonth = db.prepare(`
    SELECT COALESCE(SUM(total), 0) as total FROM invoices
    WHERE type = 'invoice' AND status = 'paid' AND strftime('%Y-%m', paid_at) = strftime('%Y-%m', 'now')
  `).get();
  res.json({
    jobsByStatus,
    pendingJobs: pendingJobs.count,
    overdueInvoices: overdueInvoices.count,
    revenueThisMonth: revenueThisMonth.total,
  });
});

// Sales summary (optional date range)
reportsRouter.get('/sales', (req, res) => {
  const from = req.query.from || new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().slice(0, 10);
  const to = req.query.to || new Date().toISOString().slice(0, 10);
  const rows = db.prepare(`
    SELECT date(paid_at) as date, COUNT(*) as count, SUM(total) as total
    FROM invoices WHERE type = 'invoice' AND status = 'paid' AND paid_at >= ? AND paid_at <= ?
    GROUP BY date(paid_at) ORDER BY date
  `).all(from, to + 'T23:59:59');
  res.json(rows);
});

// Customer feedback report (optional date range, filtered by completed_at)
reportsRouter.get('/feedback', (req, res) => {
  const from = req.query.from || ''; // ISO date yyyy-mm-dd
  const to = req.query.to || '';

  let where = 'WHERE (j.customer_feedback IS NOT NULL OR j.customer_rating IS NOT NULL)';
  const params = [];

  if (from) {
    where += ' AND date(j.completed_at) >= ?';
    params.push(from);
  }
  if (to) {
    where += ' AND date(j.completed_at) <= ?';
    params.push(to);
  }

  const rows = db.prepare(
    `
    SELECT
      j.id,
      j.job_number,
      j.status,
      j.completed_at,
      j.customer_rating,
      j.customer_feedback,
      c.name AS customer_name,
      v.registration,
      v.make,
      v.model
    FROM jobs j
    LEFT JOIN customers c ON j.customer_id = c.id
    LEFT JOIN vehicles v ON j.vehicle_id = v.id
    ${where}
    ORDER BY j.completed_at DESC, j.created_at DESC
  `,
  ).all(...params);

  const rated = rows.filter((r) => r.customer_rating != null);
  const count = rated.length;
  const avg =
    count > 0 ? rated.reduce((sum, r) => sum + Number(r.customer_rating || 0), 0) / count : 0;

  res.json({
    rows,
    summary: {
      count,
      avg_rating: avg, // 0–5, may be fractional
    },
  });
});

function meanFinite(values) {
  const nums = values.filter((v) => v != null && Number.isFinite(v));
  if (!nums.length) return null;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

function pct(numerator, denominator) {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator === 0) return null;
  return (numerator / denominator) * 100;
}

function computeInvoiceFinancials(inv, items) {
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

/** Jobs in a date window with invoice P&L (same basis as the job card Job Report). */
reportsRouter.get('/jobs-financial', (req, res) => {
  const basis = String(req.query.date_basis || 'created').toLowerCase() === 'completed' ? 'completed' : 'created';
  const from = String(req.query.from || '').trim();
  const to = String(req.query.to || '').trim();
  if (!from || !to) {
    return res.status(400).json({ error: 'from and to are required (YYYY-MM-DD)' });
  }

  let where;
  const params = [from, to];
  if (basis === 'completed') {
    where = `WHERE j.completed_at IS NOT NULL AND date(j.completed_at) >= ? AND date(j.completed_at) <= ?`;
  } else {
    where = `WHERE date(j.created_at) >= ? AND date(j.created_at) <= ?`;
  }

  const jobs = db
    .prepare(
      `
    SELECT
      j.id,
      j.job_number,
      j.status,
      j.created_at,
      j.completed_at,
      j.customer_rating,
      c.name AS customer_name,
      v.registration,
      v.make,
      v.model
    FROM jobs j
    LEFT JOIN customers c ON c.id = j.customer_id
    LEFT JOIN vehicles v ON v.id = j.vehicle_id
    ${where}
    ORDER BY j.created_at DESC, j.id DESC
  `,
    )
    .all(...params);

  if (!jobs.length) {
    return res.json({
      date_basis: basis,
      from,
      to,
      rows: [],
      summary: {
        job_count: 0,
        jobs_with_invoice: 0,
        avg_revenue: null,
        avg_total_cost: null,
        avg_profit: null,
        avg_profit_margin_pct: null,
        avg_labour_margin_pct: null,
        avg_spares_margin_pct: null,
        avg_customer_rating: null,
        sum_revenue: 0,
        sum_profit: 0,
        aggregate_profit_margin_pct: null,
      },
    });
  }

  const jobIds = jobs.map((j) => j.id);
  const placeholders = jobIds.map(() => '?').join(',');
  const invoices = db
    .prepare(`SELECT * FROM invoices WHERE type = 'invoice' AND job_id IN (${placeholders})`)
    .all(...jobIds);

  const invByJob = new Map();
  for (const inv of invoices) {
    invByJob.set(inv.job_id, inv);
  }

  const invIds = invoices.map((i) => i.id);
  const itemsByInvoice = new Map();
  if (invIds.length) {
    const iph = invIds.map(() => '?').join(',');
    const itemRows = db
      .prepare(
        `
      SELECT
        ii.id,
        ii.invoice_id,
        ii.description,
        ii.quantity,
        ii.unit_price,
        ii.purchase_price,
        ii.type,
        (SELECT COALESCE(SUM(ll.quantity * ll.unit_cost), 0) FROM lpo_lines ll WHERE ll.invoice_item_id = ii.id) AS lpo_allocated_cost,
        (SELECT COALESCE(SUM(il.quantity * il.unit_cost), 0) FROM ipr_lines il WHERE il.invoice_item_id = ii.id) AS ipr_allocated_cost
      FROM invoice_items ii
      WHERE ii.invoice_id IN (${iph})
    `,
      )
      .all(...invIds);
    for (const row of itemRows) {
      const id = row.invoice_id;
      if (!itemsByInvoice.has(id)) itemsByInvoice.set(id, []);
      itemsByInvoice.get(id).push(row);
    }
  }

  const rows = jobs.map((j) => {
    const inv = invByJob.get(j.id);
    const items = inv ? itemsByInvoice.get(inv.id) || [] : [];
    const fin = computeInvoiceFinancials(inv || null, items);
    return {
      job_id: j.id,
      job_number: j.job_number,
      status: j.status,
      created_at: j.created_at,
      completed_at: j.completed_at,
      customer_name: j.customer_name,
      vehicle_label: [j.registration, j.make, j.model].filter(Boolean).join(' '),
      customer_rating: j.customer_rating != null ? Number(j.customer_rating) : null,
      has_invoice: Boolean(inv),
      invoice_number: inv?.invoice_number ?? null,
      ...fin,
    };
  });

  const withInv = rows.filter((r) => r.has_invoice);
  const sumRevenue = rows.reduce((s, r) => s + (Number(r.revenue) || 0), 0);
  const sumProfit = rows.reduce((s, r) => s + (Number(r.profit) || 0), 0);
  const summary = {
    job_count: rows.length,
    jobs_with_invoice: withInv.length,
    avg_revenue: meanFinite(rows.map((r) => r.revenue)),
    avg_total_cost: meanFinite(rows.map((r) => r.total_cost)),
    avg_profit: meanFinite(rows.map((r) => r.profit)),
    avg_profit_margin_pct: meanFinite(rows.map((r) => r.profit_margin_pct)),
    avg_labour_margin_pct: meanFinite(rows.map((r) => r.labour_margin_pct)),
    avg_spares_margin_pct: meanFinite(rows.map((r) => r.spares_margin_pct)),
    avg_customer_rating: meanFinite(rows.map((r) => r.customer_rating)),
    sum_revenue: Math.round(sumRevenue * 100) / 100,
    sum_profit: Math.round(sumProfit * 100) / 100,
    aggregate_profit_margin_pct: sumRevenue > 0 ? (sumProfit / sumRevenue) * 100 : null,
  };

  res.json({
    date_basis: basis,
    from,
    to,
    rows,
    summary,
  });
});
