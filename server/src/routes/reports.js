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
