import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { useAdmin } from '../auth/AdminContext';
import { FUEL_LEVEL_OPTIONS } from '../utils/jobMileageFuel';

const JOB_STATUS_LABEL = {
  pending: 'In progress',
  in_progress: 'In progress',
  vehicle_released: 'Vehicle released',
  completed: 'Complete',
  cancelled: 'Cancelled',
};

function jobStatusLabel(status) {
  if (!status) return '—';
  return JOB_STATUS_LABEL[status] || status.replace(/_/g, ' ');
}

const EMPTY_CUSTOMER = { name: '', email: '', phone: '', address: '', notes: '' };
const EMPTY_VEHICLE = { registration: '', make: '', model: '', year: '', vin: '', notes: '' };
const ADD_NEW = '__add_new__';
const VALUABLE_ITEMS = ['Spare wheel', 'Wheel caps', 'Jack', 'Wheel spanner', 'Tool kit', '1st aid kit'];

function parseValuables(value) {
  const raw = String(value || '').trim();
  if (!raw) return { selected: new Set(), notes: '' };

  const selected = new Set();
  const checklistMatch = raw.match(/Checklist:\s*([^\n\r]*)/i);
  if (checklistMatch?.[1]) {
    checklistMatch[1]
      .split(';')
      .map((s) => s.trim())
      .filter(Boolean)
      .forEach((item) => {
        const canonical = VALUABLE_ITEMS.find((v) => v.toLowerCase() === item.toLowerCase());
        if (canonical) selected.add(canonical);
      });
  } else {
    // Backward compatibility for older free-text records.
    VALUABLE_ITEMS.forEach((item) => {
      if (new RegExp(`\\b${item.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(raw)) {
        selected.add(item);
      }
    });
  }

  const notesMatch = raw.match(/Notes:\s*([\s\S]*)$/i);
  let notes = notesMatch?.[1]?.trim() || '';
  if (!checklistMatch && !notesMatch) notes = raw;

  return { selected, notes };
}

function buildValuablesPayload(checks, notes) {
  const selectedItems = VALUABLE_ITEMS.filter((item) => !!checks?.[item]);
  const parts = [];
  if (selectedItems.length) parts.push(`Checklist: ${selectedItems.join('; ')}`);
  const noteText = String(notes || '').trim();
  if (noteText) parts.push(`Notes: ${noteText}`);
  return parts.join('\n');
}

export default function Jobs() {
  const { admin } = useAdmin();
  const isMechanic = Boolean(admin?.is_mechanic);
  const [list, setList] = useState([]);
  const [vehicles, setVehicles] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [status, setStatus] = useState('');
  const [q, setQ] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [modal, setModal] = useState(null);
  const [customerOpen, setCustomerOpen] = useState(false);
  const [vehicleOpen, setVehicleOpen] = useState(false);
  const [form, setForm] = useState({
    customerId: '',
    vehicleId: '',
    customerSearch: '',
    vehicleSearch: '',
    tasks: [],
    notes: '',
    due_date: '',
    odometer_in: '',
    fuel_in: '',
    valuables_in_vehicle: '',
    valuables_checks: {},
    valuables_notes: '',
    newCustomer: { ...EMPTY_CUSTOMER },
    newVehicle: { ...EMPTY_VEHICLE },
  });

  const FUEL_OPTIONS = ['', ...FUEL_LEVEL_OPTIONS];

  const load = () => {
    setLoadError('');
    return api.jobs
      .list({ status: status || undefined, q: q || undefined })
      .then((rows) => {
        setList(rows);
        setLoadError('');
      })
      .catch((err) => {
        console.error(err);
        setList([]);
        setLoadError(
          err.message ||
            'Could not load jobs. Start the API (e.g. npm run dev in /server) — Vite expects it on port 3001.',
        );
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    setLoading(true);
    const t = setTimeout(load, 300);
    return () => clearTimeout(t);
  }, [status, q]);

  useEffect(() => {
    if (isMechanic) return;
    api.vehicles.list().then(setVehicles).catch(console.error);
    api.customers.list().then(setCustomers).catch(console.error);
  }, [isMechanic]);

  const openCreate = () => {
    setForm({
      customerId: '',
      vehicleId: '',
      customerSearch: '',
      vehicleSearch: '',
      tasks: [],
      notes: '',
      due_date: '',
      odometer_in: '',
      fuel_in: '',
      valuables_in_vehicle: '',
      valuables_checks: {},
      valuables_notes: '',
      newCustomer: { ...EMPTY_CUSTOMER },
      newVehicle: { ...EMPTY_VEHICLE },
    });
    setModal('create');
  };

  const addTask = () => setForm((f) => ({ ...f, tasks: [...f.tasks, ''] }));
  const updateTask = (i, value) => setForm((f) => ({ ...f, tasks: f.tasks.map((t, j) => (j === i ? value : t)) }));
  const removeTask = (i) => setForm((f) => ({ ...f, tasks: f.tasks.filter((_, j) => j !== i) }));

  const customerSearchLower = (form.customerSearch || '').toLowerCase().trim();
  const filteredCustomers = customerSearchLower
    ? customers.filter(
        (c) =>
          (c.name || '').toLowerCase().includes(customerSearchLower) ||
          (c.email || '').toLowerCase().includes(customerSearchLower) ||
          (c.phone || '').toLowerCase().includes(customerSearchLower)
      )
    : customers;

  const vehicleSearchLower = (form.vehicleSearch || '').toLowerCase().trim();
  const filteredVehicles = vehicleSearchLower
    ? vehicles.filter(
        (v) =>
          (v.registration || '').toLowerCase().includes(vehicleSearchLower) ||
          (v.make || '').toLowerCase().includes(vehicleSearchLower) ||
          (v.model || '').toLowerCase().includes(vehicleSearchLower) ||
          (v.customer_name || '').toLowerCase().includes(vehicleSearchLower)
      )
    : vehicles;

  const isNewCustomer = form.customerId === ADD_NEW;
  const isNewVehicle = form.vehicleId === ADD_NEW;

  const submit = async (e) => {
    e.preventDefault();
    try {
      let customerId = form.customerId === ADD_NEW ? null : Number(form.customerId) || null;
      if (isNewCustomer) {
        if (!form.newCustomer.name?.trim()) return alert('Customer name is required');
        const created = await api.customers.create(form.newCustomer);
        customerId = created.id;
      }
      if (!customerId) return alert('Select or add a customer (bill-to / who to invoice).');

      let vehicleId = form.vehicleId === ADD_NEW ? null : Number(form.vehicleId) || null;
      if (isNewVehicle) {
        const created = await api.vehicles.create({ ...form.newVehicle, customer_id: null });
        vehicleId = created.id;
      }
      if (!vehicleId) return alert('Select or add a vehicle.');

      const valuablesPayload = buildValuablesPayload(form.valuables_checks, form.valuables_notes);
      await api.jobs.create({
        vehicle_id: vehicleId,
        customer_id: customerId,
        tasks: form.tasks.filter((t) => t && String(t).trim()),
        notes: form.notes,
        due_date: form.due_date || undefined,
        odometer_in: form.odometer_in ? Number(form.odometer_in) : null,
        fuel_in: form.fuel_in || null,
        valuables_in_vehicle: valuablesPayload || null,
      });
      setModal(null);
      load();
      setVehicles((prev) => (isNewVehicle ? [...prev, { id: vehicleId, ...form.newVehicle }] : prev));
      setCustomers((prev) => (isNewCustomer ? [...prev, { id: customerId, ...form.newCustomer }] : prev));
    } catch (err) {
      alert(err.message);
    }
  };

  const selectedCustomerName =
    form.customerId && form.customerId !== ADD_NEW
      ? customers.find((c) => String(c.id) === String(form.customerId))?.name ?? ''
      : form.customerId === ADD_NEW
        ? '➕ New customer'
        : '';

  const selectedVehicleLabel =
    form.vehicleId && form.vehicleId !== ADD_NEW
      ? (() => {
          const v = vehicles.find((v) => String(v.id) === String(form.vehicleId));
          return v ? [v.registration, v.make, v.model].filter(Boolean).join(' ') || `Vehicle #${v.id}` : '';
        })()
      : form.vehicleId === ADD_NEW
        ? '➕ New vehicle'
        : '';

  const customerInputValue = selectedCustomerName || form.customerSearch;
  const vehicleInputValue = selectedVehicleLabel || form.vehicleSearch;

  return (
    <>
      <h1 className="page-title">Jobs</h1>
      {isMechanic && (
        <p style={{ color: 'var(--text-muted)', marginTop: '-0.35rem', marginBottom: '1rem', maxWidth: '42rem' }}>
          You can open jobs that are <strong>in progress</strong> or <strong>vehicle released</strong> to view mileage and log test drives.
        </p>
      )}
      <div className="search-bar">
        <input
          type="search"
          placeholder="Search job number, description, registration…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <select value={status} onChange={(e) => setStatus(e.target.value)} className="btn" style={{ width: 'auto' }}>
          <option value="">All statuses</option>
          <option value="in_progress">In progress</option>
          <option value="vehicle_released">Vehicle released</option>
          <option value="completed">Complete</option>
          <option value="cancelled">Cancelled</option>
        </select>
        {!isMechanic && (
          <button type="button" className="btn primary" onClick={openCreate}>New job</button>
        )}
      </div>
      {loadError && (
        <div
          role="alert"
          style={{
            marginBottom: '1rem',
            padding: '0.75rem 1rem',
            borderRadius: 'var(--radius)',
            border: '1px solid var(--danger, #c44)',
            background: 'rgba(200, 60, 60, 0.12)',
            color: 'var(--text)',
          }}
        >
          {loadError}
        </div>
      )}
      <div className="card">
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Job #</th>
                <th>Vehicle</th>
                <th>Customer</th>
                <th>Tasks</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {loading && <tr><td colSpan={6}>Loading…</td></tr>}
              {!loading && !loadError && list.length === 0 && <tr><td colSpan={6} className="empty">No jobs</td></tr>}
              {!loading && list.map((j) => (
                <tr key={j.id}>
                  <td><strong>{j.job_number}</strong></td>
                  <td>{[j.registration, j.make, j.model].filter(Boolean).join(' ') || '—'}</td>
                  <td>{j.customer_name}</td>
                  <td>{j.task_count ? `${j.task_count} task(s)` : '—'}</td>
                  <td><span className={`badge ${j.status}`}>{jobStatusLabel(j.status)}</span></td>
                  <td>
                    <Link to={`/jobs/${j.id}`} className="btn">View</Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      {modal === 'create' && (
        <div className="modal-overlay" onClick={() => setModal(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '560px' }}>
            <header>New job</header>
            <form className="body" onSubmit={submit}>
              <div className="form-group" style={{ position: 'relative' }}>
                <label>Vehicle *</label>
                <input
                  type="text"
                  placeholder="Search or select vehicle (number plate, make, model)…"
                  value={vehicleInputValue}
                  onChange={(e) => setForm({ ...form, vehicleSearch: e.target.value, vehicleId: '' })}
                  onFocus={() => setVehicleOpen(true)}
                  onBlur={() => setTimeout(() => setVehicleOpen(false), 200)}
                  autoComplete="off"
                  required={!isNewVehicle && !form.vehicleId}
                />
                {vehicleOpen && (
                  <ul
                    style={{
                      position: 'absolute',
                      top: '100%',
                      left: 0,
                      right: 0,
                      margin: 0,
                      padding: 0,
                      listStyle: 'none',
                      maxHeight: '220px',
                      overflowY: 'auto',
                      background: 'var(--surface)',
                      border: '1px solid var(--border)',
                      borderTop: 'none',
                      borderRadius: '0 0 var(--radius) var(--radius)',
                      zIndex: 10,
                      boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
                    }}
                  >
                    {filteredVehicles.map((v) => (
                      <li
                        key={v.id}
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => {
                          setForm({ ...form, vehicleId: String(v.id), vehicleSearch: '' });
                          setVehicleOpen(false);
                        }}
                        style={{ padding: '0.5rem 0.75rem', cursor: 'pointer', borderBottom: '1px solid var(--border)' }}
                      >
                        {[v.registration, v.make, v.model].filter(Boolean).join(' ') || `Vehicle #${v.id}`}
                      </li>
                    ))}
                    <li
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => {
                        setForm({ ...form, vehicleId: ADD_NEW, vehicleSearch: '' });
                        setVehicleOpen(false);
                      }}
                      style={{ padding: '0.5rem 0.75rem', cursor: 'pointer', fontWeight: 500 }}
                    >
                      ➕ Add new vehicle
                    </li>
                  </ul>
                )}
                {isNewVehicle && (
                  <div style={{ borderLeft: '3px solid var(--accent)', paddingLeft: '1rem', marginTop: '0.75rem' }}>
                    <div className="form-group">
                      <label>Registration (number plate)</label>
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
                    <div className="form-group">
                      <label>Year</label>
                      <input type="number" min="1900" max="2100" value={form.newVehicle.year || ''} onChange={(e) => setForm({ ...form, newVehicle: { ...form.newVehicle, year: e.target.value } })} placeholder="Year" />
                    </div>
                    <div className="form-group">
                      <label>VIN</label>
                      <input value={form.newVehicle.vin} onChange={(e) => setForm({ ...form, newVehicle: { ...form.newVehicle, vin: e.target.value } })} placeholder="VIN (optional)" />
                    </div>
                  </div>
                )}
              </div>

              <div className="form-group" style={{ position: 'relative' }}>
                <label>Customer (bill-to) *</label>
                <input
                  type="text"
                  placeholder="Search or select customer…"
                  value={customerInputValue}
                  onChange={(e) => setForm({ ...form, customerSearch: e.target.value, customerId: '' })}
                  onFocus={() => setCustomerOpen(true)}
                  onBlur={() => setTimeout(() => setCustomerOpen(false), 200)}
                  autoComplete="off"
                  required={!isNewCustomer && !form.customerId}
                />
                {customerOpen && (
                  <ul
                    style={{
                      position: 'absolute',
                      top: '100%',
                      left: 0,
                      right: 0,
                      margin: 0,
                      padding: 0,
                      listStyle: 'none',
                      maxHeight: '220px',
                      overflowY: 'auto',
                      background: 'var(--surface)',
                      border: '1px solid var(--border)',
                      borderTop: 'none',
                      borderRadius: '0 0 var(--radius) var(--radius)',
                      zIndex: 10,
                      boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
                    }}
                  >
                    {filteredCustomers.map((c) => (
                      <li
                        key={c.id}
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => {
                          setForm({ ...form, customerId: String(c.id), customerSearch: '' });
                          setCustomerOpen(false);
                        }}
                        style={{ padding: '0.5rem 0.75rem', cursor: 'pointer', borderBottom: '1px solid var(--border)' }}
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
                        setForm({ ...form, customerId: ADD_NEW, customerSearch: '' });
                        setCustomerOpen(false);
                      }}
                      style={{ padding: '0.5rem 0.75rem', cursor: 'pointer', fontWeight: 500 }}
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
                        required
                        placeholder="Customer name"
                      />
                    </div>
                    <div className="form-group">
                      <label>Phone</label>
                      <input value={form.newCustomer.phone} onChange={(e) => setForm({ ...form, newCustomer: { ...form.newCustomer, phone: e.target.value } })} placeholder="Phone" />
                    </div>
                    <div className="form-group">
                      <label>Email</label>
                      <input type="email" value={form.newCustomer.email} onChange={(e) => setForm({ ...form, newCustomer: { ...form.newCustomer, email: e.target.value } })} placeholder="Email" />
                    </div>
                    <div className="form-group">
                      <label>Address</label>
                      <input value={form.newCustomer.address} onChange={(e) => setForm({ ...form, newCustomer: { ...form.newCustomer, address: e.target.value } })} placeholder="Address" />
                    </div>
                  </div>
                )}
              </div>

              <hr style={{ border: 'none', borderTop: '1px solid var(--border)', margin: '1rem 0' }} />
              <strong style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>Job details</strong>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', marginBottom: '1rem' }}>
                <div className="form-group" style={{ margin: 0 }}>
                  <label>Mileage in (km)</label>
                  <input
                    type="number"
                    min="0"
                    value={form.odometer_in}
                    onChange={(e) => setForm({ ...form, odometer_in: e.target.value })}
                    placeholder="At drop-off"
                  />
                </div>
                <div className="form-group" style={{ margin: 0 }}>
                  <label>Fuel in</label>
                  <select value={form.fuel_in} onChange={(e) => setForm({ ...form, fuel_in: e.target.value })}>
                    {FUEL_OPTIONS.map((opt) => (
                      <option key={opt || 'blank'} value={opt}>{opt || '—'}</option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="form-group">
                <label>Valuables left in vehicle</label>
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))',
                    gap: '0.5rem 0.75rem',
                    marginBottom: '0.75rem',
                  }}
                >
                  {VALUABLE_ITEMS.map((item) => (
                    <label key={item} style={{ display: 'flex', alignItems: 'center', gap: '0.45rem' }}>
                      <input
                        type="checkbox"
                        checked={!!form.valuables_checks?.[item]}
                        onChange={(e) =>
                          setForm((f) => ({
                            ...f,
                            valuables_checks: { ...(f.valuables_checks || {}), [item]: e.target.checked },
                          }))
                        }
                      />
                      {item}
                    </label>
                  ))}
                </div>
                <label style={{ display: 'block', marginBottom: '0.35rem', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
                  Notes (custom items)
                </label>
                <textarea
                  value={form.valuables_notes}
                  onChange={(e) => setForm({ ...form, valuables_notes: e.target.value })}
                  placeholder="Optional — any other items worth noting"
                  rows={3}
                  style={{ width: '100%', resize: 'vertical' }}
                />
              </div>
              <div className="form-group">
                <label>Tasks</label>
                <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginBottom: '0.5rem' }}>What needs to be done (e.g. Check brakes, Respray car)</p>
                {form.tasks.map((task, i) => (
                  <div key={i} style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.5rem', alignItems: 'center' }}>
                    <input
                      type="text"
                      value={task}
                      onChange={(e) => updateTask(i, e.target.value)}
                      placeholder="Task description"
                      style={{ flex: 1 }}
                    />
                    <button type="button" className="btn" onClick={() => removeTask(i)} title="Remove task">×</button>
                  </div>
                ))}
                <button type="button" className="btn" onClick={addTask}>+ Add task</button>
              </div>
              <div className="form-group">
                <label>Due date</label>
                <input type="date" value={form.due_date} onChange={(e) => setForm({ ...form, due_date: e.target.value })} />
              </div>
              <div className="form-group">
                <label>Notes</label>
                <textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} rows={2} placeholder="Internal notes" />
              </div>
            </form>
            <footer>
              <button type="button" className="btn" onClick={() => setModal(null)}>Cancel</button>
              <button type="submit" className="btn primary" onClick={submit}>Create job</button>
            </footer>
          </div>
        </div>
      )}
    </>
  );
}
