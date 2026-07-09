import { db } from './db.js';

const INTAKE_HANDOVER_MESSAGE =
  'Record mileage in, fuel in, and valuables in the Mileage & fuel section before using quotes, invoices, or LPOs/IPRs.';

function repeatVisitHandoverSuppressed(jobRow) {
  if (Number(jobRow?.is_repeat_job) !== 1) return false;
  return String(jobRow?.related_job_status) !== 'completed';
}

function intakeHandoverRow(jobRow) {
  if (!jobRow) return null;
  if (repeatVisitHandoverSuppressed(jobRow) && jobRow.related_job_id) {
    return db
      .prepare('SELECT odometer_in, fuel_in, valuables_in_vehicle FROM jobs WHERE id = ?')
      .get(jobRow.related_job_id);
  }
  return jobRow;
}

export function checkJobIntakeHandover(jobRow) {
  const row = intakeHandoverRow(jobRow);
  if (!row) {
    return { ok: false, error: INTAKE_HANDOVER_MESSAGE };
  }
  const oi = row.odometer_in != null && row.odometer_in !== '' ? Number(row.odometer_in) : NaN;
  if (!Number.isFinite(oi) || oi < 0) {
    return { ok: false, error: INTAKE_HANDOVER_MESSAGE };
  }
  if (!row.fuel_in || !String(row.fuel_in).trim()) {
    return { ok: false, error: INTAKE_HANDOVER_MESSAGE };
  }
  const valStr = row.valuables_in_vehicle != null ? String(row.valuables_in_vehicle).trim() : '';
  if (!valStr) {
    return { ok: false, error: INTAKE_HANDOVER_MESSAGE };
  }
  return { ok: true };
}

export function loadJobForCardRules(jobId) {
  return db
    .prepare(
      `
    SELECT j.*, r.status AS related_job_status
    FROM jobs j
    LEFT JOIN jobs r ON r.id = j.related_job_id
    WHERE j.id = ?
  `,
    )
    .get(jobId);
}

export function countUnfinalizedLpoIprForJob(jobId) {
  const invoices = db.prepare(`SELECT id FROM invoices WHERE job_id = ? AND type = 'invoice'`).all(jobId);
  let count = 0;
  for (const inv of invoices) {
    count += Number(
      db.prepare(`SELECT COUNT(*) AS c FROM lpos WHERE invoice_id = ? AND COALESCE(finalized, 0) = 0`).get(inv.id)?.c,
    ) || 0;
    count += Number(
      db.prepare(`SELECT COUNT(*) AS c FROM iprs WHERE invoice_id = ? AND COALESCE(finalized, 0) = 0`).get(inv.id)?.c,
    ) || 0;
  }
  return count;
}

export function checkAllLpoIprFinalizedForJob(jobId) {
  const count = countUnfinalizedLpoIprForJob(jobId);
  if (count > 0) {
    return {
      ok: false,
      error:
        'All LPOs and IPRs must be finalised (with every part marked received) before the vehicle can be released.',
    };
  }
  return { ok: true };
}

export function checkJobInvoiceFullyPaid(jobId, isRepeatJob = false) {
  if (Number(isRepeatJob) === 1) return { ok: true };
  const inv = db.prepare(`SELECT id, total, type FROM invoices WHERE job_id = ? AND type = 'invoice'`).get(jobId);
  if (!inv) {
    return { ok: false, error: 'Create and fully pay the job invoice before marking the job complete.' };
  }
  const total = Number(inv.total) || 0;
  if (total <= 0) return { ok: true };
  const paid =
    Number(db.prepare('SELECT COALESCE(SUM(amount), 0) AS s FROM invoice_payments WHERE invoice_id = ?').get(inv.id)?.s) ||
    0;
  if (paid + 0.009 < total) {
    const balance = Math.round((total - paid) * 100) / 100;
    return {
      ok: false,
      error: `The invoice must be fully paid before completing the job (outstanding balance: KES ${balance.toLocaleString()}).`,
    };
  }
  return { ok: true };
}

export function checkInvoicePdfAllowedForJobStatus(status) {
  const s = String(status || '');
  if (s === 'vehicle_released' || s === 'completed') return { ok: true };
  return {
    ok: false,
    error: 'Invoice PDF is only available after the job status is Vehicle released or Complete.',
  };
}

export function assertJobIntakeHandoverForJobId(jobId, res) {
  const job = loadJobForCardRules(jobId);
  if (!job) {
    res.status(404).json({ error: 'Job not found' });
    return false;
  }
  const check = checkJobIntakeHandover(job);
  if (!check.ok) {
    res.status(400).json({ error: check.error });
    return false;
  }
  return true;
}

export function assertJobIntakeHandoverForInvoiceId(invoiceId, res) {
  const inv = db.prepare('SELECT job_id FROM invoices WHERE id = ?').get(invoiceId);
  if (!inv?.job_id) return true;
  return assertJobIntakeHandoverForJobId(inv.job_id, res);
}
