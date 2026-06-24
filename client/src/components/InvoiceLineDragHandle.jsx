/** Six-dot grip used to drag-reorder invoice/quote lines. */
export default function InvoiceLineDragHandle({ disabled, onDragStart, onDragEnd }) {
  return (
    <td
      style={{
        width: '1.75rem',
        padding: '0.35rem 0.25rem',
        verticalAlign: 'middle',
        color: 'var(--text-muted)',
        userSelect: 'none',
      }}
    >
      <span
        role="button"
        tabIndex={disabled ? -1 : 0}
        aria-label="Drag to reorder"
        title={disabled ? undefined : 'Drag to reorder'}
        draggable={!disabled}
        onDragStart={disabled ? undefined : onDragStart}
        onDragEnd={disabled ? undefined : onDragEnd}
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(2, 4px)',
          gap: '3px',
          cursor: disabled ? 'default' : 'grab',
          opacity: disabled ? 0.35 : 1,
          padding: '2px',
        }}
      >
        {Array.from({ length: 6 }, (_, i) => (
          <span
            key={i}
            style={{
              width: 4,
              height: 4,
              borderRadius: '50%',
              background: 'currentColor',
            }}
          />
        ))}
      </span>
    </td>
  );
}
