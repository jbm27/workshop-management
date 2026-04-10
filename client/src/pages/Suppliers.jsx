import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';

function kes(n) {
  const x = Number(n);
  if (Number.isNaN(x)) return '—';
  return `KES ${x.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}

export default function Suppliers() {
  const [list, setList] = useState([]);
  const [q, setQ] = useState('');
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState(null);
  const [form, setForm] = useState({ name: '', email: '', phone: '', address: '', pin: '', notes: '' });

  const load = () =>
    api.suppliers
      .list(q.trim() || undefined)
      .then(setList)
      .catch(console.error)
      .finally(() => setLoading(false));

  useEffect(() => {
    setLoading(true);
    const t = setTimeout(load, 280);
    return () => clearTimeout(t);
  }, [q]);

  const openCreate = () => {
    setForm({ name: '', email: '', phone: '', address: '', pin: '', notes: '' });
    setModal('create');
  };
  const openEdit = (s) => {
    setForm({
      name: s.name,
      email: s.email || '',
      phone: s.phone || '',
      address: s.address || '',
      pin: s.pin || '',
      notes: s.notes || '',
    });
    setModal({ type: 'edit', id: s.id });
  };
  const submit = async (e) => {
    e.preventDefault();
    if (!form.name?.trim()) return alert('Name is required');
    try {
      if (modal === 'create') await api.suppliers.create(form);
      else await api.suppliers.update(modal.id, form);
      setModal(null);
      load();
    } catch (err) {
      alert(err.message);
    }
  };
  const remove = async (id) => {
    if (!confirm('Delete this supplier?')) return;
    try {
      await api.suppliers.delete(id);
      setModal(null);
      load();
    } catch (err) {
      alert(err.message);
    }
  };

  return (
    <>
      <h1 className="page-title">Suppliers</h1>
      <p style={{ color: 'var(--text-muted)', marginBottom: '1rem' }}>
        Parts vendors and creditors. LPOs are issued to a supplier from invoice lines; amounts owed use each LPO line net
        plus VAT (when applicable).
      </p>
      <div className="search-bar">
        <input
          type="search"
          placeholder="Search by name, email, phone, PIN…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <button type="button" className="btn primary" onClick={openCreate}>
          Add supplier
        </button>
      </div>
      <div className="card">
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Phone</th>
                <th>Email</th>
                <th>LPO cost total</th>
                <th>Paid</th>
                <th>Balance owed</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr>
                  <td colSpan={7}>Loading…</td>
                </tr>
              )}
              {!loading && list.length === 0 && (
                <tr>
                  <td colSpan={7} className="empty">
                    No suppliers yet. Add suppliers to assign when issuing LPOs.
                  </td>
                </tr>
              )}
              {!loading &&
                list.map((s) => (
                  <tr key={s.id}>
                    <td>
                      <Link to={`/suppliers/${s.id}`}>
                        <strong>{s.name}</strong>
                      </Link>
                    </td>
                    <td>{s.phone || '—'}</td>
                    <td>{s.email || '—'}</td>
                    <td>{kes(s.lpo_total_cost)}</td>
                    <td>{kes(s.payments_total)}</td>
                    <td>
                      <strong>{kes(s.balance_owed)}</strong>
                    </td>
                    <td>
                      <button type="button" className="btn" onClick={() => openEdit(s)}>
                        Edit
                      </button>
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
            <header>{modal === 'create' ? 'New supplier' : 'Edit supplier'}</header>
            <form className="body" onSubmit={submit}>
              <div className="form-group">
                <label>Name *</label>
                <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
              </div>
              <div className="form-group">
                <label>Phone</label>
                <input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
              </div>
              <div className="form-group">
                <label>Email</label>
                <input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
              </div>
              <div className="form-group">
                <label>Address</label>
                <textarea value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} rows={2} />
              </div>
              <div className="form-group">
                <label>PIN (KRA / tax ID)</label>
                <input
                  value={form.pin}
                  onChange={(e) => setForm({ ...form, pin: e.target.value })}
                  placeholder="e.g. P051234567X"
                  autoComplete="off"
                />
              </div>
              <div className="form-group">
                <label>Notes</label>
                <textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} rows={2} />
              </div>
            </form>
            <footer>
              {modal !== 'create' && (
                <button type="button" className="btn danger" onClick={() => remove(modal.id)}>
                  Delete
                </button>
              )}
              <button type="button" className="btn" onClick={() => setModal(null)}>
                Cancel
              </button>
              <button type="button" className="btn primary" onClick={submit}>
                Save
              </button>
            </footer>
          </div>
        </div>
      )}
    </>
  );
}
