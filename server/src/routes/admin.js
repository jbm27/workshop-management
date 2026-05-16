import { Router } from 'express';
import { db } from '../db.js';
import { denyMechanics, hashPassword, newSessionToken, requireAdminAuth, requireAdminPermission, verifyPassword } from '../auth.js';
import { getAverageLabourCostPerHour, setAverageLabourCostPerHour } from '../workshopSettings.js';
import { syncLabourLinesForJob } from '../jobInvoiceLabour.js';

export const adminRouter = Router();

function adminUserRowToPayload(row) {
  if (!row) return null;
  return {
    id: row.id,
    username: row.username,
    display_name: row.display_name,
    active: Number(row.active) === 1,
    is_mechanic: Number(row.is_mechanic) === 1,
    permissions: {
      can_create_lpos: Number(row.can_create_lpos) === 1,
      can_create_iprs: Number(row.can_create_iprs) === 1,
      can_finalize_lpos: Number(row.can_finalize_lpos) === 1,
      can_finalize_iprs: Number(row.can_finalize_iprs) === 1,
      can_approve_lpo_ipr: Number(row.can_approve_lpo_ipr) === 1,
      can_assign_lpo_ipr_receivers: Number(row.can_assign_lpo_ipr_receivers) === 1,
      can_record_invoice_payments: Number(row.can_record_invoice_payments) === 1,
      can_record_supplier_payments: Number(row.can_record_supplier_payments) === 1,
      can_manage_team_members: Number(row.can_manage_team_members) === 1,
      can_view_statistics_reports: Number(row.can_view_statistics_reports) === 1,
      can_view_lpo_ipr: Number(row.can_view_lpo_ipr) === 1,
      can_view_stores: Number(row.can_view_stores) === 1,
      can_log_test_drives: Number(row.can_log_test_drives) === 1,
    },
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function getAllAdminUsers() {
  return db
    .prepare(
      `
      SELECT *
      FROM admin_users
      ORDER BY active DESC, id ASC
    `,
    )
    .all();
}

adminRouter.post('/login', (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: 'username and password are required' });

  const admin = db.prepare('SELECT * FROM admin_users WHERE username = ? AND active = 1').get(String(username).trim());
  if (!admin) return res.status(401).json({ error: 'Invalid username or password' });

  const ok = verifyPassword(String(password), admin.password_salt, admin.password_hash);
  if (!ok) return res.status(401).json({ error: 'Invalid username or password' });

  const token = newSessionToken();
  db.prepare(
    'INSERT INTO admin_sessions (admin_user_id, token, expires_at) VALUES (?, ?, datetime(\'now\', \'+30 days\'))',
  ).run(admin.id, token);

  res.json({
    token,
    admin: adminUserRowToPayload(admin),
  });
});

adminRouter.post('/logout', requireAdminAuth, (req, res) => {
  const token = req.headers?.authorization?.replace(/^Bearer\s+/i, '');
  if (token) {
    db.prepare('DELETE FROM admin_sessions WHERE token = ?').run(token);
  }
  res.status(204).send();
});

adminRouter.get('/me', requireAdminAuth, (req, res) => {
  res.json(req.admin);
});

adminRouter.get('/users/assignable', requireAdminAuth, denyMechanics, (req, res) => {
  const rows = db
    .prepare('SELECT id, username, display_name FROM admin_users WHERE active = 1 ORDER BY display_name, username')
    .all();
  res.json(rows);
});

adminRouter.get('/users', requireAdminPermission('can_manage_team_members'), (req, res) => {
  const rows = getAllAdminUsers();
  res.json(rows.map(adminUserRowToPayload));
});

adminRouter.get('/workshop-settings', requireAdminPermission('can_manage_team_members'), (req, res) => {
  res.json({
    average_labour_cost_per_hour: getAverageLabourCostPerHour(),
  });
});

adminRouter.patch('/workshop-settings', requireAdminPermission('can_manage_team_members'), (req, res) => {
  if (req.body?.average_labour_cost_per_hour === undefined) {
    return res.status(400).json({ error: 'average_labour_cost_per_hour is required' });
  }
  try {
    const v = setAverageLabourCostPerHour(req.body.average_labour_cost_per_hour);
    const jobRows = db.prepare(`SELECT DISTINCT job_id AS jid FROM invoices WHERE job_id IS NOT NULL`).all();
    for (const row of jobRows) {
      if (row?.jid) syncLabourLinesForJob(row.jid);
    }
    res.json({ average_labour_cost_per_hour: v });
  } catch (e) {
    res.status(400).json({ error: e.message || 'Invalid value' });
  }
});

adminRouter.post('/users', requireAdminPermission('can_manage_team_members'), (req, res) => {
  const { username, display_name, password, permissions, is_mechanic } = req.body || {};
  if (!username || !String(username).trim()) return res.status(400).json({ error: 'username is required' });
  if (!display_name || !String(display_name).trim()) return res.status(400).json({ error: 'display_name is required' });
  if (!password || !String(password).trim()) return res.status(400).json({ error: 'password is required' });

  const usernameClean = String(username).trim();
  const existing = db.prepare('SELECT id FROM admin_users WHERE username = ?').get(usernameClean);
  if (existing) return res.status(400).json({ error: 'username already exists' });

  const { salt, hash } = hashPassword(String(password));

  const p = permissions || {};
  const mechanic = Boolean(is_mechanic);
  const z = mechanic ? 0 : Number(p.can_create_lpos) === 1 ? 1 : Number(p.can_create_lpos) ? 1 : 0;
  const z2 = mechanic ? 0 : Number(p.can_create_iprs) === 1 ? 1 : Number(p.can_create_iprs) ? 1 : 0;
  const z3 = mechanic ? 0 : Number(p.can_finalize_lpos) === 1 ? 1 : Number(p.can_finalize_lpos) ? 1 : 0;
  const z4 = mechanic ? 0 : Number(p.can_finalize_iprs) === 1 ? 1 : Number(p.can_finalize_iprs) ? 1 : 0;
  const z5 = mechanic ? 0 : Number(p.can_approve_lpo_ipr) === 1 ? 1 : Number(p.can_approve_lpo_ipr) ? 1 : 0;
  const z6 = mechanic
    ? 0
    : Number(p.can_assign_lpo_ipr_receivers) === 1
      ? 1
      : Number(p.can_assign_lpo_ipr_receivers)
        ? 1
        : 0;
  const z7 = mechanic ? 0 : Number(p.can_record_invoice_payments) === 1 ? 1 : Number(p.can_record_invoice_payments) ? 1 : 0;
  const z8 = mechanic ? 0 : Number(p.can_record_supplier_payments) === 1 ? 1 : Number(p.can_record_supplier_payments) ? 1 : 0;
  const z9 = mechanic ? 0 : Number(p.can_manage_team_members) === 1 ? 1 : Number(p.can_manage_team_members) ? 1 : 0;
  const z10 = mechanic ? 0 : Number(p.can_view_statistics_reports) === 1 ? 1 : Number(p.can_view_statistics_reports) ? 1 : 0;
  const z11 = mechanic ? 0 : Number(p.can_view_lpo_ipr) === 1 ? 1 : Number(p.can_view_lpo_ipr) ? 1 : 0;
  const z12 = mechanic ? 0 : Number(p.can_view_stores) === 1 ? 1 : Number(p.can_view_stores) ? 1 : 0;
  const canLogTd = mechanic
    ? Number(p.can_log_test_drives) === 1
      ? 1
      : 0
    : p.can_log_test_drives === false || Number(p.can_log_test_drives) === 0
      ? 0
      : 1;

  const row = db.prepare(
    `
      INSERT INTO admin_users
        (username, display_name, password_salt, password_hash, active, is_mechanic,
         can_create_lpos, can_create_iprs, can_finalize_lpos, can_finalize_iprs,
         can_approve_lpo_ipr, can_assign_lpo_ipr_receivers,
         can_record_invoice_payments, can_record_supplier_payments,
         can_manage_team_members, can_view_statistics_reports, can_view_lpo_ipr, can_view_stores,
         can_log_test_drives)
      VALUES (?, ?, ?, ?, 1, ?,
        ?, ?, ?, ?,
        ?, ?, ?, ?,
        ?, ?, ?, ?,
        ?)
    `,
  ).run(
    usernameClean,
    String(display_name).trim(),
    salt,
    hash,
    mechanic ? 1 : 0,
    z,
    z2,
    z3,
    z4,
    z5,
    z6,
    z7,
    z8,
    z9,
    z10,
    z11,
    z12,
    canLogTd,
  );
  const id = row.lastInsertRowid;
  const inserted = db.prepare('SELECT * FROM admin_users WHERE id = ?').get(id);
  res.status(201).json(adminUserRowToPayload(inserted));
});

adminRouter.patch('/users/:id', requireAdminPermission('can_manage_team_members'), (req, res) => {
  const { username, permissions, display_name, password, active, is_mechanic } = req.body || {};
  const adminId = Number(req.params.id);
  if (!Number.isFinite(adminId) || adminId <= 0) return res.status(400).json({ error: 'Invalid user id' });

  const current = db.prepare('SELECT * FROM admin_users WHERE id = ?').get(adminId);
  if (!current) return res.status(404).json({ error: 'User not found' });

  // Compute updated fields; do not spread `current` after these or it will overwrite changes.
  const updates = {
    display_name: display_name !== undefined ? String(display_name).trim() : current.display_name,
    username: username !== undefined ? String(username).trim() : current.username,
    active: active !== undefined ? (active ? 1 : 0) : current.active,
  };

  if (!updates.username) return res.status(400).json({ error: 'username cannot be empty' });
  if (updates.username !== current.username) {
    const existing = db.prepare('SELECT id FROM admin_users WHERE username = ?').get(updates.username);
    if (existing && Number(existing.id) !== adminId) return res.status(400).json({ error: 'username already exists' });
  }

  const p = permissions || {};
  const nextIsMech =
    is_mechanic !== undefined ? (is_mechanic ? 1 : 0) : Number(current.is_mechanic) === 1 ? 1 : 0;

  const next =
    nextIsMech === 1
      ? {
          can_create_lpos: 0,
          can_create_iprs: 0,
          can_finalize_lpos: 0,
          can_finalize_iprs: 0,
          can_approve_lpo_ipr: 0,
          can_assign_lpo_ipr_receivers: 0,
          can_record_invoice_payments: 0,
          can_record_supplier_payments: 0,
          can_manage_team_members: 0,
          can_view_statistics_reports: 0,
          can_view_lpo_ipr: 0,
          can_view_stores: 0,
          can_log_test_drives:
            p.can_log_test_drives !== undefined ? (p.can_log_test_drives ? 1 : 0) : Number(current.can_log_test_drives) === 1
              ? 1
              : 0,
        }
      : {
          can_create_lpos: p.can_create_lpos !== undefined ? (p.can_create_lpos ? 1 : 0) : current.can_create_lpos,
          can_create_iprs: p.can_create_iprs !== undefined ? (p.can_create_iprs ? 1 : 0) : current.can_create_iprs,
          can_finalize_lpos: p.can_finalize_lpos !== undefined ? (p.can_finalize_lpos ? 1 : 0) : current.can_finalize_lpos,
          can_finalize_iprs: p.can_finalize_iprs !== undefined ? (p.can_finalize_iprs ? 1 : 0) : current.can_finalize_iprs,
          can_approve_lpo_ipr:
            p.can_approve_lpo_ipr !== undefined ? (p.can_approve_lpo_ipr ? 1 : 0) : current.can_approve_lpo_ipr,
          can_assign_lpo_ipr_receivers:
            p.can_assign_lpo_ipr_receivers !== undefined
              ? (p.can_assign_lpo_ipr_receivers ? 1 : 0)
              : current.can_assign_lpo_ipr_receivers,
          can_record_invoice_payments:
            p.can_record_invoice_payments !== undefined ? (p.can_record_invoice_payments ? 1 : 0) : current.can_record_invoice_payments,
          can_record_supplier_payments:
            p.can_record_supplier_payments !== undefined ? (p.can_record_supplier_payments ? 1 : 0) : current.can_record_supplier_payments,
          can_manage_team_members:
            p.can_manage_team_members !== undefined ? (p.can_manage_team_members ? 1 : 0) : current.can_manage_team_members,
          can_view_statistics_reports:
            p.can_view_statistics_reports !== undefined ? (p.can_view_statistics_reports ? 1 : 0) : current.can_view_statistics_reports,
          can_view_lpo_ipr: p.can_view_lpo_ipr !== undefined ? (p.can_view_lpo_ipr ? 1 : 0) : current.can_view_lpo_ipr,
          can_view_stores: p.can_view_stores !== undefined ? (p.can_view_stores ? 1 : 0) : current.can_view_stores,
          can_log_test_drives:
            p.can_log_test_drives !== undefined ? (p.can_log_test_drives ? 1 : 0) : Number(current.can_log_test_drives) === 1
              ? 1
              : 0,
        };

  let newSalt = null;
  let newHash = null;
  if (password !== undefined) {
    if (!String(password).trim()) return res.status(400).json({ error: 'password cannot be empty' });
    const hashed = hashPassword(String(password));
    newSalt = hashed.salt;
    newHash = hashed.hash;
  }

  const sql = `
    UPDATE admin_users
    SET
      username = ?,
      display_name = ?,
      active = ?,
      is_mechanic = ?,
      password_salt = COALESCE(?, password_salt),
      password_hash = COALESCE(?, password_hash),
      can_create_lpos = ?,
      can_create_iprs = ?,
      can_finalize_lpos = ?,
      can_finalize_iprs = ?,
      can_approve_lpo_ipr = ?,
      can_assign_lpo_ipr_receivers = ?,
      can_record_invoice_payments = ?,
      can_record_supplier_payments = ?,
      can_manage_team_members = ?,
      can_view_statistics_reports = ?,
      can_view_lpo_ipr = ?,
      can_view_stores = ?,
      can_log_test_drives = ?,
      updated_at = datetime('now')
    WHERE id = ?
  `;

  db.prepare(sql).run(
    updates.username,
    updates.display_name,
    updates.active,
    nextIsMech,
    newSalt,
    newHash,
    next.can_create_lpos,
    next.can_create_iprs,
    next.can_finalize_lpos,
    next.can_finalize_iprs,
    next.can_approve_lpo_ipr,
    next.can_assign_lpo_ipr_receivers,
    next.can_record_invoice_payments,
    next.can_record_supplier_payments,
    next.can_manage_team_members,
    next.can_view_statistics_reports,
    next.can_view_lpo_ipr,
    next.can_view_stores,
    next.can_log_test_drives,
    adminId,
  );

  const updated = db.prepare('SELECT * FROM admin_users WHERE id = ?').get(adminId);
  res.json(adminUserRowToPayload(updated));
});

/**
 * Manager-only: per–team member activity in a date range.
 * Parts = sum of quantities on received LPO/IPR lines attributed to the assigned team member.
 * Value = sum of (line quantity × invoice item unit_price) = sale value to customer for those quantities.
 * Attribution prefers assigned_admin_user_id, with fallback to received_confirmed_by_admin_user_id for legacy rows.
 */
adminRouter.get('/team-stats', requireAdminPermission('can_view_statistics_reports'), (req, res) => {
  const fromRaw = String(req.query.from || '').trim();
  const toRaw = String(req.query.to || '').trim();
  const includeInactive = String(req.query.include_inactive || '') === '1';
  const filterId = req.query.admin_user_id != null && String(req.query.admin_user_id).trim() !== ''
    ? Number(req.query.admin_user_id)
    : null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fromRaw) || !/^\d{4}-\d{2}-\d{2}$/.test(toRaw)) {
    return res.status(400).json({ error: 'from and to are required as YYYY-MM-DD' });
  }
  if (fromRaw > toRaw) return res.status(400).json({ error: 'from must be on or before to' });
  if (filterId != null && (!Number.isFinite(filterId) || filterId <= 0)) {
    return res.status(400).json({ error: 'Invalid admin_user_id' });
  }

  const usersStmt = includeInactive
    ? db.prepare(`SELECT id, username, display_name, active, is_mechanic FROM admin_users ORDER BY display_name, username`)
    : db.prepare(`SELECT id, username, display_name, active, is_mechanic FROM admin_users WHERE active = 1 ORDER BY display_name, username`);
  let users = usersStmt.all();
  if (filterId != null) users = users.filter((u) => Number(u.id) === filterId);

  const partsRows = db
    .prepare(
      `
      SELECT admin_user_id,
        COALESCE(SUM(quantity), 0) AS parts_quantity,
        COALESCE(SUM(quantity * COALESCE(unit_price, 0)), 0) AS parts_value
      FROM (
        SELECT COALESCE(ll.assigned_admin_user_id, ll.received_confirmed_by_admin_user_id) AS admin_user_id,
          ll.quantity,
          ii.unit_price
        FROM lpo_lines ll
        JOIN invoice_items ii ON ii.id = ll.invoice_item_id AND COALESCE(ii.type, 'part') != 'labour'
        WHERE ll.received_confirmed = 1
          AND COALESCE(ll.assigned_admin_user_id, ll.received_confirmed_by_admin_user_id) IS NOT NULL
          AND ll.received_confirmed_at IS NOT NULL
          AND date(ll.received_confirmed_at) >= date(?)
          AND date(ll.received_confirmed_at) <= date(?)
        UNION ALL
        SELECT COALESCE(il.assigned_admin_user_id, il.received_confirmed_by_admin_user_id),
          il.quantity,
          ii.unit_price
        FROM ipr_lines il
        JOIN invoice_items ii ON ii.id = il.invoice_item_id AND COALESCE(ii.type, 'part') != 'labour'
        WHERE il.received_confirmed = 1
          AND COALESCE(il.assigned_admin_user_id, il.received_confirmed_by_admin_user_id) IS NOT NULL
          AND il.received_confirmed_at IS NOT NULL
          AND date(il.received_confirmed_at) >= date(?)
          AND date(il.received_confirmed_at) <= date(?)
      )
      GROUP BY admin_user_id
    `,
    )
    .all(fromRaw, toRaw, fromRaw, toRaw);

  const hoursRows = db
    .prepare(
      `
      SELECT admin_user_id, COALESCE(SUM(hours), 0) AS hours_logged
      FROM job_time_logs
      WHERE date(worked_at) >= date(?)
        AND date(worked_at) <= date(?)
      GROUP BY admin_user_id
    `,
    )
    .all(fromRaw, toRaw);
  const idleByUserReason = db
    .prepare(
      `
      SELECT admin_user_id, reason, COALESCE(SUM(hours), 0) AS h
      FROM mechanic_idle_time_logs
      WHERE reason IN ('waiting_spares', 'no_work', 'annual_leave', 'sick_leave', 'compassionate_leave')
        AND date(worked_at) >= date(?)
        AND date(worked_at) <= date(?)
      GROUP BY admin_user_id, reason
    `,
    )
    .all(fromRaw, toRaw);

  const idleMap = new Map();
  for (const row of idleByUserReason) {
    const uid = Number(row.admin_user_id);
    if (!idleMap.has(uid)) idleMap.set(uid, {
      waiting_spares: 0,
      no_work: 0,
      annual_leave: 0,
      sick_leave: 0,
      compassionate_leave: 0,
    });
    const bucket = idleMap.get(uid);
    const hrs = Number(row.h) || 0;
    if (row.reason === 'waiting_spares') bucket.waiting_spares = hrs;
    if (row.reason === 'no_work') bucket.no_work = hrs;
    if (row.reason === 'annual_leave') bucket.annual_leave = hrs;
    if (row.reason === 'sick_leave') bucket.sick_leave = hrs;
    if (row.reason === 'compassionate_leave') bucket.compassionate_leave = hrs;
  }

  const partsMap = new Map(partsRows.map((r) => [Number(r.admin_user_id), r]));
  const hoursMap = new Map(hoursRows.map((r) => [Number(r.admin_user_id), r]));

  const members = users.map((u) => {
    const id = Number(u.id);
    const p = partsMap.get(id);
    const h = hoursMap.get(id);
    const idle = idleMap.get(id) || {
      waiting_spares: 0,
      no_work: 0,
      annual_leave: 0,
      sick_leave: 0,
      compassionate_leave: 0,
    };
    const wWait = Number(idle.waiting_spares) || 0;
    const wNo = Number(idle.no_work) || 0;
    const lAnnual = Number(idle.annual_leave) || 0;
    const lSick = Number(idle.sick_leave) || 0;
    const lCompassionate = Number(idle.compassionate_leave) || 0;
    const qty = Number(p?.parts_quantity || 0);
    const val = Number(p?.parts_value || 0);
    return {
      id,
      username: u.username,
      display_name: u.display_name,
      active: Number(u.active) === 1,
      is_mechanic: Number(u.is_mechanic) === 1,
      parts_quantity_total: Math.round((qty + Number.EPSILON) * 1000) / 1000,
      parts_value_total: Math.round(val + Number.EPSILON),
      hours_logged: Math.round((Number(h?.hours_logged || 0) + Number.EPSILON) * 100) / 100,
      wasted_hours_waiting_spares: Math.round((wWait + Number.EPSILON) * 100) / 100,
      wasted_hours_no_work: Math.round((wNo + Number.EPSILON) * 100) / 100,
      wasted_hours_total: Math.round((wWait + wNo + Number.EPSILON) * 100) / 100,
      absent_hours_annual_leave: Math.round((lAnnual + Number.EPSILON) * 100) / 100,
      absent_hours_sick_leave: Math.round((lSick + Number.EPSILON) * 100) / 100,
      absent_hours_compassionate_leave: Math.round((lCompassionate + Number.EPSILON) * 100) / 100,
      absent_hours_total: Math.round((lAnnual + lSick + lCompassionate + Number.EPSILON) * 100) / 100,
    };
  });

  members.sort((a, b) => b.parts_quantity_total - a.parts_quantity_total || a.display_name.localeCompare(b.display_name));

  res.json({
    from: fromRaw,
    to: toRaw,
    include_inactive: includeInactive,
    members,
  });
});

adminRouter.get('/team-stats/:adminUserId/parts', requireAdminPermission('can_view_statistics_reports'), (req, res) => {
  const adminUserId = Number(req.params.adminUserId);
  const fromRaw = String(req.query.from || '').trim();
  const toRaw = String(req.query.to || '').trim();
  if (!Number.isFinite(adminUserId) || adminUserId <= 0) return res.status(400).json({ error: 'Invalid admin user id' });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fromRaw) || !/^\d{4}-\d{2}-\d{2}$/.test(toRaw)) {
    return res.status(400).json({ error: 'from and to are required as YYYY-MM-DD' });
  }
  if (fromRaw > toRaw) return res.status(400).json({ error: 'from must be on or before to' });

  const member = db
    .prepare('SELECT id, username, display_name, active, is_mechanic FROM admin_users WHERE id = ?')
    .get(adminUserId);
  if (!member) return res.status(404).json({ error: 'Team member not found' });

  const rows = db
    .prepare(
      `
      SELECT *
      FROM (
        SELECT
          'lpo' AS doc_type,
          l.ref AS doc_ref,
          i.id AS invoice_id,
          i.invoice_number,
          j.id AS job_id,
          j.job_number,
          v.registration AS vehicle_registration,
          ll.id AS line_id,
          ll.description AS line_description,
          ll.quantity,
          ii.unit_price AS sale_unit_price,
          ll.received_confirmed_at,
          COALESCE(ll.assigned_admin_user_id, ll.received_confirmed_by_admin_user_id) AS attributed_admin_user_id
        FROM lpo_lines ll
        JOIN lpos l ON l.id = ll.lpo_id
        JOIN invoices i ON i.id = l.invoice_id
        LEFT JOIN jobs j ON j.id = i.job_id
        LEFT JOIN vehicles v ON v.id = i.vehicle_id
        JOIN invoice_items ii ON ii.id = ll.invoice_item_id AND COALESCE(ii.type, 'part') != 'labour'
        WHERE ll.received_confirmed = 1
          AND COALESCE(ll.assigned_admin_user_id, ll.received_confirmed_by_admin_user_id) = ?
          AND ll.received_confirmed_at IS NOT NULL
          AND date(ll.received_confirmed_at) >= date(?)
          AND date(ll.received_confirmed_at) <= date(?)

        UNION ALL

        SELECT
          'ipr' AS doc_type,
          ip.ref AS doc_ref,
          i.id AS invoice_id,
          i.invoice_number,
          j.id AS job_id,
          j.job_number,
          v.registration AS vehicle_registration,
          il.id AS line_id,
          il.description AS line_description,
          il.quantity,
          ii.unit_price AS sale_unit_price,
          il.received_confirmed_at,
          COALESCE(il.assigned_admin_user_id, il.received_confirmed_by_admin_user_id) AS attributed_admin_user_id
        FROM ipr_lines il
        JOIN iprs ip ON ip.id = il.ipr_id
        JOIN invoices i ON i.id = ip.invoice_id
        LEFT JOIN jobs j ON j.id = i.job_id
        LEFT JOIN vehicles v ON v.id = i.vehicle_id
        JOIN invoice_items ii ON ii.id = il.invoice_item_id AND COALESCE(ii.type, 'part') != 'labour'
        WHERE il.received_confirmed = 1
          AND COALESCE(il.assigned_admin_user_id, il.received_confirmed_by_admin_user_id) = ?
          AND il.received_confirmed_at IS NOT NULL
          AND date(il.received_confirmed_at) >= date(?)
          AND date(il.received_confirmed_at) <= date(?)
      )
      ORDER BY received_confirmed_at DESC, doc_ref DESC, line_id DESC
    `,
    )
    .all(adminUserId, fromRaw, toRaw, adminUserId, fromRaw, toRaw)
    .map((r) => ({
      ...r,
      sale_line_value: Math.round((Number(r.quantity || 0) * Number(r.sale_unit_price || 0)) + Number.EPSILON),
    }));

  res.json({ from: fromRaw, to: toRaw, member, rows });
});

adminRouter.get('/team-stats/:adminUserId/hours', requireAdminPermission('can_view_statistics_reports'), (req, res) => {
  const adminUserId = Number(req.params.adminUserId);
  const fromRaw = String(req.query.from || '').trim();
  const toRaw = String(req.query.to || '').trim();
  if (!Number.isFinite(adminUserId) || adminUserId <= 0) return res.status(400).json({ error: 'Invalid admin user id' });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fromRaw) || !/^\d{4}-\d{2}-\d{2}$/.test(toRaw)) {
    return res.status(400).json({ error: 'from and to are required as YYYY-MM-DD' });
  }
  if (fromRaw > toRaw) return res.status(400).json({ error: 'from must be on or before to' });

  const member = db
    .prepare('SELECT id, username, display_name, active, is_mechanic FROM admin_users WHERE id = ?')
    .get(adminUserId);
  if (!member) return res.status(404).json({ error: 'Team member not found' });

  const jobRows = db
    .prepare(
      `
      SELECT
        tl.id,
        'job' AS entry_type,
        NULL AS idle_reason,
        tl.job_id,
        j.job_number,
        v.registration AS vehicle_registration,
        v.make AS vehicle_make,
        v.model AS vehicle_model,
        tl.hours,
        tl.notes,
        tl.worked_at
      FROM job_time_logs tl
      LEFT JOIN jobs j ON j.id = tl.job_id
      LEFT JOIN vehicles v ON v.id = j.vehicle_id
      WHERE tl.admin_user_id = ?
        AND date(tl.worked_at) >= date(?)
        AND date(tl.worked_at) <= date(?)
      ORDER BY tl.worked_at DESC, tl.id DESC
    `,
    )
    .all(adminUserId, fromRaw, toRaw);
  const idleRows = db
    .prepare(
      `
      SELECT
        il.id,
        'idle' AS entry_type,
        il.reason AS idle_reason,
        NULL AS job_id,
        NULL AS job_number,
        NULL AS vehicle_registration,
        NULL AS vehicle_make,
        NULL AS vehicle_model,
        il.hours,
        il.notes,
        il.worked_at
      FROM mechanic_idle_time_logs il
      WHERE il.admin_user_id = ?
        AND date(il.worked_at) >= date(?)
        AND date(il.worked_at) <= date(?)
      ORDER BY il.worked_at DESC, il.id DESC
    `,
    )
    .all(adminUserId, fromRaw, toRaw);
  const rows = [...jobRows, ...idleRows].sort((a, b) => {
    const aw = String(a.worked_at || '');
    const bw = String(b.worked_at || '');
    if (bw !== aw) return bw.localeCompare(aw);
    return Number(b.id || 0) - Number(a.id || 0);
  });

  res.json({ from: fromRaw, to: toRaw, member, rows });
});

