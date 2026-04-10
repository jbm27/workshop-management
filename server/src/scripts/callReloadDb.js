/**
 * Call POST /api/reload-db so a running API reloads workshop.db from disk (after import).
 * Usage: node src/scripts/callReloadDb.js
 * Default URL: http://localhost:3001 (override with RELOAD_URL=...)
 */
const base = process.env.RELOAD_URL || `http://localhost:${process.env.PORT || 3001}`;
const url = `${base.replace(/\/$/, '')}/api/reload-db`;

const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' } });
const body = await res.json().catch(() => ({}));
if (!res.ok) {
  console.error(res.status, body.error || body);
  process.exit(1);
}
console.log('Reload OK:', body);
