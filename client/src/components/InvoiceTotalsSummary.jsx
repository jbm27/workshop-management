import { computeInvoiceTotalsFromLines } from '../utils/invoiceLineVat';

export function formatKes(n) {
  const x = Number(n);
  if (!Number.isFinite(x)) return '—';
  return `KES ${x.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}

/** Live quote/invoice totals from the current lines, including discount savings. */
export default function InvoiceTotalsSummary({
  items,
  discountPercent,
  amountPaid,
  showPayments = false,
}) {
  const breakdown = computeInvoiceTotalsFromLines(items || [], {
    discount_percent: discountPercent,
  });
  const paid = Number(amountPaid) || 0;
  const balance = Math.round((breakdown.total - paid) * 100) / 100;

  return (
    <div style={{ marginTop: '1rem', textAlign: 'right', maxWidth: '380px', marginLeft: 'auto' }}>
      <p style={{ margin: '0.25rem 0' }}>
        Subtotal (ex VAT) <strong>{formatKes(breakdown.subtotal)}</strong>
      </p>
      <p style={{ margin: '0.25rem 0', color: 'var(--text-muted)' }}>
        VAT <strong>{formatKes(breakdown.tax_amount)}</strong>
      </p>
      <p style={{ margin: '0.5rem 0 0', fontSize: '1.1rem' }}>
        Total (inc VAT) <strong>{formatKes(breakdown.total)}</strong>
      </p>
      {breakdown.total_saving > 0 && (
        <p
          style={{
            margin: '0.75rem 0 0',
            padding: '0.55rem 0.7rem',
            textAlign: 'left',
            background: 'var(--bg)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius)',
            fontSize: '0.92rem',
          }}
        >
          Total saving as a result of the discount:{' '}
          <strong>{formatKes(breakdown.total_saving)}</strong> (including VAT).
        </p>
      )}
      {showPayments && (
        <>
          <p style={{ margin: '0.65rem 0 0.25rem' }}>
            <span style={{ color: 'var(--text-muted)' }}>Paid to date</span>{' '}
            <strong>{formatKes(paid)}</strong>
          </p>
          <p style={{ margin: '0.25rem 0 0' }}>
            <span style={{ color: 'var(--text-muted)' }}>Balance</span>{' '}
            <strong>{formatKes(balance)}</strong>
          </p>
        </>
      )}
    </div>
  );
}
