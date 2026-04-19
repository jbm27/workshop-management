import { Router } from 'express';
import { db } from '../db.js';
import { requireAdminPermission } from '../auth.js';
import { computeInvoiceFinancials, pct } from '../invoiceFinancials.js';

export const reportsRouter = Router();

reportsRouter.use(requireAdminPermission('can_view_statistics_reports'));

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

function parseSqlDateTime(s) {
  if (s == null || s === '') return null;
  const t = Date.parse(String(s).replace(' ', 'T'));
  return Number.isFinite(t) ? t : null;
}

/** Hours from job creation to first “Send quote” (quote_prepared_at); null if not recorded. */
function timeToQuoteHours(createdAt, quotePreparedAt) {
  const t0 = parseSqlDateTime(createdAt);
  const t1 = parseSqlDateTime(quotePreparedAt);
  if (t0 == null || t1 == null) return null;
  const ms = t1 - t0;
  if (ms < 0) return null;
  return Math.round((ms / 3600000) * 100) / 100;
}

/** Earliest instant of vehicle release or job completion (whichever happened first). */
function workStoppedInstantMs(vehicleReleasedAt, completedAt) {
  const v = parseSqlDateTime(vehicleReleasedAt);
  const c = parseSqlDateTime(completedAt);
  const parts = [];
  if (v != null) parts.push(v);
  if (c != null) parts.push(c);
  if (!parts.length) return null;
  return Math.min(...parts);
}

/** Hours from job creation until work stopped (first of vehicle release or completion). */
function jobBayHours(createdAt, vehicleReleasedAt, completedAt) {
  const t0 = parseSqlDateTime(createdAt);
  const t1 = workStoppedInstantMs(vehicleReleasedAt, completedAt);
  if (t0 == null || t1 == null) return null;
  const ms = t1 - t0;
  if (!Number.isFinite(ms) || ms <= 0) return null;
  return ms / 3600000;
}

/** Invoiced amount for rate: same ex-VAT subtotal as the job report Revenue column (from invoice lines / subtotal). */
function invoicedAmountForRateKes(inv, finRevenue) {
  if (!inv) return null;
  const r = Number(finRevenue);
  if (Number.isFinite(r) && r > 0) return r;
  return null;
}

/** Invoiced KES ÷ job bay hours (creation → first release or completion). */
function revenuePerJobHourKes(inv, finRevenue, createdAt, vehicleReleasedAt, completedAt) {
  const amt = invoicedAmountForRateKes(inv, finRevenue);
  const hours = jobBayHours(createdAt, vehicleReleasedAt, completedAt);
  if (amt == null || hours == null || hours <= 0) return null;
  return Math.round((amt / hours) * 100) / 100;
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
      j.vehicle_released_at,
      j.quote_prepared_at,
      j.customer_rating,
      j.is_repeat_job,
      j.related_job_id,
      rj.job_number AS related_job_number,
      c.name AS customer_name,
      v.registration,
      v.make,
      v.model
    FROM jobs j
    LEFT JOIN customers c ON c.id = j.customer_id
    LEFT JOIN vehicles v ON v.id = j.vehicle_id
    LEFT JOIN jobs rj ON rj.id = j.related_job_id
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
        avg_time_to_quote_hours: null,
        avg_revenue_per_job_hour: null,
        sum_revenue: 0,
        sum_profit: 0,
        aggregate_profit_margin_pct: null,
        sum_repeat_job_costs: 0,
        sum_profit_after_repeat: 0,
        aggregate_profit_margin_after_repeat_pct: null,
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

  const linkedRepeatCostsByParent = new Map();
  for (const j of jobs) {
    if (Number(j.is_repeat_job) !== 1 || !j.related_job_id) continue;
    const pid = Number(j.related_job_id);
    if (!Number.isFinite(pid) || pid <= 0) continue;
    const inv = invByJob.get(j.id);
    const items = inv ? itemsByInvoice.get(inv.id) || [] : [];
    const finChild = computeInvoiceFinancials(inv || null, items);
    const c = Number(finChild.total_cost) || 0;
    linkedRepeatCostsByParent.set(pid, (linkedRepeatCostsByParent.get(pid) || 0) + c);
  }

  const rows = jobs.map((j) => {
    const inv = invByJob.get(j.id);
    const items = inv ? itemsByInvoice.get(inv.id) || [] : [];
    const fin = computeInvoiceFinancials(inv || null, items);
    const timeToQuote = timeToQuoteHours(j.created_at, j.quote_prepared_at);
    const jobBayH = jobBayHours(j.created_at, j.vehicle_released_at, j.completed_at);
    const revPerHour = revenuePerJobHourKes(inv || null, fin.revenue, j.created_at, j.vehicle_released_at, j.completed_at);
    const isRepeat = Number(j.is_repeat_job) === 1;
    const linkedFromChildren = !isRepeat ? Number(linkedRepeatCostsByParent.get(j.id)) || 0 : 0;
    const repeatJobCosts = isRepeat ? Number(fin.total_cost) || 0 : linkedFromChildren;
    const profitAfterRepeat = (Number(fin.profit) || 0) - linkedFromChildren;
    const profitMarginAfterRepeatPct = pct(profitAfterRepeat, fin.revenue);
    return {
      job_id: j.id,
      job_number: j.job_number,
      status: j.status,
      created_at: j.created_at,
      completed_at: j.completed_at,
      vehicle_released_at: j.vehicle_released_at ?? null,
      quote_prepared_at: j.quote_prepared_at ?? null,
      time_to_quote_hours: timeToQuote,
      job_bay_hours: jobBayH != null ? Math.round(jobBayH * 100) / 100 : null,
      revenue_per_job_hour: revPerHour,
      customer_name: j.customer_name,
      vehicle_label: [j.registration, j.make, j.model].filter(Boolean).join(' '),
      customer_rating: j.customer_rating != null ? Number(j.customer_rating) : null,
      has_invoice: Boolean(inv),
      invoice_number: inv?.invoice_number ?? null,
      is_repeat_job: isRepeat,
      related_job_id: j.related_job_id != null ? Number(j.related_job_id) : null,
      related_job_number: j.related_job_number ?? null,
      repeat_job_costs: Math.round(repeatJobCosts * 100) / 100,
      linked_repeat_costs_from_children: Math.round(linkedFromChildren * 100) / 100,
      profit_after_repeat: Math.round(profitAfterRepeat * 100) / 100,
      profit_margin_after_repeat_pct: profitMarginAfterRepeatPct,
      ...fin,
    };
  });

  const withInv = rows.filter((r) => r.has_invoice);
  const sumRevenue = rows.reduce((s, r) => s + (Number(r.revenue) || 0), 0);
  const sumProfit = rows.reduce((s, r) => s + (Number(r.profit) || 0), 0);
  const sumRepeatJobCosts = rows.reduce((s, r) => s + (Number(r.repeat_job_costs) || 0), 0);
  const sumProfitAfterRepeat = rows.reduce((s, r) => s + (Number(r.profit_after_repeat) || 0), 0);
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
    avg_time_to_quote_hours: meanFinite(rows.map((r) => r.time_to_quote_hours)),
    avg_revenue_per_job_hour: meanFinite(rows.map((r) => r.revenue_per_job_hour)),
    sum_revenue: Math.round(sumRevenue * 100) / 100,
    sum_profit: Math.round(sumProfit * 100) / 100,
    aggregate_profit_margin_pct: sumRevenue > 0 ? (sumProfit / sumRevenue) * 100 : null,
    sum_repeat_job_costs: Math.round(sumRepeatJobCosts * 100) / 100,
    sum_profit_after_repeat: Math.round(sumProfitAfterRepeat * 100) / 100,
    aggregate_profit_margin_after_repeat_pct:
      sumRevenue > 0 ? (sumProfitAfterRepeat / sumRevenue) * 100 : null,
  };

  res.json({
    date_basis: basis,
    from,
    to,
    rows,
    summary,
  });
});
