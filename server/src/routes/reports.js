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

function workStoppedAtIso(vehicleReleasedAt, completedAt) {
  const ms = workStoppedInstantMs(vehicleReleasedAt, completedAt);
  return ms != null ? new Date(ms).toISOString() : null;
}

/**
 * Days from job creation until work stopped (first of vehicle release or completion),
 * or until now if the vehicle is still in the garage.
 */
function jobBayDays(createdAt, vehicleReleasedAt, completedAt) {
  const t0 = parseSqlDateTime(createdAt);
  if (t0 == null) return null;
  const stopped = workStoppedInstantMs(vehicleReleasedAt, completedAt);
  const t1 = stopped != null ? stopped : Date.now();
  const ms = t1 - t0;
  if (!Number.isFinite(ms) || ms < 0) return null;
  return Math.round((ms / 86400000) * 100) / 100;
}

/** Collect all repeat-visit job ids under a mother (any depth). */
function collectRepeatJobIdsUnderRoot(rootId) {
  const ids = [];
  const queue = [Number(rootId)];
  const seen = new Set();
  while (queue.length) {
    const parent = queue.shift();
    if (!Number.isFinite(parent) || parent <= 0 || seen.has(parent)) continue;
    seen.add(parent);
    const children = db
      .prepare(`SELECT id FROM jobs WHERE related_job_id = ? AND is_repeat_job = 1`)
      .all(parent);
    for (const c of children) {
      const cid = Number(c.id);
      if (!Number.isFinite(cid) || seen.has(cid)) continue;
      ids.push(cid);
      queue.push(cid);
    }
  }
  return ids;
}

function emptyJobsFinancialSummary() {
  return {
    job_count: 0,
    avg_job_bay_days: null,
    avg_time_to_quote_hours: null,
    sum_revenue: 0,
    sum_total_cost: 0,
    sum_profit: 0,
    profit_margin_pct: null,
    sum_spares_cost: 0,
    sum_spares_revenue: 0,
    avg_spares_margin_pct: null,
    sum_labour_cost: 0,
    sum_labour_revenue: 0,
    avg_labour_margin_pct: null,
    sum_repeat_job_costs: 0,
    avg_customer_rating: null,
  };
}

function loadInvoiceItemsByInvoiceIds(invIds) {
  const itemsByInvoice = new Map();
  if (!invIds.length) return itemsByInvoice;
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
  return itemsByInvoice;
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

  /** Primary (non-repeat) jobs only — repeat visit costs roll into the mother row. */
  const primaryJobs = jobs.filter((j) => Number(j.is_repeat_job) !== 1);

  if (!primaryJobs.length) {
    return res.json({
      date_basis: basis,
      from,
      to,
      rows: [],
      summary: emptyJobsFinancialSummary(),
    });
  }

  const primaryIds = primaryJobs.map((j) => j.id);
  const repeatIds = [];
  const repeatIdsByRoot = new Map();
  for (const rootId of primaryIds) {
    const childIds = collectRepeatJobIdsUnderRoot(rootId);
    repeatIdsByRoot.set(rootId, childIds);
    for (const cid of childIds) repeatIds.push(cid);
  }

  const allJobIdsForInvoices = [...new Set([...primaryIds, ...repeatIds])];
  const placeholders = allJobIdsForInvoices.map(() => '?').join(',');
  const invoices = db
    .prepare(`SELECT * FROM invoices WHERE type = 'invoice' AND job_id IN (${placeholders})`)
    .all(...allJobIdsForInvoices);

  const invByJob = new Map();
  for (const inv of invoices) {
    invByJob.set(inv.job_id, inv);
  }

  const itemsByInvoice = loadInvoiceItemsByInvoiceIds(invoices.map((i) => i.id));

  const linkedRepeatCostsByRoot = new Map();
  for (const rootId of primaryIds) {
    let sum = 0;
    for (const cid of repeatIdsByRoot.get(rootId) || []) {
      const inv = invByJob.get(cid);
      const items = inv ? itemsByInvoice.get(inv.id) || [] : [];
      const finChild = computeInvoiceFinancials(inv || null, items);
      sum += Number(finChild.total_cost) || 0;
    }
    linkedRepeatCostsByRoot.set(rootId, sum);
  }

  const rows = primaryJobs.map((j) => {
    const inv = invByJob.get(j.id);
    const items = inv ? itemsByInvoice.get(inv.id) || [] : [];
    const fin = computeInvoiceFinancials(inv || null, items);
    const timeToQuote = timeToQuoteHours(j.created_at, j.quote_prepared_at);
    const bayDays = jobBayDays(j.created_at, j.vehicle_released_at, j.completed_at);
    const repeatJobCosts = Number(linkedRepeatCostsByRoot.get(j.id)) || 0;
    const ownCost = Number(fin.total_cost) || 0;
    const totalCost = ownCost + repeatJobCosts;
    const revenue = Number(fin.revenue) || 0;
    const profit = revenue - totalCost;
    const profitMarginPct = pct(profit, revenue);
    return {
      job_id: j.id,
      job_number: j.job_number,
      status: j.status,
      created_at: j.created_at,
      completed_at: j.completed_at,
      vehicle_released_at: j.vehicle_released_at ?? null,
      work_stopped_at: workStoppedAtIso(j.vehicle_released_at, j.completed_at),
      quote_prepared_at: j.quote_prepared_at ?? null,
      time_to_quote_hours: timeToQuote,
      job_bay_days: bayDays,
      customer_name: j.customer_name,
      vehicle_label: [j.registration, j.make, j.model].filter(Boolean).join(' '),
      customer_rating: j.customer_rating != null ? Number(j.customer_rating) : null,
      has_invoice: Boolean(inv),
      invoice_number: inv?.invoice_number ?? null,
      revenue,
      labour_cost: Math.round((Number(fin.labour_cost) || 0) * 100) / 100,
      labour_revenue: Math.round((Number(fin.labour_revenue) || 0) * 100) / 100,
      labour_margin_pct: fin.labour_margin_pct,
      spares_cost: Math.round((Number(fin.spares_cost) || 0) * 100) / 100,
      spares_revenue: Math.round((Number(fin.spares_revenue) || 0) * 100) / 100,
      spares_margin_pct: fin.spares_margin_pct,
      repeat_job_costs: Math.round(repeatJobCosts * 100) / 100,
      total_cost: Math.round(totalCost * 100) / 100,
      profit: Math.round(profit * 100) / 100,
      profit_margin_pct: profitMarginPct,
    };
  });

  const sumRevenue = rows.reduce((s, r) => s + (Number(r.revenue) || 0), 0);
  const sumTotalCost = rows.reduce((s, r) => s + (Number(r.total_cost) || 0), 0);
  const sumProfit = rows.reduce((s, r) => s + (Number(r.profit) || 0), 0);
  const sumSparesCost = rows.reduce((s, r) => s + (Number(r.spares_cost) || 0), 0);
  const sumSparesRevenue = rows.reduce((s, r) => s + (Number(r.spares_revenue) || 0), 0);
  const sumLabourCost = rows.reduce((s, r) => s + (Number(r.labour_cost) || 0), 0);
  const sumLabourRevenue = rows.reduce((s, r) => s + (Number(r.labour_revenue) || 0), 0);
  const sumRepeatJobCosts = rows.reduce((s, r) => s + (Number(r.repeat_job_costs) || 0), 0);

  const summary = {
    job_count: rows.length,
    avg_job_bay_days: meanFinite(rows.map((r) => r.job_bay_days)),
    avg_time_to_quote_hours: meanFinite(rows.map((r) => r.time_to_quote_hours)),
    sum_revenue: Math.round(sumRevenue * 100) / 100,
    sum_total_cost: Math.round(sumTotalCost * 100) / 100,
    sum_profit: Math.round(sumProfit * 100) / 100,
    profit_margin_pct: sumRevenue > 0 ? (sumProfit / sumRevenue) * 100 : null,
    sum_spares_cost: Math.round(sumSparesCost * 100) / 100,
    sum_spares_revenue: Math.round(sumSparesRevenue * 100) / 100,
    avg_spares_margin_pct: meanFinite(rows.map((r) => r.spares_margin_pct)),
    sum_labour_cost: Math.round(sumLabourCost * 100) / 100,
    sum_labour_revenue: Math.round(sumLabourRevenue * 100) / 100,
    avg_labour_margin_pct: meanFinite(rows.map((r) => r.labour_margin_pct)),
    sum_repeat_job_costs: Math.round(sumRepeatJobCosts * 100) / 100,
    avg_customer_rating: meanFinite(rows.map((r) => r.customer_rating)),
  };

  res.json({
    date_basis: basis,
    from,
    to,
    rows,
    summary,
  });
});
