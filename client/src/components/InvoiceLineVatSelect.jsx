import { useEffect, useState } from 'react';
import { defaultInvoiceLineVatFields } from '../utils/invoiceLineVat';

const VAT_OPTIONS = [
  { value: 'none', label: 'No VAT' },
  { value: 'standard', label: 'VAT 16%' },
  { value: 'exempt', label: 'VAT exempt' },
  { value: 'custom', label: 'Custom %…' },
];

/**
 * VAT selector for invoice/quote line items.
 * Controlled: pass value + onChange. Uncontrolled form: pass selectName (+ optional idPrefix for edit rows).
 */
export default function InvoiceLineVatSelect({
  value,
  onChange,
  selectName = 'vat_mode',
  customName = 'vat_rate_custom',
  idPrefix,
  defaultFields,
  style,
  selectStyle,
}) {
  const controlled = value != null && typeof onChange === 'function';
  const [localFields, setLocalFields] = useState(defaultFields ?? defaultInvoiceLineVatFields());

  useEffect(() => {
    if (!controlled) {
      setLocalFields(defaultFields ?? defaultInvoiceLineVatFields());
    }
  }, [controlled, defaultFields?.vat_mode, defaultFields?.vat_rate_custom, idPrefix]);

  const fields = controlled ? value : localFields;
  const mode = fields.vat_mode ?? 'standard';
  const custom = fields.vat_rate_custom ?? '';

  const update = (patch) => {
    const next = { ...fields, ...patch };
    if (controlled) onChange(next);
    else setLocalFields(next);
  };

  const selectId = idPrefix ? `${idPrefix}-vat-mode` : undefined;
  const customId = idPrefix ? `${idPrefix}-vat-custom` : undefined;

  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '0.25rem', ...style }}>
      <select
        id={selectId}
        name={controlled ? undefined : selectName}
        value={mode}
        onChange={(e) => update({ vat_mode: e.target.value })}
        style={{ maxWidth: '9rem', fontSize: '0.85rem', ...selectStyle }}
      >
        {VAT_OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      {mode === 'custom' && (
        <input
          id={customId}
          name={controlled ? undefined : customName}
          type="number"
          min="0"
          max="100"
          step="0.01"
          value={custom}
          onChange={(e) => update({ vat_rate_custom: e.target.value })}
          placeholder="%"
          title="VAT %"
          style={{ width: '3.5rem' }}
        />
      )}
    </div>
  );
}
