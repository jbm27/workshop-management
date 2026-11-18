import { isHeaderLine } from './invoiceLineSections';

/**
 * Invoice line progress stages, in order. The server works out each stage
 * (server/src/invoiceLineProgress.js) and sends it as `item.progress`:
 *   - Approved comes from the customer approving the item on the quote.
 *   - LPO issued / Received / Fitted are also filled in automatically from the LPO/IPR
 *     parts on the line (`auto: true`); otherwise staff tick them on the invoice line.
 *   - Vehicle tested is ticked by staff.
 */
export const LINE_PROGRESS_STAGES = [
  { key: 'approved', label: 'Approved', who: 'Customer, on the quote' },
  { key: 'lpo_issued', label: 'LPO issued', who: 'Stores' },
  { key: 'received', label: 'Received', who: 'Mechanic / supervisor' },
  { key: 'fitted', label: 'Fitted', who: 'Mechanic' },
  { key: 'tested', label: 'Vehicle tested', who: 'Mechanic / supervisor' },
];

export function stageInfo(item, key) {
  return item?.progress?.stages?.[key] || null;
}

export function isStageDone(item, key) {
  if (item?.progress) return !!stageInfo(item, key)?.done;
  return key === 'approved' ? Number(item?.approved) === 1 : false;
}

/** A real item line: not a section header and not the job's labour line. */
export function isItemLine(item) {
  return !!item && !isHeaderLine(item) && String(item.type || '').toLowerCase() !== 'labour';
}

/** Invoice lines with a tracker (the server attaches `progress` to them). */
export function isTrackableLine(item) {
  return isItemLine(item) && !!item.progress;
}

export function lineProgressPercent(item) {
  if (item?.progress) return Number(item.progress.percent) || 0;
  const done = LINE_PROGRESS_STAGES.filter((s) => isStageDone(item, s.key)).length;
  return Math.round((done / LINE_PROGRESS_STAGES.length) * 100);
}

/**
 * Whole-job progress: every stage of every tracked line counts once, plus one step per job task.
 * Null when there is nothing to track.
 */
export function jobProgressSummary(items, tasks = []) {
  const lines = (items || []).filter(isTrackableLine);
  const taskList = Array.isArray(tasks) ? tasks : [];
  const total = lines.length * LINE_PROGRESS_STAGES.length + taskList.length;
  if (total === 0) return null;
  const done =
    lines.reduce((n, it) => n + LINE_PROGRESS_STAGES.filter((s) => isStageDone(it, s.key)).length, 0) +
    taskList.filter((t) => Number(t?.completed) === 1).length;
  const complete = lines.filter((it) => lineProgressPercent(it) === 100).length;
  return {
    percent: Math.round((done / total) * 100),
    lines: lines.length,
    complete,
    tasks: taskList.length,
    tasksDone: taskList.filter((t) => Number(t?.completed) === 1).length,
  };
}

/** SQLite `datetime('now')` is UTC without a zone marker; read it as UTC. */
export function formatStageDate(value) {
  if (!value) return '';
  const s = String(value);
  const iso = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}(:\d{2})?$/.test(s) ? `${s.replace(' ', 'T')}Z` : s;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return s;
  return d.toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}
