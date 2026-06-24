import { useState } from 'react';

/** Collapsible subtext under a line description (view mode). */
export function InvoiceLineSubtextView({ subtext }) {
  const text = String(subtext || '').trim();
  const [open, setOpen] = useState(false);
  if (!text) return null;
  return (
    <>
      {open && (
        <div
          style={{
            fontSize: '0.9rem',
            color: 'var(--text-muted)',
            marginTop: '0.25rem',
            whiteSpace: 'pre-wrap',
          }}
        >
          {text}
        </div>
      )}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        style={{
          display: 'block',
          marginTop: '0.2rem',
          padding: 0,
          border: 'none',
          background: 'none',
          color: 'var(--accent)',
          cursor: 'pointer',
          fontSize: '0.85rem',
        }}
      >
        {open ? '...Hide' : 'More...'}
      </button>
    </>
  );
}

/** Textarea for optional line subtext (add/edit forms). */
export function InvoiceLineSubtextField({ name = 'subtext', id, defaultValue, className }) {
  return (
    <div className={className} style={{ marginTop: '0.5rem' }}>
      <label htmlFor={id} style={{ display: 'block', fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: '0.25rem' }}>
        Subtext (optional)
      </label>
      <textarea
        id={id}
        name={name}
        rows={3}
        defaultValue={defaultValue || ''}
        placeholder="e.g. (EA chains ltd)"
        style={{ width: '100%', resize: 'vertical' }}
      />
    </div>
  );
}
