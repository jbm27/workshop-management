import { Router } from 'express';
import { db } from '../db.js';
import { requireAdminAuth } from '../auth.js';
import { getAverageLabourCostPerHour } from '../workshopSettings.js';
import { syncLabourLinesForJob } from '../jobInvoiceLabour.js';
import { streamJobSummaryPdf } from '../jobSummaryPdf.js';

export const jobsRouter = Router();

/** Workshop jobs mechanics may open (test drives, etc.). */
const MECHANIC_ALLOWED_JOB_STATUSES = ['in_progress', 'vehicle_released'];

function stripJobForMechanic(job) {
  if (!job) return job;
  const out = { ...job };
  delete out.customer_phone;
  delete out.customer_email;
  return out;
}

function assertNotMechanic(req, res) {
  if (req.admin?.is_mechanic) {
    res.status(403).json({ error: 'Your account cannot perform this action' });
    return false;
  }
  return true;
}

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
    .prepare(
      `
      SELECT td.id, td.job_id, td.admin_user_id, td.odometer, td.fuel, td.created_at,
        au.display_name AS logged_by_display_name, au.username AS logged_by_username
      FROM job_test_drives td
      LEFT JOIN admin_users au ON au.id = td.admin_user_id
      WHERE td.job_id = ?
      ORDER BY td.id ASC
    `,
    )
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
  const frozenCost = job.labour_cost_frozen;
  const hasFrozen = frozenCost != null && Number.isFinite(Number(frozenCost));
  let average_labour_cost_per_hour;
  let total_labour_hours;
  let total_labour_cost;
  if (hasFrozen) {
    total_labour_hours = Number(job.labour_hours_frozen) || 0;
    average_labour_cost_per_hour = Number(job.labour_rate_frozen) || 0;
    total_labour_cost = Math.round(Number(frozenCost) * 100) / 100;
  } else {
    average_labour_cost_per_hour = getAverageLabourCostPerHour();
    total_labour_hours = time_logs.reduce((s, tl) => s + (Number(tl.hours) || 0), 0);
    total_labour_cost = Math.round(total_labour_hours * average_labour_cost_per_hour * 100) / 100;
  }
  return {
    ...job,
    tasks,
    test_drives,
    time_logs,
    average_labour_cost_per_hour,
    total_labour_hours,
    total_labour_cost,
    labour_cost_locked: hasFrozen,
  };
}

const TEST_DRIVE_FUEL_LEVELS = ['Empty', '1/4', '1/2', '3/4', 'Full'];

jobsRouter.get('/', requireAdminAuth, (req, res) => {
  const isM = req.admin.is_mechanic;
  const status = req.query.status;
  const q = (req.query.q || '').trim();
  let stmt, rows;
  const taskCountSelect = '(SELECT COUNT(*) FROM job_tasks WHERE job_id = j.id) as task_count';
  const mechanicStatusFilter = isM ? `AND j.status IN ('in_progress','vehicle_released')` : '';
  if (isM && status && !MECHANIC_ALLOWED_JOB_STATUSES.includes(String(status))) {
    return res.json([]);
  }
  if (status) {
    stmt = db.prepare(`
      SELECT j.*, v.registration, v.make, v.model, c.name as customer_name, ${taskCountSelect}
      FROM jobs j
      JOIN vehicles v ON j.vehicle_id = v.id
      LEFT JOIN customers c ON j.customer_id = c.id
      WHERE j.status = ? ${mechanicStatusFilter}
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
      WHERE (j.job_number LIKE ? OR jtk.description LIKE ? OR v.registration LIKE ? OR (c.name LIKE ?))
        ${isM ? `AND j.status IN ('in_progress','vehicle_released')` : ''}
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
      WHERE 1=1 ${mechanicStatusFilter}
      ORDER BY j.created_at DESC
    `);
    rows = stmt.all();
  }
  res.json(isM ? rows.map(stripJobForMechanic) : rows);
});

jobsRouter.get('/time-logs/mine', requireAdminAuth, (req, res) => {
  const date = String(req.query.date || '').trim();
  const hasDate = /^\d{4}-\d{2}-\d{2}$/.test(date);
  const sql = hasDate
    ? `
      SELECT * FROM (
        SELECT
          tl.id,
          tl.job_id,
          tl.admin_user_id,
          tl.hours,
          tl.notes,
          tl.worked_at,
          tl.created_at,
          j.job_number,
          v.registration,
          v.make,
          v.model,
          'job' AS entry_type,
          NULL AS idle_reason
        FROM job_time_logs tl
        JOIN jobs j ON j.id = tl.job_id
        JOIN vehicles v ON v.id = j.vehicle_id
        WHERE tl.admin_user_id = ?
          AND date(tl.worked_at) = ?
        UNION ALL
        SELECT
          il.id,
          NULL AS job_id,
          il.admin_user_id,
          il.hours,
          il.notes,
          il.worked_at,
          il.created_at,
          NULL AS job_number,
          NULL AS registration,
          NULL AS make,
          NULL AS model,
          'idle' AS entry_type,
          il.reason AS idle_reason
        FROM mechanic_idle_time_logs il
        WHERE il.admin_user_id = ?
          AND date(il.worked_at) = ?
      )
      ORDER BY worked_at DESC, id DESC
    `
    : `
      SELECT * FROM (
        SELECT
          tl.id,
          tl.job_id,
          tl.admin_user_id,
          tl.hours,
          tl.notes,
          tl.worked_at,
          tl.created_at,
          j.job_number,
          v.registration,
          v.make,
          v.model,
          'job' AS entry_type,
          NULL AS idle_reason
        FROM job_time_logs tl
        JOIN jobs j ON j.id = tl.job_id
        JOIN vehicles v ON v.id = j.vehicle_id
        WHERE tl.admin_user_id = ?
        UNION ALL
        SELECT
          il.id,
          NULL AS job_id,
          il.admin_user_id,
          il.hours,
          il.notes,
          il.worked_at,
          il.created_at,
          NULL AS job_number,
          NULL AS registration,
          NULL AS make,
          NULL AS model,
          'idle' AS entry_type,
          il.reason AS idle_reason
        FROM mechanic_idle_time_logs il
        WHERE il.admin_user_id = ?
      )
      ORDER BY worked_at DESC, id DESC
    `;
  const rows = hasDate
    ? db.prepare(sql).all(req.admin.id, date, req.admin.id, date)
    : db.prepare(sql).all(req.admin.id, req.admin.id);
  res.json(rows);
});

jobsRouter.post('/time-logs/idle', requireAdminAuth, (req, res) => {
  const reason = String(req.body?.reason || '').trim();
  if (!['waiting_spares', 'no_work', 'annual_leave', 'sick_leave', 'compassionate_leave'].includes(reason)) {
    return res.status(400).json({ error: 'reason must be waiting_spares, no_work, annual_leave, sick_leave, or compassionate_leave' });
  }
  const hours = Number(req.body?.hours);
  if (!Number.isFinite(hours) || hours <= 0) return res.status(400).json({ error: 'hours must be a positive number' });
  const workedAtRaw = req.body?.worked_at != null ? String(req.body.worked_at).trim() : '';
  const workedAt = workedAtRaw || null;
  const notes = req.body?.notes ? String(req.body.notes).trim() : null;
  const result = db.prepare(
    `INSERT INTO mechanic_idle_time_logs (admin_user_id, reason, hours, notes, worked_at)
     VALUES (?, ?, ?, ?, COALESCE(?, datetime('now')))`,
  ).run(req.admin.id, reason, hours, notes, workedAt);
  const row = db.prepare('SELECT * FROM mechanic_idle_time_logs WHERE id = ?').get(result.lastInsertRowid);
  res.status(201).json({ ...row, entry_type: 'idle', idle_reason: row.reason });
});

jobsRouter.delete('/time-logs/idle/:logId', requireAdminAuth, (req, res) => {
  const id = Number(req.params.logId);
  if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ error: 'Invalid idle log id' });
  const row = db.prepare('SELECT * FROM mechanic_idle_time_logs WHERE id = ?').get(id);
  if (!row) return res.status(404).json({ error: 'Idle time log not found' });
  const isOwner = Number(row.admin_user_id) === Number(req.admin.id);
  if (!isOwner && !req.admin.permissions?.can_manage_team_members) {
    return res.status(403).json({ error: 'You can only remove your own idle time logs' });
  }
  db.prepare('DELETE FROM mechanic_idle_time_logs WHERE id = ?').run(id);
  res.status(204).send();
});

/** Create a workshop job from a standalone quote (no job yet) and link the quote to it. */
jobsRouter.post('/from-quote', requireAdminAuth, (req, res) => {
  if (!assertNotMechanic(req, res)) return;
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
  syncLabourLinesForJob(jobId);

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

/** First time staff sends quote to customer (portal message): record quote_prepared_at for job reports (time to quote). */
jobsRouter.post('/:id/quote-prepared', requireAdminAuth, (req, res) => {
  const jobId = Number(req.params.id);
  if (!Number.isFinite(jobId) || jobId <= 0) return res.status(400).json({ error: 'Invalid job id' });
  const row = db.prepare('SELECT id, quote_prepared_at FROM jobs WHERE id = ?').get(jobId);
  if (!row) return res.status(404).json({ error: 'Job not found' });
  const hadTimestamp = Boolean(row.quote_prepared_at);
  db.prepare(
    `UPDATE jobs SET quote_prepared_at = COALESCE(quote_prepared_at, datetime('now')), updated_at = datetime('now') WHERE id = ?`,
  ).run(jobId);
  const out = db.prepare('SELECT quote_prepared_at, created_at FROM jobs WHERE id = ?').get(jobId);
  res.json({
    quote_prepared_at: out.quote_prepared_at,
    first_recorded: !hadTimestamp,
  });
});

jobsRouter.get('/:id/summary-pdf', requireAdminAuth, (req, res) => {
  try {
    const jobId = Number(req.params.id);
    if (!Number.isFinite(jobId) || jobId <= 0) return res.status(400).json({ error: 'Invalid job id' });

    const job = fullJob(jobId);
    if (!job) return res.status(404).json({ error: 'Job not found' });
    if (job.status !== 'completed') {
      return res.status(400).json({ error: 'Job summary PDF is only available when the job is complete' });
    }

    const addrRow = db
      .prepare(`SELECT c.address AS customer_address FROM jobs j LEFT JOIN customers c ON c.id = j.customer_id WHERE j.id = ?`)
      .get(jobId);
    const vehRow = db.prepare(`SELECT v.year, v.odometer FROM jobs j JOIN vehicles v ON v.id = j.vehicle_id WHERE j.id = ?`).get(jobId);
    const jobForPdf = {
      ...job,
      customer_address: addrRow?.customer_address || '',
      year: vehRow?.year ?? job.year,
      odometer: vehRow?.odometer ?? job.odometer,
    };

    const quote = db.prepare(`SELECT * FROM invoices WHERE job_id = ? AND type = 'quote' ORDER BY id DESC LIMIT 1`).get(jobId);
    const invoice = db.prepare(`SELECT * FROM invoices WHERE job_id = ? AND type = 'invoice' ORDER BY id DESC LIMIT 1`).get(jobId);

    const quoteItems = quote ? db.prepare('SELECT * FROM invoice_items WHERE invoice_id = ? ORDER BY id').all(quote.id) : [];

    const invoiceItems = invoice
      ? db
          .prepare(
            `
        SELECT ii.*,
          (SELECT COALESCE(SUM(ll.quantity * ll.unit_cost), 0) FROM lpo_lines ll WHERE ll.invoice_item_id = ii.id) AS lpo_allocated_cost,
          (SELECT COALESCE(SUM(il.quantity * il.unit_cost), 0) FROM ipr_lines il WHERE il.invoice_item_id = ii.id) AS ipr_allocated_cost
        FROM invoice_items ii
        WHERE ii.invoice_id = ?
        ORDER BY ii.id
      `,
          )
          .all(invoice.id)
      : [];

    const payments = invoice
      ? db.prepare('SELECT * FROM invoice_payments WHERE invoice_id = ? ORDER BY paid_at ASC, id ASC').all(invoice.id)
      : [];

    const lpoHeaders = invoice
      ? db
          .prepare(
            `
        SELECT l.id, l.ref, l.finalized, l.approved, s.name AS supplier_name
        FROM lpos l
        JOIN suppliers s ON s.id = l.supplier_id
        WHERE l.invoice_id = ?
        ORDER BY l.id
      `,
          )
          .all(invoice.id)
      : [];

    const lpoLineStmt = db.prepare(
      `
      SELECT ll.description, ll.quantity, ll.unit_cost,
        (COALESCE(ll.quantity, 0) * COALESCE(ll.unit_cost, 0)) AS line_net,
        ll.received_confirmed, ll.received_confirmed_at,
        rbu.display_name AS received_by_display_name,
        abu.display_name AS assigned_display_name
      FROM lpo_lines ll
      LEFT JOIN admin_users rbu ON rbu.id = ll.received_confirmed_by_admin_user_id
      LEFT JOIN admin_users abu ON abu.id = ll.assigned_admin_user_id
      WHERE ll.lpo_id = ?
      ORDER BY ll.id
    `,
    );
    const lpoDetails = lpoHeaders.map((l) => {
      const lines = lpoLineStmt.all(l.id);
      const total_ex_vat = Math.round(lines.reduce((s, x) => s + (Number(x.line_net) || 0), 0) * 100) / 100;
      return { ...l, lines, total_ex_vat };
    });

    const iprHeaders = invoice
      ? db.prepare(`SELECT id, ref, finalized, approved FROM iprs WHERE invoice_id = ? ORDER BY id`).all(invoice.id)
      : [];

    const iprLineStmt = db.prepare(
      `
      SELECT il.description, il.quantity, il.unit_cost,
        (COALESCE(il.quantity, 0) * COALESCE(il.unit_cost, 0)) AS line_net,
        il.received_confirmed, il.received_confirmed_at,
        rbu.display_name AS received_by_display_name,
        abu.display_name AS assigned_display_name
      FROM ipr_lines il
      LEFT JOIN admin_users rbu ON rbu.id = il.received_confirmed_by_admin_user_id
      LEFT JOIN admin_users abu ON abu.id = il.assigned_admin_user_id
      WHERE il.ipr_id = ?
      ORDER BY il.id
    `,
    );
    const iprDetails = iprHeaders.map((ip) => {
      const lines = iprLineStmt.all(ip.id);
      const total_ex_vat = Math.round(lines.reduce((s, x) => s + (Number(x.line_net) || 0), 0) * 100) / 100;
      return { ...ip, lines, total_ex_vat };
    });

    streamJobSummaryPdf(res, {
      job: jobForPdf,
      tasks: job.tasks,
      test_drives: job.test_drives,
      time_logs: job.time_logs,
      quote,
      quoteItems,
      invoice,
      invoiceItems,
      payments,
      lpoDetails,
      iprDetails,
    });
  } catch (e) {
    console.error('[job summary pdf]', e);
    if (!res.headersSent) res.status(500).json({ error: e.message || 'PDF failed' });
  }
});

jobsRouter.get('/:id', requireAdminAuth, (req, res) => {
  const jobId = Number(req.params.id);
  if (!Number.isFinite(jobId) || jobId <= 0) return res.status(400).json({ error: 'Invalid job id' });
  const job = fullJob(jobId);
  if (!job) return res.status(404).json({ error: 'Job not found' });
  if (req.admin.is_mechanic && !MECHANIC_ALLOWED_JOB_STATUSES.includes(job.status)) {
    return res.status(403).json({ error: 'This job is not available for workshop staff' });
  }
  res.json(req.admin.is_mechanic ? stripJobForMechanic(job) : job);
});

jobsRouter.post('/:id/test-drives', requireAdminAuth, (req, res) => {
  const jobId = Number(req.params.id);
  if (!Number.isFinite(jobId) || jobId <= 0) return res.status(400).json({ error: 'Invalid job id' });
  const row = db.prepare('SELECT id, odometer_in, status FROM jobs WHERE id = ?').get(jobId);
  if (!row) return res.status(404).json({ error: 'Job not found' });
  if (row.status === 'completed') {
    return res.status(400).json({ error: 'Cannot add test drives to a completed job' });
  }
  if (req.admin.is_mechanic && !MECHANIC_ALLOWED_JOB_STATUSES.includes(row.status)) {
    return res.status(403).json({ error: 'This job is not available for workshop staff' });
  }
  const { odometer, fuel } = req.body;
  const odo = Number(odometer);
  if (!Number.isFinite(odo) || odo < 0) return res.status(400).json({ error: 'Valid odometer (km) on return to workshop is required' });
  if (!fuel || !TEST_DRIVE_FUEL_LEVELS.includes(fuel)) {
    return res.status(400).json({ error: 'Fuel level is required (Empty, 1/4, 1/2, 3/4, or Full)' });
  }
  const lastTd = db
    .prepare('SELECT odometer FROM job_test_drives WHERE job_id = ? ORDER BY id DESC LIMIT 1')
    .get(jobId);
  const baseline = lastTd ? Number(lastTd.odometer) : Number(row.odometer_in);
  if (!Number.isFinite(baseline)) {
    return res.status(400).json({ error: 'Set mileage in (km) before adding a test drive' });
  }
  if (odo < baseline) {
    return res.status(400).json({
      error: 'Odometer must be at or above the previous reading (mileage in or last test drive return)',
    });
  }
  db.prepare('INSERT INTO job_test_drives (job_id, admin_user_id, odometer, fuel) VALUES (?, ?, ?, ?)').run(
    jobId,
    req.admin.id,
    Math.round(odo),
    fuel,
  );
  const job = fullJob(jobId);
  res.status(201).json(req.admin.is_mechanic ? stripJobForMechanic(job) : job);
});

jobsRouter.delete('/:id/test-drives/:tdId', requireAdminAuth, (req, res) => {
  const jobId = Number(req.params.id);
  const tdId = Number(req.params.tdId);
  if (!Number.isFinite(jobId) || jobId <= 0 || !Number.isFinite(tdId) || tdId <= 0) {
    return res.status(400).json({ error: 'Invalid id' });
  }
  const jobRow = db.prepare('SELECT id, status FROM jobs WHERE id = ?').get(jobId);
  if (!jobRow) return res.status(404).json({ error: 'Job not found' });
  if (jobRow.status === 'completed') {
    return res.status(400).json({ error: 'Cannot change test drives on a completed job' });
  }
  const td = db.prepare('SELECT * FROM job_test_drives WHERE id = ? AND job_id = ?').get(tdId, jobId);
  if (!td) return res.status(404).json({ error: 'Test drive not found' });
  const isOwner = Number(td.admin_user_id) === Number(req.admin.id);
  if (!isOwner && !req.admin.permissions?.can_manage_team_members) {
    return res.status(403).json({ error: 'You can only remove test drives you logged' });
  }
  db.prepare('DELETE FROM job_test_drives WHERE id = ?').run(tdId);
  const job = fullJob(jobId);
  if (!job) return res.status(404).json({ error: 'Job not found' });
  res.json(req.admin.is_mechanic ? stripJobForMechanic(job) : job);
});

jobsRouter.post('/:id/time-logs', requireAdminAuth, (req, res) => {
  const row = db.prepare('SELECT id, status FROM jobs WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Job not found' });
  if (row.status === 'completed') {
    return res.status(400).json({ error: 'Cannot add time logs to a completed job' });
  }
  const hours = Number(req.body?.hours);
  if (!Number.isFinite(hours) || hours <= 0) return res.status(400).json({ error: 'hours must be a positive number' });
  const workedAtRaw = req.body?.worked_at != null ? String(req.body.worked_at).trim() : '';
  const workedAt = workedAtRaw || null;
  db.prepare(
    `INSERT INTO job_time_logs (job_id, admin_user_id, hours, notes, worked_at)
     VALUES (?, ?, ?, ?, COALESCE(?, datetime('now')))`,
  ).run(req.params.id, req.admin.id, hours, req.body?.notes ? String(req.body.notes).trim() : null, workedAt);
  syncLabourLinesForJob(req.params.id);
  res.status(201).json(fullJob(req.params.id));
});

jobsRouter.delete('/:id/time-logs/:logId', requireAdminAuth, (req, res) => {
  const jobRow = db.prepare('SELECT status FROM jobs WHERE id = ?').get(req.params.id);
  if (!jobRow) return res.status(404).json({ error: 'Job not found' });
  if (jobRow.status === 'completed') {
    return res.status(400).json({ error: 'Cannot change time logs on a completed job' });
  }
  const log = db.prepare('SELECT * FROM job_time_logs WHERE id = ? AND job_id = ?').get(req.params.logId, req.params.id);
  if (!log) return res.status(404).json({ error: 'Time log not found' });
  const isOwner = Number(log.admin_user_id) === Number(req.admin.id);
  if (!isOwner && !req.admin.permissions?.can_manage_team_members) {
    return res.status(403).json({ error: 'You can only remove your own time logs' });
  }
  db.prepare('DELETE FROM job_time_logs WHERE id = ?').run(req.params.logId);
  syncLabourLinesForJob(req.params.id);
  res.json(fullJob(req.params.id));
});

jobsRouter.post('/', requireAdminAuth, (req, res) => {
  if (!assertNotMechanic(req, res)) return;
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

jobsRouter.patch('/:id', requireAdminAuth, (req, res) => {
  if (!assertNotMechanic(req, res)) return;
  const row = db.prepare('SELECT * FROM jobs WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Job not found' });
  const { status, customer_id, notes, odometer_in, odometer_out, fuel_in, fuel_out, valuables_in_vehicle, due_date, completed_at, tasks } = req.body;
  const nextStatus = status ?? row.status;
  db.prepare(`
    UPDATE jobs SET status = ?, customer_id = ?, notes = ?, odometer_in = ?, odometer_out = ?, fuel_in = ?, fuel_out = ?, valuables_in_vehicle = ?, due_date = ?, completed_at = ?, updated_at = datetime('now')
    WHERE id = ?
  `).run(
    nextStatus,
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
  if (nextStatus === 'vehicle_released' && row.status !== 'vehicle_released') {
    db.prepare(
      `UPDATE jobs SET vehicle_released_at = COALESCE(vehicle_released_at, datetime('now')), updated_at = datetime('now') WHERE id = ?`,
    ).run(req.params.id);
  }
  const fresh = db.prepare('SELECT status, labour_cost_frozen FROM jobs WHERE id = ?').get(req.params.id);
  const nowCompleted = fresh?.status === 'completed';
  if (!nowCompleted) {
    db.prepare(
      `UPDATE jobs SET labour_hours_frozen = NULL, labour_rate_frozen = NULL, labour_cost_frozen = NULL WHERE id = ?`,
    ).run(req.params.id);
  } else if (fresh.labour_cost_frozen == null) {
    const sumRow = db.prepare('SELECT COALESCE(SUM(hours), 0) AS h FROM job_time_logs WHERE job_id = ?').get(req.params.id);
    const totalH = Number(sumRow?.h) || 0;
    const rate = getAverageLabourCostPerHour();
    const cost = Math.round(totalH * rate * 100) / 100;
    db.prepare(
      `UPDATE jobs SET labour_hours_frozen = ?, labour_rate_frozen = ?, labour_cost_frozen = ? WHERE id = ?`,
    ).run(totalH, rate, cost, req.params.id);
  }
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
  syncLabourLinesForJob(req.params.id);
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

jobsRouter.post('/:id/quote', requireAdminAuth, (req, res) => {
  if (!assertNotMechanic(req, res)) return;
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
  syncLabourLinesForJob(req.params.id);
  const row = db.prepare(`
    SELECT i.*, c.name as customer_name, v.registration
    FROM invoices i JOIN customers c ON i.customer_id = c.id LEFT JOIN vehicles v ON i.vehicle_id = v.id
    WHERE i.id = ?
  `).get(invId);
  const items = db.prepare('SELECT * FROM invoice_items WHERE invoice_id = ? ORDER BY id').all(invId);
  res.status(201).json({ ...row, items });
});

jobsRouter.post('/:id/invoice', requireAdminAuth, (req, res) => {
  if (!assertNotMechanic(req, res)) return;
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
  syncLabourLinesForJob(req.params.id);
  const row = db.prepare(`
    SELECT i.*, c.name as customer_name, v.registration
    FROM invoices i JOIN customers c ON i.customer_id = c.id LEFT JOIN vehicles v ON i.vehicle_id = v.id
    WHERE i.id = ?
  `).get(invId);
  const items = db.prepare('SELECT * FROM invoice_items WHERE invoice_id = ? ORDER BY id').all(invId);
  res.status(201).json({ ...row, items });
});
