import { db } from './db.js';

const AVERAGE_LABOUR_COST_KEY = 'average_labour_cost_per_hour';

/** KES per hour — used to estimate internal labour cost on jobs (time logs × this rate). */
export function getAverageLabourCostPerHour() {
  const row = db.prepare('SELECT value_real FROM app_settings WHERE key = ?').get(AVERAGE_LABOUR_COST_KEY);
  const n = Number(row?.value_real);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

export function setAverageLabourCostPerHour(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) {
    throw new Error('average_labour_cost_per_hour must be a non-negative number');
  }
  db.prepare(
    `INSERT INTO app_settings (key, value_real, updated_at) VALUES (?, ?, datetime('now'))
     ON CONFLICT(key) DO UPDATE SET value_real = excluded.value_real, updated_at = excluded.updated_at`,
  ).run(AVERAGE_LABOUR_COST_KEY, n);
  return n;
}
