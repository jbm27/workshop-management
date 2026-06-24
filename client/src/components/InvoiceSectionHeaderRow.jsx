/** Grey section header row for invoice/quote line tables. */
export default function InvoiceSectionHeaderRow({
  item,
  sectionNet,
  labelColSpan,
  formatMoney,
  editable,
  editing,
  editTitle,
  onEditTitleChange,
  onStartEdit,
  onSave,
  onCancel,
  onRemove,
  sortable,
  dragHandle,
  rowProps,
}) {
  const title = item?.description || 'Section';
  const totalLabel = formatMoney ? formatMoney(sectionNet) : sectionNet;

  return (
    <tr {...rowProps} style={{ background: '#f0f0f0', ...(rowProps?.style || {}) }}>
      {sortable && dragHandle}
      <td colSpan={labelColSpan} style={{ fontWeight: 600, padding: '0.55rem 0.75rem', verticalAlign: 'middle' }}>
        {editing ? (
          <input
            value={editTitle}
            onChange={(e) => onEditTitleChange?.(e.target.value)}
            style={{ width: '100%', maxWidth: '28rem' }}
            autoFocus
          />
        ) : (
          title
        )}
      </td>
      <td style={{ textAlign: 'right', fontWeight: 600, padding: '0.55rem 0.75rem', whiteSpace: 'nowrap' }}>
        {totalLabel}
      </td>
      {editable && (
        <td style={{ padding: '0.55rem 0.75rem', whiteSpace: 'nowrap' }}>
          {editing ? (
            <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap' }}>
              <button type="button" className="btn primary" onClick={onSave}>
                Save
              </button>
              <button type="button" className="btn" onClick={onCancel}>
                Cancel
              </button>
            </div>
          ) : (
            <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap' }}>
              <button type="button" className="btn" onClick={onStartEdit}>
                Edit
              </button>
              <button type="button" className="btn danger" onClick={onRemove}>
                Remove
              </button>
            </div>
          )}
        </td>
      )}
    </tr>
  );
}
