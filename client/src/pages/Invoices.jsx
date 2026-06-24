import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import InvoiceLineVatSelect from '../components/InvoiceLineVatSelect';
import StockItemSearchInput from '../components/StockItemSearchInput';
import { defaultInvoiceLineVatFields, parseVatPayload } from '../utils/invoiceLineVat';
import { formatStockItemLabel } from '../utils/stockItemLabel';

export default function Invoices() {
  const [list, setList] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [vehicles, setVehicles] = useState([]);
  const [type, setType] = useState('');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState(null);
  const [form, setForm] = useState({
    customer_id: '', vehicle_id: '', type: 'invoice', due_date: '', notes: '',
    items: [{ description: 'Labour', quantity: 1, unit_price: 0, type: 'labour', itemQuery: 'Labour', stock_item_id: null, ...defaultInvoiceLineVatFields() }],
  });

  const load = () =>
    api.invoices
      .list({ type: type || undefined, q: search.trim() || undefined })
      .then(setList)
      .catch(console.error)
      .finally(() => setLoading(false));

  useEffect(() => {
    setLoading(true);
    const t = setTimeout(load, 200);
    return () => clearTimeout(t);
  }, [type, search]);

  useEffect(() => {
    api.customers.list().then(setCustomers).catch(console.error);
    api.vehicles.list().then(setVehicles).catch(console.error);
  }, []);

  const openCreate = () => {
    setForm({
      customer_id: '', vehicle_id: '', type: 'invoice', due_date: '', notes: '',
      items: [{ description: 'Labour', quantity: 1, unit_price: 0, type: 'labour', itemQuery: 'Labour', stock_item_id: null, ...defaultInvoiceLineVatFields() }],
    });
    setModal('create');
  };
  const addLine = () =>
    setForm((f) => ({
      ...f,
      items: [...f.items, { description: '', itemQuery: '', stock_item_id: null, quantity: 1, unit_price: 0, type: 'other', ...defaultInvoiceLineVatFields() }],
    }));
  const addHeaderLine = () =>
    setForm((f) => ({
      ...f,
      items: [...f.items, { description: '', type: 'header', quantity: 0, unit_price: 0, itemQuery: '', stock_item_id: null, ...defaultInvoiceLineVatFields() }],
    }));
  const updateLine = (i, field, value) => setForm((f) => ({
    ...f,
    items: f.items.map((it, j) => (j === i ? { ...it, [field]: value } : it)),
  }));
  const removeLine = (i) => setForm((f) => ({ ...f, items: f.items.filter((_, j) => j !== i) }));

  const submit = async (e) => {
    e.preventDefault();
    if (!form.customer_id) return alert('Select a customer');
    const items = form.items
      .map((it) => {
        if (String(it.type) === 'header') {
          const title = String(it.description || it.itemQuery || '').trim();
          if (!title) return null;
          return { description: title, type: 'header' };
        }
        if (!it.description && !(it.unit_price || 0)) return null;
        let vat;
        try {
          vat = parseVatPayload(it);
        } catch (err) {
          throw err;
        }
        return {
          description: it.description,
          quantity: Number(it.quantity) || 1,
          unit_price: Number(it.unit_price) || 0,
          type: it.stock_item_id ? 'part' : it.type || 'other',
          stock_item_id: it.stock_item_id || undefined,
          vat_rate: vat.vat_rate,
          vat_exempt: vat.vat_exempt,
        };
      })
      .filter(Boolean);
    if (items.length === 0) return alert('Add at least one line item');
    try {
      await api.invoices.create({
        customer_id: Number(form.customer_id),
        vehicle_id: form.vehicle_id ? Number(form.vehicle_id) : null,
        type: form.type,
        due_date: form.due_date || null,
        notes: form.notes || null,
        items,
      });
      setModal(null);
      load();
    } catch (err) {
      alert(err.message || String(err));
    }
  };

  return (
    <>
      <h1 className="page-title">Invoices & quotes</h1>
      <div className="search-bar">
        <input
          type="search"
          placeholder="Search by number, customer, vehicle, notes…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ flex: '1 1 200px', minWidth: '12rem', maxWidth: '28rem' }}
        />
        <select value={type} onChange={(e) => setType(e.target.value)} className="btn" style={{ width: 'auto' }}>
          <option value="">All types</option>
          <option value="invoice">Invoice</option>
          <option value="quote">Quote</option>
        </select>
        <button type="button" className="btn primary" onClick={openCreate}>New invoice / quote</button>
      </div>
      <div className="card">
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Number</th>
                <th>Customer</th>
                <th>Vehicle</th>
                <th>Created</th>
                <th>Total</th>
                <th>Balance</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {loading && <tr><td colSpan={7}>Loading…</td></tr>}
              {!loading && list.length === 0 && <tr><td colSpan={7} className="empty">No invoices or quotes</td></tr>}
              {!loading && list.map((i) => {
                const isInv = i.type === 'invoice';
                const bal = isInv ? Number(i.balance) : null;
                const vehicleLabel = [i.registration, i.vehicle_make, i.vehicle_model].filter(Boolean).join(' ');
                return (
                  <tr key={i.id}>
                    <td>
                      <Link to={`/invoices/${i.id}`}>
                        <strong>{i.invoice_number}</strong>
                      </Link>
                    </td>
                    <td>{i.customer_name}</td>
                    <td style={{ color: vehicleLabel ? undefined : 'var(--text-muted)' }}>{vehicleLabel || '—'}</td>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      {i.created_at ? new Date(i.created_at).toLocaleDateString() : '—'}
                    </td>
                    <td>KES {Number(i.total || 0).toLocaleString()}</td>
                    <td>
                      {isInv ? (
                        <span style={{ fontWeight: bal > 0 ? 600 : undefined }}>KES {bal.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })}</span>
                      ) : (
                        <span style={{ color: 'var(--text-muted)' }}>—</span>
                      )}
                    </td>
                    <td>
                      <Link to={`/invoices/${i.id}`} className="btn" style={{ padding: '0.25rem 0.6rem', fontSize: '0.875rem' }}>View</Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
      {modal === 'create' && (
        <div className="modal-overlay" onClick={() => setModal(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '600px' }}>
            <header>New invoice / quote</header>
            <form className="body" onSubmit={submit}>
              <div className="form-group">
                <label>Customer *</label>
                <select value={form.customer_id} onChange={(e) => setForm({ ...form, customer_id: e.target.value })} required>
                  <option value="">Select customer</option>
                  {customers.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </div>
              <div className="form-group">
                <label>Vehicle (optional)</label>
                <select value={form.vehicle_id} onChange={(e) => setForm({ ...form, vehicle_id: e.target.value })}>
                  <option value="">None</option>
                  {vehicles.filter((v) => !form.customer_id || v.customer_id == form.customer_id).map((v) => (
                    <option key={v.id} value={v.id}>{[v.registration, v.make, v.model].filter(Boolean).join(' ') || 'Vehicle #' + v.id}</option>
                  ))}
                </select>
              </div>
              <div className="form-group">
                <label>Type</label>
                <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
                  <option value="quote">Quote</option>
                  <option value="invoice">Invoice</option>
                </select>
              </div>
              <div className="form-group">
                <label>Due date</label>
                <input type="date" value={form.due_date} onChange={(e) => setForm({ ...form, due_date: e.target.value })} />
              </div>
              <div className="form-group">
                <label>Line items</label>
                <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', margin: '0 0 0.5rem' }}>
                  Sale prices are <strong>ex VAT</strong>. Choose VAT per line below.
                </p>
                {form.items.map((it, i) => (
                  <div key={i} style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.5rem', alignItems: 'center', flexWrap: 'wrap', background: String(it.type) === 'header' ? '#f0f0f0' : undefined, padding: String(it.type) === 'header' ? '0.35rem 0.5rem' : 0, borderRadius: 'var(--radius)' }}>
                    {String(it.type) === 'header' ? (
                      <input
                        value={it.description || it.itemQuery || ''}
                        onChange={(e) => updateLine(i, 'description', e.target.value)}
                        placeholder="Section header title"
                        style={{ flex: '2 1 200px', fontWeight: 600 }}
                      />
                    ) : String(it.type) === 'labour' ? (
                      <input value={it.description} readOnly style={{ flex: '2 1 140px' }} />
                    ) : (
                      <div style={{ flex: '2 1 180px', minWidth: '10rem' }}>
                        <StockItemSearchInput
                          query={it.itemQuery ?? it.description ?? ''}
                          onQueryChange={(q) =>
                            setForm((f) => ({
                              ...f,
                              items: f.items.map((row, j) =>
                                j === i ? { ...row, itemQuery: q, description: q, stock_item_id: null } : row,
                              ),
                            }))
                          }
                          selectedStockItemId={it.stock_item_id}
                          onSelect={(item) =>
                            setForm((f) => ({
                              ...f,
                              items: f.items.map((row, j) =>
                                j === i
                                  ? {
                                      ...row,
                                      stock_item_id: item.id,
                                      itemQuery: formatStockItemLabel(item),
                                      description: formatStockItemLabel(item),
                                      unit_price: item.sell_price != null ? item.sell_price : row.unit_price,
                                      type: 'part',
                                    }
                                  : row,
                              ),
                            }))
                          }
                          placeholder="Search store or type description…"
                        />
                      </div>
                    )}
                    {String(it.type) !== 'header' && (
                      <>
                    <input type="number" placeholder="Qty" value={it.quantity} onChange={(e) => updateLine(i, 'quantity', e.target.value)} style={{ width: '60px' }} min="0" step="0.01" />
                    <input type="number" placeholder="Price ex VAT" value={it.unit_price} onChange={(e) => updateLine(i, 'unit_price', e.target.value)} style={{ width: '100px' }} min="0" step="0.01" />
                    <InvoiceLineVatSelect
                      value={{ vat_mode: it.vat_mode, vat_rate_custom: it.vat_rate_custom }}
                      onChange={(vat) => setForm((f) => ({
                        ...f,
                        items: f.items.map((row, j) => (j === i ? { ...row, ...vat } : row)),
                      }))}
                    />
                      </>
                    )}
                    <button type="button" className="btn" onClick={() => removeLine(i)}>×</button>
                  </div>
                ))}
                <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                  <button type="button" className="btn" onClick={addLine}>Add line</button>
                  <button type="button" className="btn" onClick={addHeaderLine}>Add header</button>
                </div>
              </div>
              <div className="form-group">
                <label>Notes</label>
                <textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} rows={2} />
              </div>
            </form>
            <footer>
              <button type="button" className="btn" onClick={() => setModal(null)}>Cancel</button>
              <button type="submit" className="btn primary" onClick={submit}>Create</button>
            </footer>
          </div>
        </div>
      )}
    </>
  );
}
