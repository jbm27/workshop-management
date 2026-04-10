import { useEffect, useState } from 'react';
import { api } from '../api';

export default function JobTypes() {
  const [list, setList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState(null);
  const [form, setForm] = useState({ name: '', description: '', default_labour_hours: 0, default_labour_rate: 0 });

  const load = () => api.jobTypes.list().then(setList).catch(console.error).finally(() => setLoading(false));

  useEffect(() => {
    load();
  }, []);

  const openCreate = () => {
    setForm({ name: '', description: '', default_labour_hours: 0, default_labour_rate: 0 });
    setModal('create');
  };
  const openEdit = (t) => {
    setForm({
      name: t.name,
      description: t.description || '',
      default_labour_hours: t.default_labour_hours ?? 0,
      default_labour_rate: t.default_labour_rate ?? 0,
    });
    setModal({ type: 'edit', id: t.id });
  };
  const submit = async (e) => {
    e.preventDefault();
    if (!form.name) return alert('Name is required');
    try {
      if (modal === 'create') await api.jobTypes.create(form);
      else await api.jobTypes.update(modal.id, form);
      setModal(null);
      load();
    } catch (err) {
      alert(err.message);
    }
  };
  const remove = async (id) => {
    if (!confirm('Delete this job type?')) return;
    try {
      await api.jobTypes.delete(id);
      setModal(null);
      load();
    } catch (err) {
      alert(err.message);
    }
  };

  return (
    <>
      <h1 className="page-title">Job types</h1>
      <p style={{ color: 'var(--text-muted)', marginBottom: '1rem' }}>
        Templates for common jobs (e.g. logbook service). When creating a job, you can pick a type to pre-fill labour and description.
      </p>
      <div className="search-bar">
        <button type="button" className="btn primary" onClick={openCreate}>Add job type</button>
      </div>
      <div className="card">
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Description</th>
                <th>Labour hours</th>
                <th>Labour rate (KES)</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {loading && <tr><td colSpan={5}>Loading…</td></tr>}
              {!loading && list.length === 0 && <tr><td colSpan={5} className="empty">No job types. Add one to use as templates.</td></tr>}
              {!loading && list.map((t) => (
                <tr key={t.id}>
                  <td><strong>{t.name}</strong></td>
                  <td>{t.description || '—'}</td>
                  <td>{t.default_labour_hours ?? 0}</td>
                  <td>{Number(t.default_labour_rate ?? 0).toLocaleString()}</td>
                  <td>
                    <button type="button" className="btn" onClick={() => openEdit(t)}>Edit</button>
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
            <header>{modal === 'create' ? 'New job type' : 'Edit job type'}</header>
            <form className="body" onSubmit={submit}>
              <div className="form-group">
                <label>Name *</label>
                <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
              </div>
              <div className="form-group">
                <label>Description</label>
                <textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} rows={2} />
              </div>
              <div className="form-group">
                <label>Default labour hours</label>
                <input type="number" min="0" step="0.25" value={form.default_labour_hours} onChange={(e) => setForm({ ...form, default_labour_hours: e.target.value })} />
              </div>
              <div className="form-group">
                <label>Default labour rate (KES)</label>
                <input type="number" min="0" step="0.01" value={form.default_labour_rate} onChange={(e) => setForm({ ...form, default_labour_rate: e.target.value })} />
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
