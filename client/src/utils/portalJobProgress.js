export function partFlagOn(part, key) {
  return Number(part?.[key]) === 1;
}

/** A customer invoice line is ticked only when every purchased part under it is ticked. */
export function allPartsFlagged(parts, key) {
  return Array.isArray(parts) && parts.length > 0 && parts.every((part) => partFlagOn(part, key));
}

/**
 * Each purchased part contributes two steps (received and fitted).
 * Each job task contributes one step.
 */
export function jobProgressCounts(job) {
  const parts = (job?.invoice?.items || []).flatMap((item) => item.parts || []);
  const tasks = job?.tasks || [];
  const done =
    parts.filter((part) => partFlagOn(part, 'received_confirmed')).length +
    parts.filter((part) => partFlagOn(part, 'fitted_confirmed')).length +
    tasks.filter((task) => Number(task?.completed) === 1).length;
  const total = parts.length * 2 + tasks.length;
  return { done, total };
}
