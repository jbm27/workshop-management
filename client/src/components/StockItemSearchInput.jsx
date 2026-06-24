import { useEffect, useId, useRef, useState } from 'react';
import { api } from '../api';
import { formatStockItemLabel } from '../utils/stockItemLabel';

/**
 * Search-as-you-type picker for store stock items (code or name).
 */
export default function StockItemSearchInput({
  query,
  onQueryChange,
  onSelect,
  selectedStockItemId = null,
  placeholder = 'Search store items…',
  disabled = false,
  required = false,
}) {
  const listId = useId();
  const rootRef = useRef(null);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [options, setOptions] = useState([]);
  const [activeIdx, setActiveIdx] = useState(0);

  useEffect(() => {
    const q = String(query || '').trim();
    if (!open || q.length < 1) {
      setOptions([]);
      setLoading(false);
      return undefined;
    }

    let cancelled = false;
    const timer = setTimeout(() => {
      setLoading(true);
      api.stock
        .list({ q })
        .then((rows) => {
          if (!cancelled) {
            setOptions(Array.isArray(rows) ? rows.slice(0, 20) : []);
            setActiveIdx(0);
          }
        })
        .catch(() => {
          if (!cancelled) setOptions([]);
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    }, 200);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query, open]);

  useEffect(() => {
    const onDocDown = (e) => {
      if (rootRef.current && !rootRef.current.contains(e.target)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onDocDown);
    return () => document.removeEventListener('mousedown', onDocDown);
  }, []);

  const pick = (item) => {
    onSelect?.(item);
    onQueryChange?.(formatStockItemLabel(item));
    setOpen(false);
  };

  const showList = open && String(query || '').trim().length > 0;

  return (
    <div ref={rootRef} style={{ position: 'relative' }}>
      <input
        type="search"
        value={query}
        disabled={disabled}
        required={required}
        autoComplete="off"
        role="combobox"
        aria-expanded={showList}
        aria-controls={listId}
        aria-autocomplete="list"
        placeholder={placeholder}
        onChange={(e) => {
          onQueryChange?.(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            setOpen(false);
            return;
          }
          if (!showList || !options.length) return;
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            setActiveIdx((i) => Math.min(i + 1, options.length - 1));
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setActiveIdx((i) => Math.max(i - 1, 0));
          } else if (e.key === 'Enter' && options[activeIdx]) {
            e.preventDefault();
            pick(options[activeIdx]);
          }
        }}
        style={{ width: '100%', boxSizing: 'border-box' }}
      />
      {selectedStockItemId ? (
        <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.2rem' }}>
          Linked to store item #{selectedStockItemId}
        </div>
      ) : null}
      {showList && (
        <ul
          id={listId}
          role="listbox"
          style={{
            position: 'absolute',
            zIndex: 40,
            left: 0,
            right: 0,
            top: '100%',
            margin: '2px 0 0',
            padding: 0,
            listStyle: 'none',
            background: 'var(--surface, #fff)',
            border: '1px solid var(--border, #ccc)',
            borderRadius: 'var(--radius, 4px)',
            maxHeight: '220px',
            overflowY: 'auto',
            boxShadow: '0 4px 12px rgba(0,0,0,0.12)',
          }}
        >
          {loading && <li style={{ padding: '0.5rem 0.65rem', color: 'var(--text-muted)' }}>Searching…</li>}
          {!loading && options.length === 0 && (
            <li style={{ padding: '0.5rem 0.65rem', color: 'var(--text-muted)' }}>No matching store items</li>
          )}
          {!loading &&
            options.map((item, idx) => (
              <li key={item.id}>
                <button
                  type="button"
                  role="option"
                  aria-selected={idx === activeIdx}
                  onMouseEnter={() => setActiveIdx(idx)}
                  onClick={() => pick(item)}
                  style={{
                    display: 'block',
                    width: '100%',
                    textAlign: 'left',
                    padding: '0.45rem 0.65rem',
                    border: 'none',
                    background: idx === activeIdx ? 'var(--primary, #2563eb)' : 'transparent',
                    color: idx === activeIdx ? '#fff' : 'inherit',
                    cursor: 'pointer',
                    fontSize: '0.9rem',
                  }}
                >
                  {formatStockItemLabel(item)}
                  {item.quantity != null ? (
                    <span style={{ opacity: 0.85, fontSize: '0.8rem' }}> · {Number(item.quantity)} in stock</span>
                  ) : null}
                </button>
              </li>
            ))}
        </ul>
      )}
    </div>
  );
}
