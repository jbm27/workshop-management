import { useEffect, useMemo, useState } from 'react';
import { useAdmin } from '../auth/AdminContext';
import { api } from '../api';

function kesWhole(n) {
  const x = Math.round(Number(n));
  if (Number.isNaN(x)) return '—';
  return `KES ${x.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

function defaultDateRange() {
  const to = new Date();
  const from = new Date();
  from.setDate(from.getDate() - 30);
  const iso = (d) => d.toISOString().slice(0, 10);
  return { from: iso(from), to: iso(to) };
}

export default function TeamStats() {
  const { admin } = useAdmin();
  const canManage = admin?.permissions?.can_manage_team_members;

  const [{ from, to }, setRange] = useState(defaultDateRange);
  const [includeInactive, setIncludeInactive] = useState(false);
  const [filterUserId, setFilterUserId] = useState('');
  const [userOptions, setUserOptions] = useState([]);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [detailModal, setDetailModal] = useState(null); // { type: 'parts'|'hours', member, rows, loading, error }

  useEffect(() => {
    if (!canManage) return;
    api.admin.users
      .list()
      .then(setUserOptions)
      .catch(() => setUserOptions([]));
  }, [canManage]);

  const load = () => {
    setLoading(true);
    setError('');
    api.admin
      .teamStats({
        from,
        to,
        include_inactive: includeInactive,
        admin_user_id: filterUserId || undefined,
      })
      .then(setData)
      .catch((e) => {
        setData(null);
        setError(String(e?.message || 'Could not load statistics.'));
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    if (!canManage) return;
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canManage]);

  const applyFilters = (e) => {
    e?.preventDefault?.();
    load();
  };

  const totals = useMemo(() => {
    const m = data?.members || [];
    const qty = m.reduce((s, r) => s + Number(r.parts_quantity_total || 0), 0);
    const val = m.reduce((s, r) => s + Number(r.parts_value_total || 0), 0);
    return {
      partsQty: Math.round((qty + Number.EPSILON) * 1000) / 1000,
      partsValue: Math.round(val + Number.EPSILON),
      hours: Math.round(m.reduce((s, r) => s + r.hours_logged, 0) * 100) / 100,
    };
  }, [data]);

  const openParts = async (member) => {
    setDetailModal({ type: 'parts', member, rows: [], loading: true, error: '' });
    try {
      const out = await api.admin.teamStatsParts(member.id, { from, to });
      setDetailModal({ type: 'parts', member, rows: out.rows || [], loading: false, error: '' });
    } catch (e) {
      setDetailModal({ type: 'parts', member, rows: [], loading: false, error: String(e?.message || 'Could not load parts details.') });
    }
  };

  const openHours = async (member) => {
    setDetailModal({ type: 'hours', member, rows: [], loading: true, error: '' });
    try {
      const out = await api.admin.teamStatsHours(member.id, { from, to });
      setDetailModal({ type: 'hours', member, rows: out.rows || [], loading: false, error: '' });
    } catch (e) {
      setDetailModal({ type: 'hours', member, rows: [], loading: false, error: String(e?.message || 'Could not load hours details.') });
    }
  };

  if (!canManage) {
    return (
      <div style={{ padding: '1rem' }}>
        <h1 className="page-title">Team statistics</h1>
        <p style={{ color: 'var(--text-muted)' }}>You do not have permission to view team statistics.</p>
      </div>
    );
  }

  return (
    <>
      <h1 className="page-title">Team statistics</h1>
      <p style={{ color: 'var(--text-muted)', marginTop: 0, maxWidth: '52rem' }}>
        Use this report to review activity in a date range. <strong>Parts</strong> is the total quantity on LPO and IPR
        lines that person confirmed as received (combined). <strong>Parts value</strong> is the sum of (quantity ×
        invoice line sale unit price) for those lines — the customer-facing price on the invoice, not supplier cost.
        Lines without a linked invoice item contribute quantity only (no sale value). <strong>Hours</strong> comes from
        time logs on jobs.
      </p>

      <form className="card" style={{ marginBottom: '1rem' }} onSubmit={applyFilters}>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))',
            gap: '0.75rem',
            alignItems: 'end',
          }}
        >
          <div className="form-group" style={{ margin: 0 }}>
            <label>From</label>
            <input type="date" value={from} onChange={(e) => setRange((r) => ({ ...r, from: e.target.value }))} required />
          </div>
          <div className="form-group" style={{ margin: 0 }}>
            <label>To</label>
            <input type="date" value={to} onChange={(e) => setRange((r) => ({ ...r, to: e.target.value }))} required />
          </div>
          <div className="form-group" style={{ margin: 0 }}>
            <label>Team member</label>
            <select value={filterUserId} onChange={(e) => setFilterUserId(e.target.value)}>
              <option value="">All</option>
              {userOptions.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.display_name || u.username}
                  {!u.active ? ' (inactive)' : ''}
                </option>
              ))}
            </select>
          </div>
          <div className="form-group" style={{ margin: 0 }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <input type="checkbox" checked={includeInactive} onChange={(e) => setIncludeInactive(e.target.checked)} />
              Include inactive accounts
            </label>
          </div>
          <div>
            <button type="submit" className="btn primary" disabled={loading}>
              {loading ? 'Loading…' : 'Apply'}
            </button>
          </div>
        </div>
      </form>

      {error ? (
        <div className="card" style={{ borderColor: 'var(--danger)', color: 'var(--danger)', marginBottom: '1rem' }}>
          {error}
        </div>
      ) : null}

      {data && !loading && (
        <p style={{ color: 'var(--text-muted)', marginTop: 0 }}>
          Period <strong>{data.from}</strong> to <strong>{data.to}</strong> (all listed members) —{' '}
          <strong>{totals.partsQty.toLocaleString(undefined, { maximumFractionDigits: 3 })}</strong> parts,{' '}
          <strong>{kesWhole(totals.partsValue)}</strong> parts value,{' '}
          <strong>{totals.hours.toLocaleString(undefined, { maximumFractionDigits: 2 })}</strong> hours logged.
        </p>
      )}

      <div className="card">
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Team member</th>
                <th>Role</th>
                <th>Parts (qty)</th>
                <th>Parts value</th>
                <th>Hours logged</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr>
                  <td colSpan={6}>Loading…</td>
                </tr>
              )}
              {!loading && data && data.members.length === 0 && (
                <tr>
                  <td colSpan={6} className="empty">
                    No team members match the filters.
                  </td>
                </tr>
              )}
              {!loading &&
                data &&
                data.members.map((r) => (
                  <tr key={r.id}>
                    <td>
                      <strong>{r.display_name || r.username}</strong>
                      {!r.active ? <span style={{ color: 'var(--text-muted)' }}> (inactive)</span> : null}
                    </td>
                    <td>{r.is_mechanic ? 'Mechanic' : 'Staff'}</td>
                    <td>{Number(r.parts_quantity_total || 0).toLocaleString(undefined, { maximumFractionDigits: 3 })}</td>
                    <td>{kesWhole(r.parts_value_total)}</td>
                    <td>{r.hours_logged.toLocaleString(undefined, { maximumFractionDigits: 2 })}</td>
                    <td>
                      <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                        <button type="button" className="btn" onClick={() => openHours(r)}>View hours</button>
                        <button type="button" className="btn" onClick={() => openParts(r)}>View parts</button>
                      </div>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </div>

      {detailModal && (
        <div className="modal-overlay" onClick={() => setDetailModal(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 'min(1100px, 95vw)' }}>
            <header>
              {detailModal.type === 'parts' ? 'Parts received details' : 'Hours details'} —{' '}
              {detailModal.member.display_name || detailModal.member.username}
              <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)', fontWeight: 400, marginTop: '0.25rem' }}>
                Date filter: {from} to {to}
              </div>
            </header>
            <div className="body">
              {detailModal.error ? (
                <div className="card" style={{ borderColor: 'var(--danger)', color: 'var(--danger)', marginBottom: '0.75rem' }}>
                  {detailModal.error}
                </div>
              ) : null}
              <div className="table-wrap">
                <table>
                  <thead>
                    {detailModal.type === 'parts' ? (
                      <tr>
                        <th>Date</th>
                        <th>Document</th>
                        <th>Description</th>
                        <th>Qty</th>
                        <th>Sale unit</th>
                        <th>Sale value</th>
                        <th>Job / Vehicle</th>
                      </tr>
                    ) : (
                      <tr>
                        <th>Date</th>
                        <th>Hours</th>
                        <th>Job / Vehicle</th>
                        <th>Notes</th>
                      </tr>
                    )}
                  </thead>
                  <tbody>
                    {detailModal.loading && (
                      <tr>
                        <td colSpan={detailModal.type === 'parts' ? 7 : 4}>Loading…</td>
                      </tr>
                    )}
                    {!detailModal.loading && detailModal.rows.length === 0 && (
                      <tr>
                        <td colSpan={detailModal.type === 'parts' ? 7 : 4} className="empty">
                          No records for this period.
                        </td>
                      </tr>
                    )}
                    {!detailModal.loading && detailModal.type === 'parts' &&
                      detailModal.rows.map((r) => (
                        <tr key={`${r.doc_type}-${r.doc_ref}-${r.line_id}-${r.received_confirmed_at}`}>
                          <td>{String(r.received_confirmed_at || '').slice(0, 10) || '—'}</td>
                          <td>{String(r.doc_type || '').toUpperCase()} {r.doc_ref}</td>
                          <td>{r.line_description || '—'}</td>
                          <td>{Number(r.quantity || 0).toLocaleString(undefined, { maximumFractionDigits: 3 })}</td>
                          <td>{kesWhole(r.sale_unit_price || 0)}</td>
                          <td>{kesWhole(r.sale_line_value || 0)}</td>
                          <td>{r.job_number || '—'}{r.vehicle_registration ? ` · ${r.vehicle_registration}` : ''}</td>
                        </tr>
                      ))}
                    {!detailModal.loading && detailModal.type === 'hours' &&
                      detailModal.rows.map((r) => (
                        <tr key={`h-${r.id}`}>
                          <td>{String(r.worked_at || '').slice(0, 10) || '—'}</td>
                          <td>{Number(r.hours || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}</td>
                          <td>
                            {r.job_number || '—'}
                            {r.vehicle_registration ? ` · ${r.vehicle_registration}` : ''}
                            {(r.vehicle_make || r.vehicle_model) ? ` · ${[r.vehicle_make, r.vehicle_model].filter(Boolean).join(' ')}` : ''}
                          </td>
                          <td>{r.notes || '—'}</td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            </div>
            <footer>
              <button type="button" className="btn" onClick={() => setDetailModal(null)}>Close</button>
            </footer>
          </div>
        </div>
      )}
    </>
  );
}
