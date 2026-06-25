/** Per-line percentage discount field (0–100). */
export function InvoiceLineDiscountField({ id, name = 'discount_percent', defaultValue }) {
  return (
    <label style={{ display: 'block', marginTop: '0.35rem', fontSize: '0.85rem', color: 'var(--text-muted)' }}>
      Discount
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', marginTop: '0.15rem' }}>
        <input
          type="number"
          id={id}
          name={name}
          min="0"
          max="100"
          step="0.01"
          defaultValue={defaultValue ?? 0}
          style={{ width: '4.5rem' }}
        />
        <span>%</span>
      </div>
    </label>
  );
}

export function readLineDiscountPercent(elementId) {
  const raw = elementId ? document.getElementById(elementId)?.value : null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.min(100, n);
}

export function InvoiceLineDiscountView({ discountPercent }) {
  const disc = Number(discountPercent) || 0;
  if (disc <= 0) return null;
  return (
    <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.2rem' }}>
      {disc}% discount
    </div>
  );
}
