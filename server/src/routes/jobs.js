import { Router } from 'express';
import { db } from '../db.js';
import { requireAdminAuth } from '../auth.js';
import { getAverageLabourCostPerHour } from '../workshopSettings.js';

export const jobsRouter = Router();

function nextJobNumber() {
  const row = db.prepare('SELECT value FROM sequences WHERE name = ?').get('job_number');
  const next = (row?.value ?? 1000) + 1;
  db.prepare('UPDATE sequences SET value = ? WHERE name = ?').run(next, 'job_number');
  return `J${next}`;
}

const jobDetailSql = `
  SELECT j.*, v.registration, v.make, v.model, v.vin,
    c.name as customer_name, c.phone as customer_phone, c.email as customer_email
  FROM jobs j
  JOIN vehicles v ON j.vehicle_id = v.id
  LEFT JOIN customers c ON j.customer_id = c.id
  WHERE j.id = ?
`;

function fullJob(jobId) {
  const job = db.prepare(jobDetailSql).get(jobId);
  if (!job) return null;
  const tasks = db
    .prepare('SELECT id, description, sort_order, completed FROM job_tasks WHERE job_id = ? ORDER BY sort_order, id')
    .all(jobId);
  const test_drives = db
    .prepare('SELECT id, odometer, fuel, created_at FROM job_test_drives WHERE job_id = ? ORDER BY id ASC')
    .all(jobId);
  const time_logs = db
    .prepare(
      `
      SELECT tl.*, au.display_name AS admin_display_name, au.username AS admin_username
      FROM job_time_logs tl
      JOIN admin_users au ON au.id = tl.admin_user_id
      WHERE tl.job_id = ?
      ORDER BY tl.worked_at DESC, tl.id DESC
    `,
    )
    .all(jobId);
  const average_labour_cost_per_hour = getAverageLabourCostPerHour();
  const total_labour_hours = time_logs.reduce((s, tl) => s + (Number(tl.hours) || 0), 0);
  const total_labour_cost = Math.round(total_labour_hours * average_labour_cost_per_hour * 100) / 100;
  return {
    ...job,
    tasks,
    test_drives,
    time_logs,
    average_labour_cost_per_hour,
    total_labour_hours,
    total_labour_cost,
  };
}

const TEST_DRIVE_FUEL_LEVELS = ['Empty', '1/4', '1/2', '3/4', 'Full'];

jobsRouter.get('/', (req, res) => {
  const status = req.query.status;
  const q = (req.query.q || '').trim();
  let stmt, rows;
  const taskCountSelect = '(SELECT COUNT(*) FROM job_tasks WHERE job_id = j.id) as task_count';
  if (status) {
    stmt = db.prepare(`
      SELECT j.*, v.registration, v.make, v.model, c.name as customer_name, ${taskCountSelect}
      FROM jobs j
      JOIN vehicles v ON j.vehicle_id = v.id
      LEFT JOIN customers c ON j.customer_id = c.id
      WHERE j.status = ?
      ORDER BY j.created_at DESC
    `);
    rows = stmt.all(status);
  } else if (q) {
    stmt = db.prepare(`
      SELECT j.*, v.registration, v.make, v.model, c.name as customer_name, ${taskCountSelect}
      FROM jobs j
      JOIN vehicles v ON j.vehicle_id = v.id
      LEFT JOIN customers c ON j.customer_id = c.id
      LEFT JOIN job_tasks jtk ON jtk.job_id = j.id
      WHERE j.job_number LIKE ? OR jtk.description LIKE ? OR v.registration LIKE ? OR (c.name LIKE ?)
      GROUP BY j.id
      ORDER BY j.created_at DESC
    `);
    const like = `%${q}%`;
    rows = stmt.all(like, like, like, like);
  } else {
    stmt = db.prepare(`
      SELECT j.*, v.registration, v.make, v.model, c.name as customer_name, ${taskCountSelect}
      FROM jobs j
      JOIN vehicles v ON j.vehicle_id = v.id
      LEFT JOIN customers c ON j.customer_id = c.id
      ORDER BY j.created_at DESC
    `);
    rows = stmt.all();
  }
  res.json(rows);
});

jobsRouter.get('/time-logs/mine', requireAdminAuth, (req, res) => {
  const date = String(req.query.date || '').trim();
  const hasDate = /^\d{4}-\d{2}-\d{2}$/.test(date);
  const sql = hasDate
    ? `
      SELECT tl.*, j.job_number, v.registration, v.make, v.model
      FROM job_time_logs tl
      JOIN jobs j ON j.id = tl.job_id
      JOIN vehicles v ON v.id = j.vehicle_id
      WHERE tl.admin_user_id = ?
        AND date(tl.worked_at) = ?
      ORDER BY tl.worked_at DESC, tl.id DESC
    `
    : `
      SELECT tl.*, j.job_number, v.registration, v.make, v.model
      FROM job_time_logs tl
      JOIN jobs j ON j.id = tl.job_id
      JOIN vehicles v ON v.id = j.vehicle_id
      WHERE tl.admin_user_id = ?
      ORDER BY tl.worked_at DESC, tl.id DESC
    `;
  const rows = hasDate
    ? db.prepare(sql).all(req.admin.id, date)
    : db.prepare(sql).all(req.admin.id);
  res.json(rows);
});

/** Create a workshop job from a standalone quote (no job yet) and link the quote to it. */
jobsRouter.post('/from-quote', requireAdminAuth, (req, res) => {
  const quoteId = Number(req.body?.quote_id);
  if (!Number.isFinite(quoteId)) return res.status(400).json({ error: 'quote_id is required' });
  const inv = db.prepare('SELECT * FROM invoices WHERE id = ?').get(quoteId);
  if (!inv) return res.status(404).json({ error: 'Quote not found' });
  if (inv.type !== 'quote') return res.status(400).json({ error: 'Only a quote can start a job this way' });
  if (inv.job_id) return res.status(400).json({ error: 'This quote is already linked to a job' });

  let vehicleId = inv.vehicle_id != null ? Number(inv.vehicle_id) : null;
  if (req.body?.vehicle_id != null && String(req.body.vehicle_id).trim() !== '') {
    vehicleId = Number(req.body.vehicle_id);
  }
  if (!vehicleId || !Number.isFinite(vehicleId)) {
    return res.status(400).json({ error: 'A vehicle is required (link one on the quote or choose when starting the job)' });
  }
  const veh = db.prepare('SELECT id, customer_id FROM vehicles WHERE id = ?').get(vehicleId);
  if (!veh) return res.status(404).json({ error: 'Vehicle not found' });
  if (Number(veh.customer_id) !== Number(inv.customer_id)) {
    return res.status(400).json({ error: 'Vehicle must belong to the quote customer' });
  }

  const extraNotes = req.body?.notes != null ? String(req.body.notes).trim() : '';
  const quoteNote = inv.invoice_number ? `Opened from quote ${inv.invoice_number}.` : '';
  const notes = [quoteNote, extraNotes].filter(Boolean).join('\n\n') || null;

  const odometer_in = req.body?.odometer_in != null && req.body.odometer_in !== '' ? Number(req.body.odometer_in) : null;
  const odometer_out = req.body?.odometer_out != null && req.body.odometer_out !== '' ? Number(req.body.odometer_out) : null;
  const fuel_in = req.body?.fuel_in ? String(req.body.fuel_in).trim() : null;
  const fuel_out = req.body?.fuel_out ? String(req.body.fuel_out).trim() : null;
  const valuables_in_vehicle = req.body?.valuables_in_vehicle ? String(req.body.valuables_in_vehicle).trim() : null;
  const due_date = req.body?.due_date ? String(req.body.due_date).trim() : null;

  const job_number = nextJobNumber();
  const result = db.prepare(`
    INSERT INTO jobs (job_number, vehicle_id, customer_id, notes, odometer_in, odometer_out, fuel_in, fuel_out, valuables_in_vehicle, due_date, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'in_progress')
  `).run(
    job_number,
    vehicleId,
    inv.customer_id,
    notes,
    Number.isFinite(odometer_in) ? odometer_in : null,
    Number.isFinite(odometer_out) ? odometer_out : null,
    fuel_in || null,
    fuel_out || null,
    valuables_in_vehicle || null,
    due_date || null,
  );
  const jobId = result.lastInsertRowid;
  db.prepare('UPDATE invoices SET job_id = ?, vehicle_id = ?, updated_at = datetime("now") WHERE id = ?').run(jobId, vehicleId, inv.id);

  const job = fullJob(jobId);
  const invoiceRow = db
    .prepare(`
    SELECT i.*, c.name as customer_name, v.registration, v.make, v.model
    FROM invoices i JOIN customers c ON i.customer_id = c.id LEFT JOIN vehicles v ON i.vehicle_id = v.id
    WHERE i.id = ?
  `)
    .get(inv.id);
  const invItems = db.prepare('SELECT * FROM invoice_items WHERE invoice_id = ? ORDER BY id').all(inv.id);
  res.status(201).json({ job, invoice: { ...invoiceRow, items: invItems } });
});

jobsRouter.get('/:id', (req, res) => {
  const job = fullJob(req.params.id);
  if (!job) return res.status(404).json({ error: 'Job not found' });
  res.json(job);
});

jobsRouter.post('/:id/test-drives', (req, res) => {
  const row = db.prepare('SELECT id, odometer_in FROM jobs WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Job not found' });
  const { odometer, fuel } = req.body;
  const odo = Number(odometer);
  if (!Number.isFinite(odo) || odo < 0) return res.status(400).json({ error: 'Valid odometer (km) on return to workshop is required' });
  if (!fuel || !TEST_DRIVE_FUEL_LEVELS.includes(fuel)) {
    return res.status(400).json({ error: 'Fuel level is required (Empty, 1/4, 1/2, 3/4, or Full)' });
  }
  const lastTd = db
    .prepare('SELECT odometer FROM job_test_drives WHERE job_id = ? ORDER BY id DESC LIMIT 1')
    .get(req.params.id);
  const baseline = lastTd ? Number(lastTd.odometer) : Number(row.odometer_in);
  if (!Number.isFinite(baseline)) {
    return res.status(400).json({ error: 'Set mileage in (km) before adding a test drive' });
  }
  if (odo < baseline) {
    return res.status(400).json({
      error: 'Odometer must be at or above the previous reading (mileage in or last test drive return)',
    });
  }
  db.prepare('INSERT INTO job_test_drives (job_id, odometer, fuel) VALUES (?, ?, ?)').run(req.params.id, Math.round(odo), fuel);
  res.status(201).json(fullJob(req.params.id));
});

jobsRouter.delete('/:id/test-drives/:tdId', (req, res) => {
  const td = db.prepare('SELECT id FROM job_test_drives WHERE id = ? AND job_id = ?').get(req.params.tdId, req.params.id);
  if (!td) return res.status(404).json({ error: 'Test drive not found' });
  db.prepare('DELETE FROM job_test_drives WHERE id = ?').run(req.params.tdId);
  const job = fullJob(req.params.id);
  if (!job) return res.status(404).json({ error: 'Job not found' });
  res.json(job);
});

jobsRouter.post('/:id/time-logs', requireAdminAuth, (req, res) => {
  const row = db.prepare('SELECT id FROM jobs WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Job not found' });
  const hours = Number(req.body?.hours);
  if (!Number.isFinite(hours) || hours <= 0) return res.status(400).json({ error: 'hours must be a positive number' });
  const workedAtRaw = req.body?.worked_at != null ? String(req.body.worked_at).trim() : '';
  const workedAt = workedAtRaw || null;
  db.prepare(
    `INSERT INTO job_time_logs (job_id, admin_user_id, hours, notes, worked_at)
     VALUES (?, ?, ?, ?, COALESCE(?, datetime('now')))`,
  ).run(req.params.id, req.admin.id, hours, req.body?.notes ? String(req.body.notes).trim() : null, workedAt);
  res.status(201).json(fullJob(req.params.id));
});

jobsRouter.delete('/:id/time-logs/:logId', requireAdminAuth, (req, res) => {
  const log = db.prepare('SELECT * FROM job_time_logs WHERE id = ? AND job_id = ?').get(req.params.logId, req.params.id);
  if (!log) return res.status(404).json({ error: 'Time log not found' });
  const isOwner = Number(log.admin_user_id) === Number(req.admin.id);
  if (!isOwner && !req.admin.permissions?.can_manage_team_members) {
    return res.status(403).json({ error: 'You can only remove your own time logs' });
  }
  db.prepare('DELETE FROM job_time_logs WHERE id = ?').run(req.params.logId);
  res.json(fullJob(req.params.id));
});

jobsRouter.post('/', (req, res) => {
  const { vehicle_id, customer_id, notes, odometer_in, odometer_out, fuel_in, fuel_out, valuables_in_vehicle, due_date, tasks } = req.body;
  if (!vehicle_id) return res.status(400).json({ error: 'vehicle_id is required' });
  if (!customer_id) return res.status(400).json({ error: 'customer_id is required (bill-to for this job)' });
  const job_number = nextJobNumber();
  const result = db.prepare(`
    INSERT INTO jobs (job_number, vehicle_id, customer_id, notes, odometer_in, odometer_out, fuel_in, fuel_out, valuables_in_vehicle, due_date, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'in_progress')
  `).run(
    job_number,
    vehicle_id,
    customer_id || null,
    notes || null,
    odometer_in || null,
    odometer_out || null,
    fuel_in || null,
    fuel_out || null,
    valuables_in_vehicle || null,
    due_date || null,
  );
  const jobId = result.lastInsertRowid;
  if (Array.isArray(tasks) && tasks.length) {
    const ins = db.prepare('INSERT INTO job_tasks (job_id, description, sort_order, completed) VALUES (?, ?, ?, ?)');
    tasks.forEach((t, i) => {
      const desc = typeof t === 'string' ? t : (t.description || '');
      const completed = typeof t === 'object' && t !== null ? (t.completed ? 1 : 0) : 0;
      if (desc.trim()) ins.run(jobId, desc.trim(), i, completed);
    });
  }
  const out = fullJob(jobId);
  res.status(201).json(out);
});

jobsRouter.patch('/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM jobs WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Job not found' });
  const { status, customer_id, notes, odometer_in, odometer_out, fuel_in, fuel_out, valuables_in_vehicle, due_date, completed_at, tasks } = req.body;
  db.prepare(`
    UPDATE jobs SET status = ?, customer_id = ?, notes = ?, odometer_in = ?, odometer_out = ?, fuel_in = ?, fuel_out = ?, valuables_in_vehicle = ?, due_date = ?, completed_at = ?, updated_at = datetime('now')
    WHERE id = ?
  `).run(
    status ?? row.status,
    customer_id !== undefined ? customer_id : row.customer_id,
    notes ?? row.notes,
    odometer_in !== undefined ? odometer_in : row.odometer_in,
    odometer_out !== undefined ? odometer_out : row.odometer_out,
    fuel_in !== undefined ? fuel_in : row.fuel_in,
    fuel_out !== undefined ? fuel_out : row.fuel_out,
    valuables_in_vehicle !== undefined ? valuables_in_vehicle : row.valuables_in_vehicle,
    due_date ?? row.due_date,
    completed_at ?? row.completed_at,
    req.params.id
  );
  if (Array.isArray(tasks)) {
    db.prepare('DELETE FROM job_tasks WHERE job_id = ?').run(req.params.id);
    if (tasks.length) {
      const ins = db.prepare('INSERT INTO job_tasks (job_id, description, sort_order, completed) VALUES (?, ?, ?, ?)');
      tasks.forEach((t, i) => {
        const desc = typeof t === 'string' ? t : (t.description || '');
        const completed = typeof t === 'object' && t !== null ? (t.completed ? 1 : 0) : 0;
        if (desc.trim()) ins.run(req.params.id, desc.trim(), i, completed);
      });
    }
  }
  const updated = fullJob(req.params.id);
  res.json(updated);
});

function nextQuoteNumber() {
  const row = db.prepare('SELECT value FROM sequences WHERE name = ?').get('quote_number');
  const next = (row?.value ?? 1000) + 1;
  db.prepare('UPDATE sequences SET value = ? WHERE name = ?').run(next, 'quote_number');
  return `QUO-${next}`;
}

function nextInvoiceNumber() {
  const row = db.prepare('SELECT value FROM sequences WHERE name = ?').get('invoice_number');
  const next = (row?.value ?? 1000) + 1;
  db.prepare('UPDATE sequences SET value = ? WHERE name = ?').run(next, 'invoice_number');
  return `INV-${next}`;
}

jobsRouter.post('/:id/quote', (req, res) => {
  const job = db.prepare('SELECT id, customer_id, vehicle_id FROM jobs WHERE id = ?').get(req.params.id);
  if (!job) return res.status(404).json({ error: 'Job not found' });
  const existing = db.prepare('SELECT id FROM invoices WHERE job_id = ? AND type = ?').get(req.params.id, 'quote');
  if (existing) return res.status(400).json({ error: 'This job already has a quote' });
  const quote_number = nextQuoteNumber();
  const taxRate = 0.16;
  const result = db.prepare(`
    INSERT INTO invoices (invoice_number, job_id, customer_id, vehicle_id, type, tax_rate)
    VALUES (?, ?, ?, ?, 'quote', ?)
  `).run(quote_number, req.params.id, job.customer_id, job.vehicle_id, taxRate);
  const invId = result.lastInsertRowid;
  db.prepare('UPDATE invoices SET subtotal = 0, tax_amount = 0, total = 0 WHERE id = ?').run(invId);
  const row = db.prepare(`
    SELECT i.*, c.name as customer_name, v.registration
    FROM invoices i JOIN customers c ON i.customer_id = c.id LEFT JOIN vehicles v ON i.vehicle_id = v.id
    WHERE i.id = ?
  `).get(invId);
  const items = db.prepare('SELECT * FROM invoice_items WHERE invoice_id = ? ORDER BY id').all(invId);
  res.status(201).json({ ...row, items });
});

jobsRouter.post('/:id/invoice', (req, res) => {
  const job = db.prepare('SELECT id, customer_id, vehicle_id FROM jobs WHERE id = ?').get(req.params.id);
  if (!job) return res.status(404).json({ error: 'Job not found' });
  const existing = db.prepare('SELECT id FROM invoices WHERE job_id = ? AND type = ?').get(req.params.id, 'invoice');
  if (existing) return res.status(400).json({ error: 'This job already has an invoice' });
  const invoice_number = nextInvoiceNumber();
  const taxRate = 0.16;
  const result = db.prepare(`
    INSERT INTO invoices (invoice_number, job_id, customer_id, vehicle_id, type, tax_rate)
    VALUES (?, ?, ?, ?, 'invoice', ?)
  `).run(invoice_number, req.params.id, job.customer_id, job.vehicle_id, taxRate);
  const invId = result.lastInsertRowid;
  db.prepare('UPDATE invoices SET subtotal = 0, tax_amount = 0, total = 0 WHERE id = ?').run(invId);
  const row = db.prepare(`
    SELECT i.*, c.name as customer_name, v.registration
    FROM invoices i JOIN customers c ON i.customer_id = c.id LEFT JOIN vehicles v ON i.vehicle_id = v.id
    WHERE i.id = ?
  `).get(invId);
  const items = db.prepare('SELECT * FROM invoice_items WHERE invoice_id = ? ORDER BY id').all(invId);
  res.status(201).json({ ...row, items });
});
