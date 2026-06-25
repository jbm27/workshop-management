import { useEffect, useState } from 'react';
import { computeInvoiceTotalsFromLines } from '../utils/invoiceLineVat';

function formatKes(n) {
  const x = Number(n);
  if (Number.isNaN(x)) return '—';
  return `KES ${x.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}

/** Document-level percentage discount with save. */
export default function InvoiceDocumentDiscountPanel({ document, onSave, title = 'Document discount' }) {
  const [discountPercent, setDiscountPercent] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const pct = Number(document?.discount_percent) || 0;
    setDiscountPercent(pct > 0 ? String(pct) : '');
  }, [document?.discount_percent, document?.id]);

  if (!document) return null;

  const breakdown = computeInvoiceTotalsFromLines(document.items || [], {
    discount_percent: document.discount_percent,
  });

  const handleSave = async () => {
    setBusy(true);
    try {
      await onSave({
        discount_percent: discountPercent.trim() === '' ? 0 : Number(discountPercent),
      });
    } finally {
      setBusy(false);
    }
  };

  const dirty =
    (discountPercent.trim() === '' ? 0 : Number(discountPercent) || 0) !== (Number(document.discount_percent) || 0);

  return (
    <div
      style={{
        marginTop: '1rem',
        padding: '1rem',
        background: 'var(--bg)',
        borderRadius: 'var(--radius)',
        border: '1px solid var(--border)',
      }}
    >
      <h4 style={{ margin: '0 0 0.75rem', fontSize: '0.95rem' }}>{title}</h4>
      <p style={{ margin: '0 0 0.75rem', fontSize: '0.85rem', color: 'var(--text-muted)' }}>
        Apply a percentage off the whole {document.type === 'quote' ? 'quote' : 'invoice'}. Line discounts are applied
        first.
      </p>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '1rem', alignItems: 'end', marginBottom: '0.75rem' }}>
        <div className="form-group" style={{ margin: 0 }}>
          <label>Discount %</label>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
            <input
              type="number"
              min="0"
              max="100"
              step="0.01"
              value={discountPercent}
              onChange={(e) => setDiscountPercent(e.target.value)}
              placeholder="0"
              style={{ width: '5rem' }}
            />
            <span>%</span>
          </div>
        </div>
        <button type="button" className="btn primary" onClick={handleSave} disabled={busy || !dirty}>
          {busy ? 'Saving…' : 'Apply discount'}
        </button>
      </div>
      <div style={{ fontSize: '0.9rem' }}>
        <p style={{ margin: '0.25rem 0' }}>
          Total (inc VAT): <strong>{formatKes(document.total)}</strong>
        </p>
        <p style={{ margin: '0.25rem 0', color: 'var(--text-muted)' }}>
          Subtotal (ex VAT) {formatKes(document.subtotal)}
          {' · '}
          VAT {formatKes(document.tax_amount)}
        </p>
        {breakdown.line_discount_total > 0 && (
          <p style={{ margin: '0.25rem 0', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
            Line discounts applied: {formatKes(breakdown.line_discount_total)}
          </p>
        )}
        {breakdown.document_discount_total > 0 && (
          <p style={{ margin: '0.25rem 0', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
            Document discount applied: {formatKes(breakdown.document_discount_total)}
          </p>
        )}
      </div>
    </div>
  );
}
