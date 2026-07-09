import { useEffect, useState } from 'react';

/** Inline edit for job / invoice / quote numbers (must stay unique in the system). */
export default function EditableDocumentNumber({
  value,
  onSave,
  label,
  hint,
  compact = false,
  className,
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value || '');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!editing) setDraft(value || '');
  }, [value, editing]);

  const cancel = () => {
    setDraft(value || '');
    setEditing(false);
  };

  const save = async () => {
    const trimmed = draft.trim();
    if (!trimmed) {
      alert(`${label || 'Number'} is required.`);
      return;
    }
    if (trimmed === (value || '').trim()) {
      setEditing(false);
      return;
    }
    setBusy(true);
    try {
      await onSave(trimmed);
      setEditing(false);
    } catch (err) {
      alert(String(err?.message || 'Could not save number.'));
    } finally {
      setBusy(false);
    }
  };

  if (!editing) {
    return (
      <span
        className={className}
        style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem', flexWrap: 'wrap' }}
      >
        <span>{value}</span>
        <button
          type="button"
          className="btn"
          style={{ padding: compact ? '0.15rem 0.45rem' : '0.2rem 0.55rem', fontSize: compact ? '0.75rem' : '0.8rem' }}
          onClick={() => setEditing(true)}
        >
          Edit
        </button>
      </span>
    );
  }

  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', gap: '0.5rem' }}>
      <div className="form-group" style={{ margin: 0, minWidth: compact ? '10rem' : '12rem' }}>
        {label ? <label>{label}</label> : null}
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          autoFocus
          onKeyDown={(e) => {
            if (e.key === 'Enter') void save();
            if (e.key === 'Escape') cancel();
          }}
          style={compact ? { fontSize: '0.9rem' } : undefined}
        />
        {hint ? (
          <p style={{ margin: '0.35rem 0 0', fontSize: '0.75rem', color: 'var(--text-muted)' }}>{hint}</p>
        ) : null}
      </div>
      <button type="button" className="btn primary" disabled={busy} onClick={() => void save()}>
        {busy ? 'Saving…' : 'Save'}
      </button>
      <button type="button" className="btn" disabled={busy} onClick={cancel}>
        Cancel
      </button>
    </div>
  );
}
