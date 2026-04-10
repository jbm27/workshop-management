import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { useAdmin } from '../auth/AdminContext';

function kes(n) {
  const x = Number(n);
  if (Number.isNaN(x)) return '—';
  return `KES ${x.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}

export default function AssignedReceipts() {
  const { admin } = useAdmin();
  const isMechanic = Boolean(admin?.is_mechanic);
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busyRow, setBusyRow] = useState('');

  const load = () =>
    api.invoices
      .myAssignedReceipts()
      .then((data) => {
        setRows(data || []);
        setError('');
      })
      .catch((e) => {
        const msg = String(e?.message || '');
        if (/not found/i.test(msg)) {
          setError('Assigned parts endpoint not available yet. Please restart the server and try again.');
        } else {
          setError(msg || 'Could not load assigned parts.');
        }
      })
      .finally(() => setLoading(false));

  useEffect(() => {
    load();
  }, []);

  const toggleReceived = async (row, checked) => {
    const key = `${row.doc_type}-${row.doc_id}-${row.line_id}`;
    setBusyRow(key);
    setError('');
    try {
      if (row.doc_type === 'lpo') {
        await api.invoices.updateLpoLineReceipt(row.invoice_id, row.doc_id, row.line_id, {
          received_confirmed: checked,
        });
      } else {
        await api.invoices.updateIprLineReceipt(row.invoice_id, row.doc_id, row.line_id, {
          received_confirmed: checked,
        });
      }
      setRows((prev) =>
        prev.map((r) =>
          `${r.doc_type}-${r.doc_id}-${r.line_id}` === key
            ? { ...r, received_confirmed: checked ? 1 : 0 }
            : r,
        ),
      );
    } catch (e) {
      setError(String(e?.message || 'Could not update received status.'));
    } finally {
      setBusyRow('');
    }
  };

  const pendingCount = useMemo(
    () => (rows || []).filter((r) => Number(r.received_confirmed) !== 1).length,
    [rows],
  );

  return (
    <>
      <h1 className="page-title">Assigned parts to receive</h1>
      <p style={{ color: 'var(--text-muted)', marginTop: 0 }}>
        Parts/lines assigned to you across LPOs and IPRs. Pending: <strong>{pendingCount}</strong>
      </p>
      {error ? (
        <div className="card" style={{ borderColor: 'var(--danger)', color: 'var(--danger)' }}>
          {error}
        </div>
      ) : null}

      <div className="card">
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Received</th>
                <th>Document</th>
                <th>Line</th>
                <th>Plate</th>
                <th>Vehicle type</th>
                <th>Qty</th>
                {!isMechanic && <th>Unit cost</th>}
                <th>Job</th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr>
                  <td colSpan={isMechanic ? 7 : 8}>Loading…</td>
                </tr>
              )}
              {!loading && rows.length === 0 && (
                <tr>
                  <td colSpan={isMechanic ? 7 : 8} className="empty">No assigned parts yet.</td>
                </tr>
              )}
              {!loading &&
                rows.map((r) => {
                  const isDone = Number(r.received_confirmed) === 1;
                  const key = `${r.doc_type}-${r.doc_id}-${r.line_id}`;
                  const locked = Number(r.doc_finalized || 0) === 1;
                  return (
                    <tr key={key}>
                      <td>
                        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                          <input
                            type="checkbox"
                            checked={isDone}
                            disabled={locked || busyRow === key}
                            onChange={(e) => toggleReceived(r, e.target.checked)}
                          />
                          <span style={{ color: isDone ? 'var(--success)' : 'var(--danger)' }}>
                            {isDone ? 'Received' : 'Pending'}
                          </span>
                        </label>
                      </td>
                      <td>
                        <strong>{String(r.doc_type || '').toUpperCase()} {r.doc_ref}</strong>
                      </td>
                      <td>
                        {r.line_description || '—'}
                        {r.invoice_line_description ? (
                          <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                            Invoice line: {r.invoice_line_description}
                          </div>
                        ) : null}
                      </td>
                      <td>{r.vehicle_registration || '—'}</td>
                      <td>{(r.vehicle_type || '').trim() || '—'}</td>
                      <td>{Number(r.quantity || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}</td>
                      {!isMechanic && <td>{kes(r.unit_cost)}</td>}
                      <td>
                        {r.job_id
                          ? isMechanic
                            ? r.job_number || `Job #${r.job_id}`
                            : <Link to={`/jobs/${r.job_id}`}>{r.job_number || `Job #${r.job_id}`}</Link>
                          : '—'}
                      </td>
                    </tr>
                  );
                })}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}

