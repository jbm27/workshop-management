import { isHeaderLine } from './invoiceLineSections';

/**
 * Per-line progress tracker stages, in order.
 * `approved` is ticked by the customer in the portal; the rest are ticked by workshop staff.
 */
export const LINE_PROGRESS_STAGES = [
  { key: 'approved', label: 'Approved', who: 'Customer' },
  { key: 'lpo_issued', label: 'LPO issued', who: 'Stores' },
  { key: 'received', label: 'Received', who: 'Mechanic / supervisor' },
  { key: 'fitted', label: 'Fitted', who: 'Mechanic' },
  { key: 'tested', label: 'Vehicle tested', who: 'Mechanic / supervisor' },
];

export function isStageDone(item, key) {
  if (key === 'approved') return Number(item?.approved) === 1;
  return !!item?.[`${key}_at`];
}

export function stageDoneAt(item, key) {
  return item?.[`${key}_at`] || null;
}

export function stageDoneBy(item, key) {
  return item?.[`${key}_by`] || null;
}

/** Lines that get a tracker: real items (not section headers, not the labour line). */
export function isTrackableLine(item) {
  return !!item && !isHeaderLine(item) && String(item.type || '').toLowerCase() !== 'labour';
}

export function lineProgressPercent(item) {
  const done = LINE_PROGRESS_STAGES.filter((s) => isStageDone(item, s.key)).length;
  return Math.round((done / LINE_PROGRESS_STAGES.length) * 100);
}

/** Whole-job progress: every stage of every tracked line counts equally. Null when nothing is tracked. */
export function jobProgressSummary(items) {
  const lines = (items || []).filter(isTrackableLine);
  if (lines.length === 0) return null;
  const total = lines.length * LINE_PROGRESS_STAGES.length;
  const done = lines.reduce(
    (n, it) => n + LINE_PROGRESS_STAGES.filter((s) => isStageDone(it, s.key)).length,
    0,
  );
  const complete = lines.filter((it) => lineProgressPercent(it) === 100).length;
  return { percent: Math.round((done / total) * 100), lines: lines.length, complete };
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
