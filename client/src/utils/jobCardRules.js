const INTAKE_HANDOVER_MESSAGE =
  'Record mileage in, fuel in, and valuables in the Mileage & fuel section before using quotes, invoices, or LPOs/IPRs.';

export function jobIntakeHandoverComplete(job) {
  if (job?.intake_handover_complete === true) return true;
  if (job?.intake_handover_complete === false) return false;
  const oi = job?.odometer_in != null && job.odometer_in !== '' ? Number(job.odometer_in) : NaN;
  if (!Number.isFinite(oi) || oi < 0) return false;
  if (!job?.fuel_in || !String(job.fuel_in).trim()) return false;
  const valStr = job?.valuables_in_vehicle != null ? String(job.valuables_in_vehicle).trim() : '';
  return Boolean(valStr);
}

export function intakeHandoverBlockedMessage() {
  return INTAKE_HANDOVER_MESSAGE;
}

export function canUseJobBilling(job) {
  return jobIntakeHandoverComplete(job);
}

export function canDownloadJobInvoicePdf(job) {
  const s = String(job?.status || '');
  return s === 'vehicle_released' || s === 'completed';
}

export function invoicePdfBlockedMessage() {
  return 'Invoice PDF is only available after the job status is Vehicle released or Complete.';
}

export function countUnfinalizedLpoIpr(lpos = [], iprs = []) {
  const unfinalizedLpos = (lpos || []).filter((d) => Number(d.finalized) !== 1).length;
  const unfinalizedIprs = (iprs || []).filter((d) => Number(d.finalized) !== 1).length;
  return unfinalizedLpos + unfinalizedIprs;
}

export function jobExitReadingsComplete(job) {
  const oo = job?.odometer_out != null && job.odometer_out !== '' ? Number(job.odometer_out) : NaN;
  if (!Number.isFinite(oo) || oo < 0) return false;
  if (!job?.fuel_out || !String(job.fuel_out).trim()) return false;
  return true;
}

export function jobTasksAllComplete(job, tasks) {
  const list = Array.isArray(tasks) ? tasks : job?.tasks || [];
  const real = list.filter((t) => {
    if (typeof t === 'string') return Boolean(String(t).trim());
    return Boolean(t?.description != null && String(t.description).trim());
  });
  if (!real.length) return true;
  return real.every((t) => Number(t?.completed) === 1 || t?.completed === true);
}

export function vehicleReleasedBlockedReasons(job, lpos = [], iprs = [], tasks) {
  const reasons = [];
  const lpoOk =
    job?.unfinalized_lpo_ipr_count != null
      ? Number(job.unfinalized_lpo_ipr_count) === 0
      : countUnfinalizedLpoIpr(lpos, iprs) === 0;
  if (!lpoOk) {
    reasons.push(
      'All LPOs and IPRs must be finalised (with every part marked received) before the vehicle can be released.',
    );
  }
  if (!jobExitReadingsComplete(job)) {
    reasons.push(
      'Record mileage out and fuel out in the Mileage & fuel section before the vehicle can be released.',
    );
  }
  if (!jobTasksAllComplete(job, tasks)) {
    reasons.push('Mark all job tasks as complete before the vehicle can be released.');
  }
  return reasons;
}

export function canSetVehicleReleased(job, lpos = [], iprs = [], tasks) {
  return vehicleReleasedBlockedReasons(job, lpos, iprs, tasks).length === 0;
}

export function vehicleReleasedBlockedMessage(job, lpos = [], iprs = [], tasks) {
  const reasons = vehicleReleasedBlockedReasons(job, lpos, iprs, tasks);
  if (reasons.length) return reasons.join(' ');
  return 'All LPOs and IPRs must be finalised (with every part marked received) before the vehicle can be released.';
}

export function isJobInvoiceFullyPaid(job, invoice) {
  if (Number(job?.is_repeat_job) === 1) return true;
  if (!invoice) return false;
  const total = Number(invoice.total) || 0;
  if (total <= 0) return true;
  const paid =
    Number(
      invoice.amount_paid ?? (invoice.payments || []).reduce((s, p) => s + Number(p.amount || 0), 0),
    ) || 0;
  return paid + 0.009 >= total;
}

export function completeJobBlockedMessage(invoice, invoiceBalance) {
  if (!invoice) return 'Create and fully pay the job invoice before marking the job complete.';
  const balance = invoiceBalance != null ? Number(invoiceBalance) : null;
  if (balance != null && balance > 0.009) {
    return `The invoice must be fully paid before completing the job (outstanding balance: KES ${balance.toLocaleString()}).`;
  }
  return 'The invoice must be fully paid before completing the job.';
}
