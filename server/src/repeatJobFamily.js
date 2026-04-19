import { db } from './db.js';

const MAX_REPEAT_CHAIN = 50;

/** Walk related_job_id links to the workshop “mother” job (no further parent). */
export function findRepeatRootJobId(jobId) {
  let cur = Number(jobId);
  if (!Number.isFinite(cur) || cur <= 0) return null;
  for (let d = 0; d < MAX_REPEAT_CHAIN; d++) {
    const row = db.prepare('SELECT id, related_job_id FROM jobs WHERE id = ?').get(cur);
    if (!row) return null;
    const rel = row.related_job_id != null ? Number(row.related_job_id) : null;
    if (!rel || rel <= 0) return Number(row.id);
    cur = rel;
  }
  return null;
}

/** Strip a trailing “-N” visit suffix (single segment) for display / P&L grouping. */
export function repeatNumberBaseFromJobNumber(jobNumber) {
  const s = jobNumber != null ? String(jobNumber) : '';
  return s.replace(/-\d+$/, '') || s;
}

function likeEscapeForSqlite(s) {
  return String(s).replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
}

function escapeRegex(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Next repeat visit number for the same mother line, e.g. J1001-1, J1001-2.
 * Anchors on the job the user linked (any job in the chain); does not consume the global J sequence.
 */
export function allocateRepeatJobNumber(relatedJobId) {
  const rootId = findRepeatRootJobId(relatedJobId);
  if (!rootId) {
    throw new Error('repeat root job not found');
  }
  const rootRow = db.prepare('SELECT job_number FROM jobs WHERE id = ?').get(rootId);
  if (!rootRow?.job_number) {
    throw new Error('repeat root job has no job_number');
  }
  const base = repeatNumberBaseFromJobNumber(rootRow.job_number);
  const likePattern = `${likeEscapeForSqlite(base)}-%`;
  const rows = db
    .prepare(`SELECT job_number FROM jobs WHERE job_number LIKE ? ESCAPE '\\'`)
    .all(likePattern);
  const re = new RegExp(`^${escapeRegex(base)}-(\\d+)$`);
  let max = 0;
  for (const r of rows) {
    const m = re.exec(r.job_number);
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  return `${base}-${max + 1}`;
}
