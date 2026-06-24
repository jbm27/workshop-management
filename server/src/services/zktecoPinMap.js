import { db } from '../db.js';
import { applyAutoClockOuts } from './attendanceService.js';

export function resolveAdminUserIdFromDevicePin(pin) {
  const raw = String(pin ?? '').trim();
  if (!raw) {
    return null;
  }

  const byPin = db
    .prepare('SELECT id FROM admin_users WHERE active = 1 AND biometric_pin = ? LIMIT 1')
    .get(raw);
  if (byPin) {
    return Number(byPin.id);
  }

  if (/^\d+$/.test(raw)) {
    const byId = db
      .prepare('SELECT id FROM admin_users WHERE active = 1 AND id = ? LIMIT 1')
      .get(Number(raw));
    if (byId) {
      return Number(byId.id);
    }
  }

  return null;
}

export function mapZkStatusToEventType(statusCode) {
  const status = Number(statusCode);
  if (status === 0) {
    return 'clock_in';
  }
  if (status === 1) {
    return 'clock_out';
  }
  return null;
}

export function getClockedInAdminUserIds() {
  applyAutoClockOuts();
  const rows = db
    .prepare(
      `
      SELECT ae.admin_user_id
      FROM attendance_events ae
      INNER JOIN (
        SELECT admin_user_id, MAX(occurred_at) AS max_at
        FROM attendance_events
        GROUP BY admin_user_id
      ) latest ON latest.admin_user_id = ae.admin_user_id AND latest.max_at = ae.occurred_at
      WHERE ae.event_type = 'clock_in'
    `,
    )
    .all();
  return rows.map((row) => Number(row.admin_user_id));
}

export function resolveEventTypeForPin(pin, statusCode, clockedInIds = []) {
  const mapped = mapZkStatusToEventType(statusCode);
  if (mapped) {
    return mapped;
  }

  const adminUserId = resolveAdminUserIdFromDevicePin(pin);
  if (!adminUserId) {
    return 'clock_in';
  }
  return clockedInIds.includes(adminUserId) ? 'clock_out' : 'clock_in';
}
