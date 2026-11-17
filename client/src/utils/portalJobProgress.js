export function partFlagOn(part, key) {
  return Number(part?.[key]) === 1;
}

/** IPRs are received from stock. They are not fitted, so they have no fitted step. */
export function partCanBeFitted(part) {
  return part?.source !== 'ipr';
}

/** One part stays on the invoice line. Two or more are listed underneath it. */
export function visiblePartRows(parts) {
  return Array.isArray(parts) && parts.length >= 2 ? parts : [];
}

export function lineReceived(parts) {
  if (!Array.isArray(parts) || parts.length === 0) return false;
  return parts.every((part) => partFlagOn(part, 'received_confirmed'));
}

export function lineFitted(parts) {
  if (!Array.isArray(parts) || parts.length === 0) return false;
  const fittable = parts.filter(partCanBeFitted);
  if (fittable.length === 0) return false;
  return fittable.every((part) => partFlagOn(part, 'fitted_confirmed'));
}

/**
 * Each LPO part contributes two steps (received and fitted).
 * Each IPR part contributes one step (received).
 * Each job task contributes one step.
 */
export function jobProgressCounts(job) {
  const parts = (job?.invoice?.items || []).flatMap((item) => item.parts || []);
  const tasks = job?.tasks || [];
  let done = tasks.filter((task) => Number(task?.completed) === 1).length;
  let total = tasks.length;
  for (const part of parts) {
    if (partFlagOn(part, 'received_confirmed')) done += 1;
    if (partCanBeFitted(part)) {
      total += 2;
      if (partFlagOn(part, 'fitted_confirmed')) done += 1;
    } else {
      total += 1;
    }
  }
  return { done, total };
}
