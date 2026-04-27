import crypto from 'crypto';
import { db } from './db.js';

const TOKEN_PREFIX = 'admin_';

function getBearerToken(req) {
  const h = req.headers?.authorization;
  if (!h) return null;
  const m = String(h).match(/^Bearer\s+(.+)$/i);
  if (!m) return null;
  const token = m[1];
  if (!token) return null;
  return token.startsWith(TOKEN_PREFIX) ? token : token; // keep as-is
}

export function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.pbkdf2Sync(password, salt, 100000, 64, 'sha512').toString('hex');
  return { salt, hash };
}

export function verifyPassword(password, salt, expectedHash) {
  const hash = crypto.pbkdf2Sync(password, salt, 100000, 64, 'sha512').toString('hex');
  return hash === expectedHash;
}

function adminFromToken(token) {
  if (!token) return null;
  const tokenRow = db.prepare(
    `
    SELECT au.*, s.token as session_token
    FROM admin_sessions s
    JOIN admin_users au ON au.id = s.admin_user_id
    WHERE s.token = ?
      AND au.active = 1
      AND (s.expires_at IS NULL OR s.expires_at >= datetime('now'))
    LIMIT 1
  `,
  ).get(token);
  return tokenRow || null;
}

function toAdminPayload(row) {
  return {
    id: row.id,
    username: row.username,
    display_name: row.display_name,
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
  };
}

export function requireAdminAuth(req, res, next) {
  const token = getBearerToken(req);
  if (!token) return res.status(401).json({ error: 'Not authenticated' });
  const adminRow = adminFromToken(token);
  if (!adminRow) return res.status(401).json({ error: 'Invalid or expired session' });
  req.admin = toAdminPayload(adminRow);
  next();
}

export function requireAdminPermission(permissionKey) {
  return (req, res, next) => {
    // If req.admin isn't already set, try to authenticate from bearer token.
    if (!req.admin) {
      const token = getBearerToken(req);
      if (!token) return res.status(401).json({ error: 'Not authenticated' });
      const adminRow = adminFromToken(token);
      if (!adminRow) return res.status(401).json({ error: 'Invalid or expired session' });
      req.admin = toAdminPayload(adminRow);
    }
    if (req.admin.is_mechanic) return res.status(403).json({ error: 'Forbidden' });
    const ok = Boolean(req.admin.permissions?.[permissionKey]);
    if (!ok) return res.status(403).json({ error: 'Forbidden' });
    next();
  };
}

/** Use after requireAdminAuth — mechanics may not list team members for assignment UIs. */
export function denyMechanics(req, res, next) {
  if (req.admin?.is_mechanic) return res.status(403).json({ error: 'Forbidden' });
  next();
}

export function newSessionToken() {
  return `${TOKEN_PREFIX}${crypto.randomBytes(24).toString('hex')}`;
}

