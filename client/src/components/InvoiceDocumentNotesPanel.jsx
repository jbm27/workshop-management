import { useEffect, useState } from 'react';

/** Customer-facing notes on a quote or invoice (shown on PDF). */
export default function InvoiceDocumentNotesPanel({
  document,
  onSave,
  title = 'Customer notes',
}) {
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setNotes(document?.notes || '');
  }, [document?.notes, document?.id]);

  if (!document) return null;

  const dirty = notes !== (document.notes || '');

  const handleSave = async () => {
    setBusy(true);
    try {
      await onSave({ notes: notes.trim() || null });
    } finally {
      setBusy(false);
    }
  };

  const appendBullet = () => {
    setNotes((prev) => {
      const base = prev.replace(/\s*$/, '');
      if (!base) return '• ';
      return `${base}\n• `;
    });
  };

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
      <h4 style={{ margin: '0 0 0.5rem', fontSize: '0.95rem' }}>{title}</h4>
      <p style={{ margin: '0 0 0.75rem', fontSize: '0.85rem', color: 'var(--text-muted)' }}>
        Additional information for the customer — warranties, terms, or bullet lists. Line breaks are preserved and
        shown in a full-width box on the PDF.
      </p>
      <div className="form-group" style={{ margin: 0 }}>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={8}
          placeholder={'e.g.\n• Parts warranty: 12 months\n• Labour warranty: 6 months\n• Payment due within 14 days'}
          style={{ width: '100%', resize: 'vertical', minHeight: '8rem', fontFamily: 'inherit', lineHeight: 1.45 }}
        />
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', marginTop: '0.65rem', alignItems: 'center' }}>
        <button type="button" className="btn" onClick={appendBullet}>
          + Bullet line
        </button>
        <button type="button" className="btn primary" onClick={handleSave} disabled={busy || !dirty}>
          {busy ? 'Saving…' : 'Save notes'}
        </button>
      </div>
    </div>
  );
}
