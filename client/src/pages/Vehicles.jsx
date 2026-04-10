import { useEffect, useState } from 'react';
import { api } from '../api';

export default function Vehicles() {
  const [list, setList] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [q, setQ] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [modal, setModal] = useState(null);
  const [form, setForm] = useState({ customer_id: '', registration: '', make: '', model: '', year: '', vin: '', notes: '' });

  const load = () => {
    setLoadError('');
    return api.vehicles
      .list({ q })
      .then((rows) => {
        setList(rows);
        setLoadError('');
      })
      .catch((err) => {
        console.error(err);
        setList([]);
        setLoadError(
          err.message ||
            'Could not load vehicles. Start the API on port 3001 (see server folder).',
        );
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    setLoading(true);
    const t = setTimeout(load, 300);
    return () => clearTimeout(t);
  }, [q]);

  useEffect(() => {
    api.customers.list().then(setCustomers).catch(console.error);
  }, []);

  const openCreate = () => {
    setForm({ customer_id: '', registration: '', make: '', model: '', year: '', vin: '', notes: '' });
    setModal('create');
  };
  const openEdit = (v) => {
    setForm({
      customer_id: v.customer_id,
      registration: v.registration || '',
      make: v.make || '',
      model: v.model || '',
      year: v.year || '',
      vin: v.vin || '',
      notes: v.notes || '',
    });
    setModal({ type: 'edit', id: v.id });
  };
  const submit = async (e) => {
    e.preventDefault();
    const payload = { ...form, customer_id: form.customer_id ? Number(form.customer_id) : null };
    try {
      if (modal === 'create') await api.vehicles.create(payload);
      else await api.vehicles.update(modal.id, payload);
      setModal(null);
      load();
    } catch (err) {
      alert(err.message);
    }
  };

  return (
    <>
      <h1 className="page-title">Vehicles</h1>
      <div className="search-bar">
        <input
          type="search"
          placeholder="Search registration, make, model, customer…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <button type="button" className="btn primary" onClick={openCreate}>Add vehicle</button>
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
                <th>Registration</th>
                <th>Make / Model</th>
                <th>Customer</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {loading && <tr><td colSpan={4}>Loading…</td></tr>}
              {!loading && !loadError && list.length === 0 && <tr><td colSpan={4} className="empty">No vehicles</td></tr>}
              {!loading && list.map((v) => (
                <tr key={v.id}>
                  <td>{v.registration || '—'}</td>
                  <td>{[v.make, v.model].filter(Boolean).join(' ') || '—'}</td>
                  <td>{v.customer_name || '—'}</td>
                  <td>
                    <button type="button" className="btn" onClick={() => openEdit(v)}>Edit</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      {modal && (
        <div className="modal-overlay" onClick={() => setModal(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <header>{modal === 'create' ? 'New vehicle' : 'Edit vehicle'}</header>
            <form className="body" onSubmit={submit}>
              <div className="form-group">
                <label>Primary owner (optional)</label>
                <select value={form.customer_id} onChange={(e) => setForm({ ...form, customer_id: e.target.value })}>
                  <option value="">None</option>
                  {customers.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </div>
              <div className="form-group">
                <label>Registration</label>
                <input value={form.registration} onChange={(e) => setForm({ ...form, registration: e.target.value })} />
              </div>
              <div className="form-group">
                <label>Make</label>
                <input value={form.make} onChange={(e) => setForm({ ...form, make: e.target.value })} />
              </div>
              <div className="form-group">
                <label>Model</label>
                <input value={form.model} onChange={(e) => setForm({ ...form, model: e.target.value })} />
              </div>
              <div className="form-group">
                <label>Year</label>
                <input type="number" min="1900" max="2100" value={form.year} onChange={(e) => setForm({ ...form, year: e.target.value })} />
              </div>
              <div className="form-group">
                <label>VIN</label>
                <input value={form.vin} onChange={(e) => setForm({ ...form, vin: e.target.value })} />
              </div>
              <div className="form-group">
                <label>Notes</label>
                <textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} rows={2} />
              </div>
            </form>
            <footer>
              <button type="button" className="btn" onClick={() => setModal(null)}>Cancel</button>
              <button type="submit" className="btn primary" onClick={submit}>Save</button>
            </footer>
          </div>
        </div>
      )}
    </>
  );
}
