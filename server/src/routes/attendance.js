import { Router } from 'express';
import { db } from '../db.js';
import { requireAdminAuth, requireAdminPermission } from '../auth.js';
import { applyAutoClockOuts } from '../services/attendanceService.js';

export const attendanceRouter = Router();

attendanceRouter.get('/events', requireAdminAuth, (req, res) => {
  applyAutoClockOuts();
  const limit = Math.min(Math.max(Number(req.query.limit ?? 100), 1), 5000);
  const fromDate = req.query.from ? String(req.query.from).trim() : null;
  const toDate = req.query.to ? String(req.query.to).trim() : null;
  const canManage = Boolean(req.admin.permissions?.can_manage_team_members);
  const adminUserId = req.query.admin_user_id != null ? Number(req.query.admin_user_id) : null;

  const conditions = [];
  const params = [];

  if (!canManage) {
    conditions.push('ae.admin_user_id = ?');
    params.push(req.admin.id);
  } else if (adminUserId != null && Number.isFinite(adminUserId) && adminUserId > 0) {
    conditions.push('ae.admin_user_id = ?');
    params.push(adminUserId);
  }

  if (fromDate && /^\d{4}-\d{2}-\d{2}$/.test(fromDate)) {
    conditions.push('date(ae.occurred_at) >= date(?)');
    params.push(fromDate);
  }
  if (toDate && /^\d{4}-\d{2}-\d{2}$/.test(toDate)) {
    conditions.push('date(ae.occurred_at) <= date(?)');
    params.push(toDate);
  }

  const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  params.push(limit);

  const rows = db
    .prepare(
      `
      SELECT
        ae.id,
        ae.admin_user_id,
        ae.event_type,
        ae.occurred_at,
        ae.device_id,
        ae.source_event_id,
        ae.created_at,
        au.display_name,
        au.biometric_pin
      FROM attendance_events ae
      JOIN admin_users au ON au.id = ae.admin_user_id
      ${whereClause}
      ORDER BY ae.occurred_at DESC
      LIMIT ?
    `,
    )
    .all(...params);

  res.json(rows);
});

attendanceRouter.get('/clocked-in', requireAdminPermission('can_manage_team_members'), (_req, res) => {
  applyAutoClockOuts();
  const rows = db
    .prepare(
      `
      SELECT
        ae.admin_user_id,
        au.display_name,
        au.biometric_pin,
        ae.occurred_at AS clocked_in_at,
        ae.device_id
      FROM attendance_events ae
      INNER JOIN (
        SELECT admin_user_id, MAX(occurred_at) AS max_at
        FROM attendance_events
        GROUP BY admin_user_id
      ) latest ON latest.admin_user_id = ae.admin_user_id AND latest.max_at = ae.occurred_at
      JOIN admin_users au ON au.id = ae.admin_user_id
      WHERE ae.event_type = 'clock_in' AND au.active = 1
      ORDER BY au.display_name
    `,
    )
    .all();
  res.json(rows);
});
