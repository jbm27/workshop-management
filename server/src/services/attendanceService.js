import { db } from '../db.js';

function buildEventId(sourceEventId, adminUserId, eventType, occurredAt) {
  return sourceEventId ?? `${adminUserId}-${eventType}-${occurredAt}`;
}

export function recordAttendanceEvent({
  adminUserId,
  eventType,
  occurredAt,
  deviceId,
  sourceEventId,
}) {
  if (!adminUserId || !eventType) {
    throw new Error('adminUserId and eventType are required');
  }
  if (eventType !== 'clock_in' && eventType !== 'clock_out') {
    throw new Error('eventType must be clock_in or clock_out');
  }

  const timestamp = occurredAt ? new Date(occurredAt) : new Date();
  if (Number.isNaN(timestamp.getTime())) {
    throw new Error('occurredAt must be a valid date/time');
  }

  const iso = timestamp.toISOString();
  const id = buildEventId(sourceEventId, adminUserId, eventType, iso);

  try {
    db.prepare(
      `
      INSERT INTO attendance_events (id, admin_user_id, event_type, occurred_at, device_id, source_event_id)
      VALUES (?, ?, ?, ?, ?, ?)
    `,
    ).run(id, adminUserId, eventType, iso, deviceId ?? null, sourceEventId ?? id);
    return { ok: true, duplicate: false, id };
  } catch (error) {
    if (String(error?.message || '').includes('UNIQUE')) {
      return { ok: true, duplicate: true, id };
    }
    throw error;
  }
}
