import { db } from '../db.js';

/** Automatically clock out if still clocked in after this duration (ms). */
export const AUTO_CLOCK_OUT_AFTER_MS = 12 * 60 * 60 * 1000;

function buildEventId(sourceEventId, adminUserId, eventType, occurredAt) {
  return sourceEventId ?? `${adminUserId}-${eventType}-${occurredAt}`;
}

const OPEN_CLOCK_IN_SQL = `
  SELECT ae.admin_user_id, ae.occurred_at AS clocked_in_at
  FROM attendance_events ae
  INNER JOIN (
    SELECT admin_user_id, MAX(occurred_at) AS max_at
    FROM attendance_events
    GROUP BY admin_user_id
  ) latest ON latest.admin_user_id = ae.admin_user_id AND latest.max_at = ae.occurred_at
  JOIN admin_users au ON au.id = ae.admin_user_id
  WHERE ae.event_type = 'clock_in' AND au.active = 1
`;

/**
 * Insert system clock-out events for anyone still clocked in 12+ hours after their last clock-in.
 * Clock-out time is exactly 12 hours after clock-in (not "now").
 * @returns {{ adminUserId: number, clockedInAt: string, clockedOutAt: string }[]}
 */
export function applyAutoClockOuts(now = new Date()) {
  const nowMs = now.getTime();
  const rows = db.prepare(OPEN_CLOCK_IN_SQL).all();
  const applied = [];

  for (const row of rows) {
    const clockInMs = new Date(row.clocked_in_at).getTime();
    if (Number.isNaN(clockInMs)) continue;

    const autoOutMs = clockInMs + AUTO_CLOCK_OUT_AFTER_MS;
    if (autoOutMs > nowMs) continue;

    const clockInIso = new Date(clockInMs).toISOString();
    const autoOutIso = new Date(autoOutMs).toISOString();
    const sourceEventId = `auto-clockout-${row.admin_user_id}-${clockInIso}`;

    const result = recordAttendanceEvent({
      adminUserId: row.admin_user_id,
      eventType: 'clock_out',
      occurredAt: autoOutIso,
      deviceId: 'system:auto-clockout',
      sourceEventId,
    });

    if (result.ok && !result.duplicate) {
      applied.push({
        adminUserId: Number(row.admin_user_id),
        clockedInAt: clockInIso,
        clockedOutAt: autoOutIso,
      });
      console.log(
        `[attendance] Auto clock-out admin #${row.admin_user_id} at ${autoOutIso} (12h after ${clockInIso})`,
      );
    }
  }

  return applied;
}

function overlapHours(startMs, endMs, rangeStartMs, rangeEndMs) {
  const from = Math.max(startMs, rangeStartMs);
  const to = Math.min(endMs, rangeEndMs);
  if (!(to > from)) return 0;
  return (to - from) / (60 * 60 * 1000);
}

/**
 * Sum biometric clocked-in hours per admin user for an inclusive YYYY-MM-DD date range.
 * Sessions are clipped to the range. An open clock-in (no clock-out yet) counts until
 * min(now, clock-in + 12h). Applies auto clock-outs first so shifts past 12h are closed.
 * @returns {Map<number, number>} admin_user_id → hours (2 d.p.)
 */
export function hoursWorkedByAdminInRange(fromYmd, toYmd, now = new Date()) {
  applyAutoClockOuts(now);

  const rangeStartMs = Date.parse(`${fromYmd}T00:00:00.000Z`);
  const rangeEndMs = Date.parse(`${toYmd}T00:00:00.000Z`) + 24 * 60 * 60 * 1000;
  if (Number.isNaN(rangeStartMs) || Number.isNaN(rangeEndMs) || rangeEndMs <= rangeStartMs) {
    return new Map();
  }

  const rangeStartIso = new Date(rangeStartMs).toISOString();
  const rangeEndIso = new Date(rangeEndMs).toISOString();
  const nowMs = now.getTime();

  const priorRows = db
    .prepare(
      `
      SELECT ae.admin_user_id, ae.event_type, ae.occurred_at
      FROM attendance_events ae
      INNER JOIN (
        SELECT admin_user_id, MAX(occurred_at) AS max_at
        FROM attendance_events
        WHERE occurred_at < ?
        GROUP BY admin_user_id
      ) latest ON latest.admin_user_id = ae.admin_user_id AND latest.max_at = ae.occurred_at
    `,
    )
    .all(rangeStartIso);

  const openInByUser = new Map();
  for (const row of priorRows) {
    if (row.event_type === 'clock_in') {
      const atMs = new Date(row.occurred_at).getTime();
      if (!Number.isNaN(atMs)) openInByUser.set(Number(row.admin_user_id), atMs);
    }
  }

  const events = db
    .prepare(
      `
      SELECT admin_user_id, event_type, occurred_at
      FROM attendance_events
      WHERE occurred_at >= ?
        AND occurred_at < ?
      ORDER BY admin_user_id ASC, occurred_at ASC, rowid ASC
    `,
    )
    .all(rangeStartIso, rangeEndIso);

  const byUser = new Map();
  for (const ev of events) {
    const uid = Number(ev.admin_user_id);
    if (!byUser.has(uid)) byUser.set(uid, []);
    byUser.get(uid).push(ev);
  }

  const allUserIds = new Set([...openInByUser.keys(), ...byUser.keys()]);
  const hoursMap = new Map();

  for (const uid of allUserIds) {
    let openInMs = openInByUser.has(uid) ? openInByUser.get(uid) : null;
    let total = 0;

    for (const ev of byUser.get(uid) || []) {
      const atMs = new Date(ev.occurred_at).getTime();
      if (Number.isNaN(atMs)) continue;

      if (ev.event_type === 'clock_in') {
        openInMs = atMs;
        continue;
      }
      if (ev.event_type === 'clock_out' && openInMs != null) {
        total += overlapHours(openInMs, atMs, rangeStartMs, rangeEndMs);
        openInMs = null;
      }
    }

    if (openInMs != null) {
      const cappedEnd = Math.min(nowMs, openInMs + AUTO_CLOCK_OUT_AFTER_MS);
      total += overlapHours(openInMs, cappedEnd, rangeStartMs, rangeEndMs);
    }

    hoursMap.set(uid, Math.round((total + Number.EPSILON) * 100) / 100);
  }

  return hoursMap;
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
