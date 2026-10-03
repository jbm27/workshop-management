import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import InvoiceLineVatSelect from '../components/InvoiceLineVatSelect';
import StockItemSearchInput from '../components/StockItemSearchInput';
import { defaultInvoiceLineVatFields, parseVatPayload } from '../utils/invoiceLineVat';
import { formatStockItemLabel } from '../utils/stockItemLabel';

const EMPTY_CUSTOMER = { name: '', company_name: '', registration_number: '', email: '', phone: '', address: '', notes: '' };
const EMPTY_VEHICLE = { registration: '', make: '', model: '', year: '', vin: '', notes: '' };
const ADD_NEW = '__add_new__';

const dropdownListStyle = {
  position: 'absolute',
  top: '100%',
  left: 0,
  right: 0,
  margin: 0,
  padding: 0,
  listStyle: 'none',
  maxHeight: '240px',
  overflowY: 'auto',
  background: 'var(--surface)',
  border: '1px solid var(--border)',
  borderTop: 'none',
  borderRadius: '0 0 var(--radius) var(--radius)',
  zIndex: 10,
  boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
};
const dropdownItemStyle = { padding: '0.5rem 0.75rem', cursor: 'pointer', borderBottom: '1px solid var(--border)' };
const dropdownNoteStyle = { padding: '0.4rem 0.75rem', fontSize: '0.8rem', color: 'var(--text-muted)', borderBottom: '1px solid var(--border)' };

function vehicleLabel(v) {
  return [v.registration, v.make, v.model].filter(Boolean).join(' ') || `Vehicle #${v.id}`;
}

function emptyCreateForm() {
  return {
    customer_id: '', vehicle_id: '', type: 'invoice', due_date: '', notes: '',
    discount_percent: '',
    customerSearch: '',
    vehicleSearch: '',
    newCustomer: { ...EMPTY_CUSTOMER },
    newVehicle: { ...EMPTY_VEHICLE },
    items: [{ description: 'Labour', quantity: 1, unit_price: 0, type: 'labour', itemQuery: 'Labour', stock_item_id: null, discount_percent: 0, ...defaultInvoiceLineVatFields() }],
  };
}

export default function Invoices() {
  const [list, setList] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [vehicles, setVehicles] = useState([]);
  const [type, setType] = useState('');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState(null);
  const [customerOpen, setCustomerOpen] = useState(false);
  const [vehicleOpen, setVehicleOpen] = useState(false);
  const [form, setForm] = useState(emptyCreateForm);

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
    setForm(emptyCreateForm());
    setModal('create');
  };

  const isNewCustomer = form.customer_id === ADD_NEW;
  const isNewVehicle = form.vehicle_id === ADD_NEW;

  const customerSearchLower = (form.customerSearch || '').toLowerCase().trim();
  const filteredCustomers = customerSearchLower
    ? customers.filter(
        (c) =>
          (c.name || '').toLowerCase().includes(customerSearchLower) ||
          (c.company_name || '').toLowerCase().includes(customerSearchLower) ||
          (c.email || '').toLowerCase().includes(customerSearchLower) ||
          (c.phone || '').toLowerCase().includes(customerSearchLower),
      )
    : customers;

  const vehicleSearchRaw = (form.vehicleSearch || '').toLowerCase().trim();
  const vehicleSearchCompact = vehicleSearchRaw.replace(/\s+/g, '');
  const hasExistingCustomer = Boolean(form.customer_id) && !isNewCustomer;
  const customerVehicles = hasExistingCustomer
    ? vehicles.filter((v) => String(v.customer_id) === String(form.customer_id))
    : [];
  const searchedVehicles = vehicleSearchRaw
    ? vehicles.filter(
        (v) =>
          (v.registration || '').toLowerCase().replace(/\s+/g, '').includes(vehicleSearchCompact) ||
          (v.make || '').toLowerCase().includes(vehicleSearchRaw) ||
          (v.model || '').toLowerCase().includes(vehicleSearchRaw) ||
          (v.customer_name || '').toLowerCase().includes(vehicleSearchRaw),
      )
    : [];
  const vehicleOptions = vehicleSearchRaw ? searchedVehicles : hasExistingCustomer ? customerVehicles : vehicles;

  const selectedCustomerName =
    form.customer_id && !isNewCustomer
      ? customers.find((c) => String(c.id) === String(form.customer_id))?.name ?? ''
      : isNewCustomer
        ? '➕ New customer'
        : '';
  const selectedVehicleLabel =
    form.vehicle_id && !isNewVehicle
      ? (() => {
          const v = vehicles.find((x) => String(x.id) === String(form.vehicle_id));
          return v ? vehicleLabel(v) : '';
        })()
      : isNewVehicle
        ? '➕ New vehicle'
        : '';
  const addLine = () =>
    setForm((f) => ({
      ...f,
      items: [...f.items, { description: '', itemQuery: '', stock_item_id: null, quantity: 1, unit_price: 0, type: 'other', discount_percent: 0, ...defaultInvoiceLineVatFields() }],
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
    if (!form.customer_id) return alert('Select or add a customer');
    if (isNewCustomer && !form.newCustomer.name?.trim()) return alert('Customer name is required');
    if (isNewVehicle && !form.newVehicle.registration?.trim()) return alert('Vehicle registration is required');
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
          subtext: String(it.subtext || '').trim() || undefined,
          discount_percent: Number(it.discount_percent) || 0,
          vat_rate: vat.vat_rate,
          vat_exempt: vat.vat_exempt,
        };
      })
      .filter(Boolean);
    if (items.length === 0) return alert('Add at least one line item');
    try {
      let customerId = isNewCustomer ? null : Number(form.customer_id);
      if (isNewCustomer) {
        const created = await api.customers.create(form.newCustomer);
        customerId = created.id;
        setCustomers((prev) => [...prev, created]);
        setForm((f) => ({ ...f, customer_id: String(created.id), newCustomer: { ...EMPTY_CUSTOMER } }));
      }
      let vehicleId = isNewVehicle ? null : form.vehicle_id ? Number(form.vehicle_id) : null;
      if (isNewVehicle) {
        const created = await api.vehicles.create({
          ...form.newVehicle,
          year: form.newVehicle.year ? Number(form.newVehicle.year) : null,
          customer_id: customerId,
        });
        vehicleId = created.id;
        setVehicles((prev) => [created, ...prev]);
        setForm((f) => ({ ...f, vehicle_id: String(created.id), newVehicle: { ...EMPTY_VEHICLE } }));
      }
      await api.invoices.create({
        customer_id: customerId,
        vehicle_id: vehicleId,
        type: form.type,
        due_date: form.due_date || null,
        notes: form.notes || null,
        discount_percent: form.discount_percent.trim() === '' ? 0 : Number(form.discount_percent),
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
              <div className="form-group" style={{ position: 'relative' }}>
                <label>Customer *</label>
                <input
                  type="text"
                  placeholder="Search or select customer…"
                  value={selectedCustomerName || form.customerSearch}
                  onChange={(e) => setForm({ ...form, customerSearch: e.target.value, customer_id: '' })}
                  onFocus={() => setCustomerOpen(true)}
                  onBlur={() => setTimeout(() => setCustomerOpen(false), 200)}
                  autoComplete="off"
                />
                {customerOpen && (
                  <ul style={dropdownListStyle}>
                    {filteredCustomers.map((c) => (
                      <li
                        key={c.id}
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => {
                          setForm({ ...form, customer_id: String(c.id), customerSearch: '' });
                          setCustomerOpen(false);
                        }}
                        style={dropdownItemStyle}
                      >
                        {c.name}
                        {(c.phone || c.email) && (
                          <span style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginLeft: '0.5rem' }}>
                            {[c.phone, c.email].filter(Boolean).join(' · ')}
                          </span>
                        )}
                      </li>
                    ))}
                    <li
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => {
                        setForm({ ...form, customer_id: ADD_NEW, customerSearch: '' });
                        setCustomerOpen(false);
                      }}
                      style={{ ...dropdownItemStyle, fontWeight: 500, borderBottom: 'none' }}
                    >
                      ➕ Add new customer
                    </li>
                  </ul>
                )}
                {isNewCustomer && (
                  <div style={{ borderLeft: '3px solid var(--accent)', paddingLeft: '1rem', marginTop: '0.75rem' }}>
                    <div className="form-group">
                      <label>Name *</label>
                      <input
                        value={form.newCustomer.name}
                        onChange={(e) => setForm({ ...form, newCustomer: { ...form.newCustomer, name: e.target.value } })}
                        placeholder="Contact or customer name"
                      />
                    </div>
                    <div className="form-group">
                      <label>Company name</label>
                      <input
                        value={form.newCustomer.company_name}
                        onChange={(e) => setForm({ ...form, newCustomer: { ...form.newCustomer, company_name: e.target.value } })}
                        placeholder="For business customers"
                      />
                    </div>
                    <div className="form-group">
                      <label>Registration number</label>
                      <input
                        value={form.newCustomer.registration_number}
                        onChange={(e) => setForm({ ...form, newCustomer: { ...form.newCustomer, registration_number: e.target.value } })}
                        placeholder="Business registration / PIN"
                      />
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
                      <div className="form-group">
                        <label>Phone</label>
                        <input value={form.newCustomer.phone} onChange={(e) => setForm({ ...form, newCustomer: { ...form.newCustomer, phone: e.target.value } })} placeholder="Phone" />
                      </div>
                      <div className="form-group">
                        <label>Email</label>
                        <input type="email" value={form.newCustomer.email} onChange={(e) => setForm({ ...form, newCustomer: { ...form.newCustomer, email: e.target.value } })} placeholder="Email" />
                      </div>
                    </div>
                    <div className="form-group">
                      <label>Address</label>
                      <input value={form.newCustomer.address} onChange={(e) => setForm({ ...form, newCustomer: { ...form.newCustomer, address: e.target.value } })} placeholder="Address" />
                    </div>
                  </div>
                )}
              </div>
              <div className="form-group" style={{ position: 'relative' }}>
                <label>Vehicle (optional)</label>
                <input
                  type="text"
                  placeholder={
                    hasExistingCustomer
                      ? "Customer's vehicles — type to search all vehicles (plate, make, model, owner)…"
                      : 'Search all vehicles (plate, make, model, owner)…'
                  }
                  value={selectedVehicleLabel || form.vehicleSearch}
                  onChange={(e) => setForm({ ...form, vehicleSearch: e.target.value, vehicle_id: '' })}
                  onFocus={() => setVehicleOpen(true)}
                  onBlur={() => setTimeout(() => setVehicleOpen(false), 200)}
                  autoComplete="off"
                />
                {vehicleOpen && (
                  <ul style={dropdownListStyle}>
                    {!vehicleSearchRaw && hasExistingCustomer && (
                      <li style={dropdownNoteStyle}>
                        {customerVehicles.length
                          ? "This customer's vehicles — type to search all registered vehicles"
                          : 'No vehicles on file for this customer — type to search all registered vehicles'}
                      </li>
                    )}
                    {vehicleSearchRaw && !searchedVehicles.length && (
                      <li style={dropdownNoteStyle}>No registered vehicles match “{form.vehicleSearch.trim()}”</li>
                    )}
                    {!vehicleSearchRaw && (
                      <li
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => {
                          setForm({ ...form, vehicle_id: '', vehicleSearch: '' });
                          setVehicleOpen(false);
                        }}
                        style={{ ...dropdownItemStyle, color: 'var(--text-muted)' }}
                      >
                        None
                      </li>
                    )}
                    {vehicleOptions.map((v) => (
                      <li
                        key={v.id}
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => {
                          setForm({ ...form, vehicle_id: String(v.id), vehicleSearch: '' });
                          setVehicleOpen(false);
                        }}
                        style={dropdownItemStyle}
                      >
                        {vehicleLabel(v)}
                        {v.customer_name && String(v.customer_id) !== String(form.customer_id) && (
                          <span style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginLeft: '0.5rem' }}>
                            {v.customer_name}
                          </span>
                        )}
                      </li>
                    ))}
                    <li
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => {
                        setForm((f) => ({
                          ...f,
                          vehicle_id: ADD_NEW,
                          vehicleSearch: '',
                          newVehicle: f.newVehicle.registration
                            ? f.newVehicle
                            : { ...f.newVehicle, registration: (f.vehicleSearch || '').trim().toUpperCase() },
                        }));
                        setVehicleOpen(false);
                      }}
                      style={{ ...dropdownItemStyle, fontWeight: 500, borderBottom: 'none' }}
                    >
                      ➕ Add new vehicle
                    </li>
                  </ul>
                )}
                {isNewVehicle && (
                  <div style={{ borderLeft: '3px solid var(--accent)', paddingLeft: '1rem', marginTop: '0.75rem' }}>
                    <div className="form-group">
                      <label>Registration (number plate) *</label>
                      <input value={form.newVehicle.registration} onChange={(e) => setForm({ ...form, newVehicle: { ...form.newVehicle, registration: e.target.value } })} placeholder="e.g. KCA 123A" />
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
                      <div className="form-group">
                        <label>Make</label>
                        <input value={form.newVehicle.make} onChange={(e) => setForm({ ...form, newVehicle: { ...form.newVehicle, make: e.target.value } })} placeholder="Make" />
                      </div>
                      <div className="form-group">
                        <label>Model</label>
                        <input value={form.newVehicle.model} onChange={(e) => setForm({ ...form, newVehicle: { ...form.newVehicle, model: e.target.value } })} placeholder="Model" />
                      </div>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
                      <div className="form-group">
                        <label>Year</label>
                        <input type="number" min="1900" max="2100" value={form.newVehicle.year || ''} onChange={(e) => setForm({ ...form, newVehicle: { ...form.newVehicle, year: e.target.value } })} placeholder="Year" />
                      </div>
                      <div className="form-group">
                        <label>VIN</label>
                        <input value={form.newVehicle.vin} onChange={(e) => setForm({ ...form, newVehicle: { ...form.newVehicle, vin: e.target.value } })} placeholder="VIN (optional)" />
                      </div>
                    </div>
                    <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', margin: 0 }}>
                      The new vehicle will be registered under this quote&apos;s customer.
                    </p>
                  </div>
                )}
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
                    <input type="number" placeholder="Disc %" value={it.discount_percent || ''} onChange={(e) => updateLine(i, 'discount_percent', e.target.value)} style={{ width: '70px' }} min="0" max="100" step="0.01" title="Line discount %" />
                    <InvoiceLineVatSelect
                      value={{ vat_mode: it.vat_mode, vat_rate_custom: it.vat_rate_custom }}
                      onChange={(vat) => setForm((f) => ({
                        ...f,
                        items: f.items.map((row, j) => (j === i ? { ...row, ...vat } : row)),
                      }))}
                    />
                    <input
                      placeholder="Subtext (optional)"
                      value={it.subtext || ''}
                      onChange={(e) => updateLine(i, 'subtext', e.target.value)}
                      style={{ flex: '1 1 140px', minWidth: '8rem' }}
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
                <label>Document discount % (optional)</label>
                <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', margin: '0 0 0.5rem' }}>
                  Percentage off the whole document. Line discounts are applied first.
                </p>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                  <input
                    type="number"
                    min="0"
                    max="100"
                    step="0.01"
                    value={form.discount_percent}
                    onChange={(e) => setForm((f) => ({ ...f, discount_percent: e.target.value }))}
                    placeholder="0"
                    style={{ width: '5rem' }}
                  />
                  <span>%</span>
                </div>
              </div>
              <div className="form-group">
                <label>Notes (optional)</label>
                <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', margin: '0 0 0.5rem' }}>
                  Customer-facing notes for the PDF — use line breaks or bullet points.
                </p>
                <textarea
                  value={form.notes}
                  onChange={(e) => setForm({ ...form, notes: e.target.value })}
                  rows={6}
                  placeholder={'e.g.\n• Parts warranty: 12 months\n• Payment due within 14 days'}
                  style={{ width: '100%', resize: 'vertical', minHeight: '6rem', lineHeight: 1.45 }}
                />
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
