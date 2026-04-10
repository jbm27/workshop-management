import { useEffect, useState } from 'react';
import { api } from '../api';

export default function Customers() {
  const [list, setList] = useState([]);
  const [q, setQ] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [modal, setModal] = useState(null);
  const [form, setForm] = useState({ name: '', email: '', phone: '', address: '', notes: '' });
  const [portalUrl, setPortalUrl] = useState('');

  const load = () => {
    setLoadError('');
    return api.customers
      .list(q)
      .then((rows) => {
        setList(rows);
        setLoadError('');
      })
      .catch((err) => {
        console.error(err);
        setList([]);
        setLoadError(
          err.message ||
            'Could not load customers. Start the API on port 3001 (see server folder).',
        );
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    setLoading(true);
    const t = setTimeout(load, 300);
    return () => clearTimeout(t);
  }, [q]);

  const openCreate = () => {
    setForm({ name: '', email: '', phone: '', address: '', notes: '' });
    setModal('create');
  };
  const openEdit = (c) => {
    setForm({ name: c.name, email: c.email || '', phone: c.phone || '', address: c.address || '', notes: c.notes || '' });
    setModal({ type: 'edit', id: c.id });
  };
  const submit = async (e) => {
    e.preventDefault();
    try {
      if (modal === 'create') await api.customers.create(form);
      else await api.customers.update(modal.id, form);
      setModal(null);
      load();
    } catch (err) {
      alert(err.message);
    }
  };
  const remove = async (id) => {
    if (!confirm('Delete this customer and their vehicles?')) return;
    try {
      await api.customers.delete(id);
      setModal(null);
      load();
    } catch (err) {
      alert(err.message);
    }
  };

  const getPortalLink = async (customer) => {
    try {
      const { portal_url } = await api.customers.portalLink(customer.id);
      setPortalUrl(portal_url);
      // Also copy to clipboard for convenience if available
      if (navigator.clipboard && portal_url) {
        try {
          await navigator.clipboard.writeText(portal_url);
        } catch (_) {
          // ignore clipboard errors
        }
      }
      alert(`Portal link for ${customer.name}:\n\n${portal_url}\n\n(It has been copied to your clipboard if your browser allows it.)`);
    } catch (err) {
      alert(err.message);
    }
  };

  return (
    <>
      <h1 className="page-title">Customers</h1>
      <div className="search-bar">
        <input
          type="search"
          placeholder="Search by name, email, phone…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <button type="button" className="btn primary" onClick={openCreate}>Add customer</button>
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
                <th>Name</th>
                <th>Phone</th>
                <th>Email</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {loading && <tr><td colSpan={4}>Loading…</td></tr>}
              {!loading && !loadError && list.length === 0 && <tr><td colSpan={4} className="empty">No customers</td></tr>}
              {!loading && list.map((c) => (
                <tr key={c.id}>
                  <td>{c.name}</td>
                  <td>{c.phone || '—'}</td>
                  <td>{c.email || '—'}</td>
                  <td style={{ width: '1%', whiteSpace: 'nowrap' }}>
                    <div style={{ display: 'flex', flexDirection: 'row', flexWrap: 'nowrap', gap: '0.5rem', alignItems: 'center' }}>
                      <button type="button" className="btn" onClick={() => openEdit(c)}>Edit</button>
                      <button type="button" className="btn" onClick={() => getPortalLink(c)}>Portal link</button>
                    </div>
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
            <header>{modal === 'create' ? 'New customer' : 'Edit customer'}</header>
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
                <label>Notes</label>
                <textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} rows={2} />
              </div>
            </form>
            <footer>
              {modal !== 'create' && (
                <button type="button" className="btn danger" onClick={() => remove(modal.id)}>Delete</button>
              )}
              <button type="button" className="btn" onClick={() => setModal(null)}>Cancel</button>
              <button type="submit" className="btn primary" onClick={submit}>Save</button>
            </footer>
          </div>
        </div>
      )}
    </>
  );
}
