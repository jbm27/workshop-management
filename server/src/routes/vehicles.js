import { Router } from 'express';
import { db } from '../db.js';
import { requireAdminAuth } from '../auth.js';
import { computeInvoiceFinancials, pct } from '../invoiceFinancials.js';
import { refreshInvoiceTotalsFromLineItems } from '../jobInvoiceLabour.js';
import { collectRepeatJobIdsUnderRoot, loadInvoiceItemsByInvoiceIds } from './reports.js';

export const vehiclesRouter = Router();

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

/**
 * Full service history for one vehicle: one row per visit (job + its invoice, with repeat visits
 * rolled into the original job, same as the Job Reports page), plus totals across all visits.
 * Profit / cost / margin use the same calculation as Job Reports and are only included for staff
 * who can view statistics reports. Mechanics cannot open it.
 */
vehiclesRouter.get('/:id/service-history', requireAdminAuth, (req, res) => {
  if (req.admin.is_mechanic) return res.status(403).json({ error: 'Not available for workshop staff accounts' });
  const showProfit = Boolean(req.admin.permissions?.can_view_statistics_reports);
  const vehicle = db
    .prepare(`
      SELECT v.*, c.name AS customer_name, c.phone AS customer_phone
      FROM vehicles v LEFT JOIN customers c ON c.id = v.customer_id
      WHERE v.id = ?
    `)
    .get(req.params.id);
  if (!vehicle) return res.status(404).json({ error: 'Vehicle not found' });

  const allJobs = db
    .prepare(`
      SELECT j.id, j.job_number, j.status, j.description, j.created_at, j.completed_at, j.vehicle_released_at,
             j.odometer_in, j.odometer_out, j.is_repeat_job, j.related_job_id, j.customer_rating,
             j.vehicle_tested_at, c.name AS customer_name
      FROM jobs j LEFT JOIN customers c ON c.id = j.customer_id
      WHERE j.vehicle_id = ?
      ORDER BY j.created_at ASC, j.id ASC
    `)
    .all(vehicle.id);
  const primaryJobs = allJobs.filter((j) => Number(j.is_repeat_job) !== 1);

  const timeLogsFor = db.prepare(`
    SELECT tl.admin_user_id, COALESCE(au.display_name, au.username, 'Unknown') AS name, SUM(tl.hours) AS hours
    FROM job_time_logs tl LEFT JOIN admin_users au ON au.id = tl.admin_user_id
    WHERE tl.job_id = ? GROUP BY tl.admin_user_id ORDER BY hours DESC
  `);
  const tasksFor = db.prepare('SELECT description, completed FROM job_tasks WHERE job_id = ? ORDER BY sort_order, id');
  const invoiceFor = db.prepare("SELECT * FROM invoices WHERE job_id = ? AND type = 'invoice' ORDER BY created_at DESC, id DESC LIMIT 1");
  const quoteFor = db.prepare("SELECT id, invoice_number, total FROM invoices WHERE job_id = ? AND type = 'quote' ORDER BY created_at DESC, id DESC LIMIT 1");
  const paidFor = db.prepare('SELECT COALESCE(SUM(amount), 0) AS s FROM invoice_payments WHERE invoice_id = ?');

  const mechanicHours = new Map(); // name -> hours across all visits
  const partCounts = new Map(); // part description -> times fitted
  let prevOdo = null;

  const rows = primaryJobs.map((j) => {
    const repeatIds = collectRepeatJobIdsUnderRoot(j.id);
    const jobIds = [j.id, ...repeatIds];

    const inv = invoiceFor.get(j.id);
    if (inv) {
      const t = refreshInvoiceTotalsFromLineItems(inv.id);
      if (t) Object.assign(inv, t);
    }
    const itemsByInv = loadInvoiceItemsByInvoiceIds(
      jobIds.map((id) => invoiceFor.get(id)?.id).filter(Boolean),
    );
    const items = inv ? itemsByInv.get(inv.id) || [] : [];
    const fin = computeInvoiceFinancials(inv || null, items);
    let repeatCost = 0;
    for (const rid of repeatIds) {
      const rInv = invoiceFor.get(rid);
      if (rInv) repeatCost += Number(computeInvoiceFinancials(rInv, itemsByInv.get(rInv.id) || []).total_cost) || 0;
    }
    const totalCost = (Number(fin.total_cost) || 0) + repeatCost;
    const revenue = Number(fin.revenue) || 0;
    const profit = revenue - totalCost;

    const parts = items
      .filter((it) => {
        const t = String(it.type || '').toLowerCase();
        return t !== 'labour' && t !== 'header';
      })
      .map((it) => ({
        description: it.description,
        quantity: Number(it.quantity) || 0,
        amount: round2((Number(it.quantity) || 0) * (Number(it.unit_price) || 0)),
      }));
    for (const p of parts) {
      const key = String(p.description || '').trim();
      if (key) partCounts.set(key, (partCounts.get(key) || 0) + 1);
    }

    // Labour hours and mechanics across the job and its repeat visits
    const byMech = new Map();
    for (const id of jobIds) {
      for (const r of timeLogsFor.all(id)) {
        byMech.set(r.name, (byMech.get(r.name) || 0) + (Number(r.hours) || 0));
      }
    }
    const mechanics = [...byMech.entries()]
      .map(([name, hours]) => ({ name, hours: round2(hours) }))
      .sort((a, b) => b.hours - a.hours);
    for (const m of mechanics) mechanicHours.set(m.name, (mechanicHours.get(m.name) || 0) + m.hours);
    const labourHours = round2(mechanics.reduce((s, m) => s + m.hours, 0));

    const odoIn = j.odometer_in != null ? Number(j.odometer_in) : null;
    const odoOut = j.odometer_out != null ? Number(j.odometer_out) : null;
    const odo = Number.isFinite(odoOut) && odoOut > 0 ? odoOut : odoIn;
    const kmSincePrev = prevOdo != null && Number.isFinite(odoIn) ? odoIn - prevOdo : null;
    if (Number.isFinite(odo) && odo > 0) prevOdo = odo;

    const paid = inv ? Number(paidFor.get(inv.id)?.s) || 0 : 0;
    const total = inv ? Number(inv.total) || 0 : 0;
    const quote = quoteFor.get(j.id);
    const tasks = tasksFor.all(j.id);

    const row = {
      job_id: j.id,
      job_number: j.job_number,
      status: j.status,
      customer_name: j.customer_name,
      date_in: j.created_at,
      date_out: j.completed_at || j.vehicle_released_at || null,
      odometer_in: odoIn,
      odometer_out: odoOut,
      km_since_previous: kmSincePrev,
      description: j.description,
      tasks: tasks.map((t) => t.description).filter(Boolean),
      parts,
      parts_count: parts.length,
      parts_revenue: round2(fin.spares_revenue),
      labour_revenue: round2(fin.labour_revenue),
      labour_hours: labourHours,
      main_mechanic: mechanics[0]?.name || null,
      mechanics,
      repeat_visits: repeatIds.length,
      quote_total: quote ? round2(quote.total) : null,
      invoice_id: inv?.id ?? null,
      invoice_number: inv?.invoice_number ?? null,
      invoice_total: inv ? round2(total) : null,
      revenue_ex_vat: round2(revenue),
      paid: round2(paid),
      balance: inv ? round2(total - paid) : null,
      vehicle_tested: Boolean(j.vehicle_tested_at),
      customer_rating: j.customer_rating != null ? Number(j.customer_rating) : null,
    };
    if (showProfit) {
      Object.assign(row, {
        parts_cost: round2(fin.spares_cost),
        labour_cost: round2(fin.labour_cost),
        repeat_visit_cost: round2(repeatCost),
        total_cost: round2(totalCost),
        profit: round2(profit),
        profit_margin_pct: pct(profit, revenue),
      });
    }
    return row;
  });

  const sum = (k) => round2(rows.reduce((s, r) => s + (Number(r[k]) || 0), 0));
  const invoiced = rows.filter((r) => r.invoice_id);
  const odos = rows.flatMap((r) => [r.odometer_in, r.odometer_out]).filter((n) => Number.isFinite(n) && n > 0);
  const gaps = rows.map((r) => r.km_since_previous).filter((n) => Number.isFinite(n) && n > 0);
  const summary = {
    visits: rows.length,
    invoiced_visits: invoiced.length,
    total_spent: sum('invoice_total'),
    revenue_ex_vat: sum('revenue_ex_vat'),
    parts_spend: sum('parts_revenue'),
    labour_spend: sum('labour_revenue'),
    labour_hours: sum('labour_hours'),
    paid: sum('paid'),
    outstanding: sum('balance'),
    avg_spend_per_visit: invoiced.length ? round2(sum('invoice_total') / invoiced.length) : null,
    first_visit: rows[0]?.date_in || null,
    last_visit: rows[rows.length - 1]?.date_in || null,
    km_recorded: odos.length >= 2 ? Math.max(...odos) - Math.min(...odos) : null,
    latest_odometer: odos.length ? Math.max(...odos) : null,
    avg_km_between_visits: gaps.length ? Math.round(gaps.reduce((a, b) => a + b, 0) / gaps.length) : null,
    main_mechanic:
      [...mechanicHours.entries()].sort((a, b) => b[1] - a[1]).map(([name, hours]) => ({ name, hours: round2(hours) }))[0] || null,
    top_parts: [...partCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([description, times]) => ({ description, times })),
    next_service: vehicle.next_service_km != null || vehicle.next_service_date
      ? { km: vehicle.next_service_km ?? null, date: vehicle.next_service_date || null }
      : null,
  };
  if (showProfit) {
    const rev = sum('revenue_ex_vat');
    const profit = sum('profit');
    Object.assign(summary, { total_cost: sum('total_cost'), profit, profit_margin_pct: pct(profit, rev) });
  }

  res.json({
    vehicle: {
      id: vehicle.id,
      registration: vehicle.registration,
      make: vehicle.make,
      model: vehicle.model,
      year: vehicle.year,
      vin: vehicle.vin,
      customer_name: vehicle.customer_name,
      customer_phone: vehicle.customer_phone,
    },
    show_profit: showProfit,
    summary,
    rows: rows.reverse(), // newest visit first
  });
});

vehiclesRouter.get('/', (req, res) => {
  const q = (req.query.q || '').trim();
  const customerId = req.query.customer_id;
  let stmt, rows;
  if (customerId) {
    stmt = db.prepare('SELECT v.*, c.name as customer_name FROM vehicles v LEFT JOIN customers c ON v.customer_id = c.id WHERE v.customer_id = ? ORDER BY v.created_at DESC');
    rows = stmt.all(customerId);
  } else if (q) {
    stmt = db.prepare(`
      SELECT v.*, c.name as customer_name FROM vehicles v
      LEFT JOIN customers c ON v.customer_id = c.id
      WHERE v.registration LIKE ? OR v.make LIKE ? OR v.model LIKE ? OR (c.name LIKE ?)
      ORDER BY v.created_at DESC
    `);
    const like = `%${q}%`;
    rows = stmt.all(like, like, like, like);
  } else {
    stmt = db.prepare('SELECT v.*, c.name as customer_name FROM vehicles v LEFT JOIN customers c ON v.customer_id = c.id ORDER BY v.created_at DESC');
    rows = stmt.all();
  }
  res.json(rows);
});

vehiclesRouter.get('/:id', (req, res) => {
  const row = db.prepare(`
    SELECT v.*, c.name as customer_name, c.phone as customer_phone, c.email as customer_email
    FROM vehicles v LEFT JOIN customers c ON v.customer_id = c.id
    WHERE v.id = ?
  `).get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Vehicle not found' });
  res.json(row);
});

vehiclesRouter.post('/', (req, res) => {
  const { customer_id, registration, make, model, year, vin, odometer, notes } = req.body;
  const result = db.prepare(`
    INSERT INTO vehicles (customer_id, registration, make, model, year, vin, odometer, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(customer_id || null, registration || null, make || null, model || null, year || null, vin || null, odometer || null, notes || null);
  const row = db.prepare('SELECT v.*, c.name as customer_name FROM vehicles v LEFT JOIN customers c ON v.customer_id = c.id WHERE v.id = ?').get(result.lastInsertRowid);
  res.status(201).json(row);
});

vehiclesRouter.patch('/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM vehicles WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Vehicle not found' });
  const { customer_id, registration, make, model, year, vin, odometer, notes } = req.body;
  db.prepare(`
    UPDATE vehicles SET customer_id = ?, registration = ?, make = ?, model = ?, year = ?, vin = ?, odometer = ?, notes = ?, updated_at = datetime('now')
    WHERE id = ?
  `).run(
    customer_id ?? row.customer_id,
    registration ?? row.registration,
    make ?? row.make,
    model ?? row.model,
    year ?? row.year,
    vin ?? row.vin,
    odometer ?? row.odometer,
    notes ?? row.notes,
    req.params.id
  );
  // Next service due: only touched when sent; empty clears it.
  if ('next_service_km' in req.body || 'next_service_date' in req.body) {
    const km = 'next_service_km' in req.body ? req.body.next_service_km : row.next_service_km;
    const kmNum = km === '' || km == null ? null : Math.round(Number(km));
    if (kmNum != null && (!Number.isFinite(kmNum) || kmNum < 0)) {
      return res.status(400).json({ error: 'next_service_km must be a positive number' });
    }
    const date = 'next_service_date' in req.body ? req.body.next_service_date : row.next_service_date;
    const dateStr = date ? String(date).trim().slice(0, 10) : null;
    if (dateStr && !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
      return res.status(400).json({ error: 'next_service_date must be YYYY-MM-DD' });
    }
    db.prepare('UPDATE vehicles SET next_service_km = ?, next_service_date = ? WHERE id = ?').run(kmNum, dateStr || null, req.params.id);
  }
  res.json(db.prepare('SELECT v.*, c.name as customer_name FROM vehicles v JOIN customers c ON v.customer_id = c.id WHERE v.id = ?').get(req.params.id));
});

vehiclesRouter.delete('/:id', (req, res) => {
  const result = db.prepare('DELETE FROM vehicles WHERE id = ?').run(req.params.id);
  if (result.changes === 0) return res.status(404).json({ error: 'Vehicle not found' });
  res.status(204).send();
});
