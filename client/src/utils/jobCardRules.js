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

export function canSetVehicleReleased(job, lpos = [], iprs = []) {
  if (job?.unfinalized_lpo_ipr_count != null) {
    return Number(job.unfinalized_lpo_ipr_count) === 0;
  }
  return countUnfinalizedLpoIpr(lpos, iprs) === 0;
}

export function vehicleReleasedBlockedMessage() {
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
