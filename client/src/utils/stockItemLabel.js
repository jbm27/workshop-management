export function formatStockItemLabel(item) {
  if (!item) return '';
  const code = String(item.code || '').trim();
  const name = String(item.name || '').trim();
  if (code && name) return `${code} - ${name}`;
  return code || name || `Item #${item.id}`;
}
