import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { useAdmin } from '../auth/AdminContext';

function kes(n) {
  const x = Number(n);
  if (Number.isNaN(x)) return '—';
  return `KES ${x.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}

function rowKey(r) {
  return `${r.doc_type}-${r.doc_id}-${r.line_id}`;
}

function isRowReceived(r) {
  return Number(r.received_confirmed) === 1;
}

/** Case-insensitive substring match across visible row fields (pending + received). */
function assignedRowMatchesQuery(r, rawQuery) {
  const q = String(rawQuery || '').trim().toLowerCase();
  if (!q) return true;
  const hay = [
    r.doc_type,
    r.doc_ref,
    r.line_description,
    r.invoice_line_description,
    r.vehicle_registration,
    r.vehicle_type,
    r.job_number,
    r.job_id,
    r.quantity,
    r.unit_cost,
  ]
    .map((x) => String(x ?? '').toLowerCase())
    .join(' ');
  return hay.includes(q);
}

function AssignedDesktopRows({ rows, isMechanic, busyRow, onToggle }) {
  return rows.map((r) => {
    const isDone = isRowReceived(r);
    const key = rowKey(r);
    const locked = Number(r.doc_finalized || 0) === 1;
    return (
      <tr key={key}>
        <td>
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
            <input
              type="checkbox"
              checked={isDone}
              disabled={locked || busyRow === key}
              onChange={(e) => onToggle(r, e.target.checked)}
            />
            <span style={{ color: isDone ? 'var(--success)' : 'var(--danger)' }}>
              {isDone ? 'Received' : 'Pending'}
            </span>
          </label>
        </td>
        <td>
          <strong>
            {String(r.doc_type || '').toUpperCase()} {r.doc_ref}
          </strong>
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
  });
}

function AssignedMobileCards({ rows, isMechanic, busyRow, onToggle }) {
  return rows.map((r) => {
    const isDone = isRowReceived(r);
    const key = rowKey(r);
    const locked = Number(r.doc_finalized || 0) === 1;
    const jobLabel = r.job_id ? (isMechanic ? r.job_number || `Job #${r.job_id}` : null) : null;
    return (
      <div key={key} className="assigned-card">
        <div className="assigned-card-top">
          <div className="assigned-card-doc">
            {String(r.doc_type || '').toUpperCase()} {r.doc_ref}
          </div>
          <div className="assigned-card-recv">
            <label>
              <input
                type="checkbox"
                checked={isDone}
                disabled={locked || busyRow === key}
                onChange={(e) => onToggle(r, e.target.checked)}
              />
              <span style={{ color: isDone ? 'var(--success)' : 'var(--danger)', fontWeight: 600 }}>
                {isDone ? 'Received' : 'Pending'}
              </span>
            </label>
          </div>
        </div>
        <dl className="assigned-card-dl">
          <dt>Line</dt>
          <dd>
            {r.line_description || '—'}
            {r.invoice_line_description ? (
              <div style={{ fontSize: '0.82rem', color: 'var(--text-muted)', marginTop: '0.2rem' }}>
                Invoice: {r.invoice_line_description}
              </div>
            ) : null}
          </dd>
          <dt>Plate</dt>
          <dd>{r.vehicle_registration || '—'}</dd>
          <dt>Vehicle</dt>
          <dd>{(r.vehicle_type || '').trim() || '—'}</dd>
          <dt>Qty</dt>
          <dd>{Number(r.quantity || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}</dd>
          {!isMechanic && (
            <>
              <dt>Unit</dt>
              <dd>{kes(r.unit_cost)}</dd>
            </>
          )}
          <dt>Job</dt>
          <dd>
            {r.job_id
              ? isMechanic
                ? jobLabel
                : <Link to={`/jobs/${r.job_id}`}>{r.job_number || `Job #${r.job_id}`}</Link>
              : '—'}
          </dd>
        </dl>
      </div>
    );
  });
}

export default function AssignedReceipts() {
  const { admin } = useAdmin();
  const isMechanic = Boolean(admin?.is_mechanic);
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busyRow, setBusyRow] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [receivedPanelOpen, setReceivedPanelOpen] = useState(false);

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
    const key = rowKey(row);
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
        prev.map((r) => (rowKey(r) === key ? { ...r, received_confirmed: checked ? 1 : 0 } : r)),
      );
    } catch (e) {
      setError(String(e?.message || 'Could not update received status.'));
    } finally {
      setBusyRow('');
    }
  };

  const { pendingRows, receivedRows } = useMemo(() => {
    const list = rows || [];
    return {
      pendingRows: list.filter((r) => !isRowReceived(r)),
      receivedRows: list.filter((r) => isRowReceived(r)),
    };
  }, [rows]);

  const searchTrim = searchQuery.trim();
  const pendingFiltered = useMemo(
    () => pendingRows.filter((r) => assignedRowMatchesQuery(r, searchTrim)),
    [pendingRows, searchTrim],
  );
  const receivedFiltered = useMemo(
    () => receivedRows.filter((r) => assignedRowMatchesQuery(r, searchTrim)),
    [receivedRows, searchTrim],
  );

  useEffect(() => {
    if (searchTrim && receivedFiltered.length > 0) setReceivedPanelOpen(true);
  }, [searchTrim, receivedFiltered.length]);

  const pendingCount = pendingRows.length;
  const receivedCount = receivedRows.length;
  const colSpan = isMechanic ? 7 : 8;

  return (
    <>
      <h1 className="page-title">Assigned parts to receive</h1>
      <p style={{ color: 'var(--text-muted)', marginTop: 0 }}>
        Parts/lines assigned to you across LPOs and IPRs. Showing <strong>pending</strong> below (
        {searchTrim ? (
          <>
            <strong>{pendingFiltered.length}</strong> of {pendingCount} match search
          </>
        ) : (
          <strong>{pendingCount}</strong>
        )}
        ).
        {receivedCount > 0 ? (
          <>
            {' '}
            {searchTrim ? (
              <>
                Received: <strong>{receivedFiltered.length}</strong> of {receivedCount} match — open{' '}
                <strong>Received parts</strong> for details.
              </>
            ) : (
              <>
                <strong>{receivedCount}</strong> marked received — expand <strong>Received parts</strong> to review or
                undo.
              </>
            )}
          </>
        ) : null}
      </p>

      <div className="card" style={{ marginBottom: '1rem', padding: '0.85rem 1rem' }}>
        <div className="form-group" style={{ marginBottom: 0 }}>
          <label htmlFor="assigned-parts-search">Search assigned lines</label>
          <input
            id="assigned-parts-search"
            type="search"
            placeholder="Plate, job number, LPO/IPR ref, line description…"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            autoComplete="off"
            style={{ width: '100%', maxWidth: '32rem' }}
          />
        </div>
        <p style={{ margin: '0.45rem 0 0', fontSize: '0.82rem', color: 'var(--text-muted)' }}>
          Filters both <strong>pending</strong> and <strong>received</strong> lines. Clear the field to show everything
          again.
        </p>
      </div>

      {error ? (
        <div className="card" style={{ borderColor: 'var(--danger)', color: 'var(--danger)' }}>
          {error}
        </div>
      ) : null}

      <div className="card assigned-table-desktop">
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
                  <td colSpan={colSpan}>Loading…</td>
                </tr>
              )}
              {!loading && rows.length === 0 && (
                <tr>
                  <td colSpan={colSpan} className="empty">
                    No assigned parts yet.
                  </td>
                </tr>
              )}
              {!loading && rows.length > 0 && pendingRows.length === 0 && (
                <tr>
                  <td colSpan={colSpan} className="empty">
                    No pending parts — everything assigned to you is marked received. Expand{' '}
                    <strong>Received parts</strong> below if you need to change a line.
                  </td>
                </tr>
              )}
              {!loading && pendingRows.length > 0 && pendingFiltered.length === 0 && (
                <tr>
                  <td colSpan={colSpan} className="empty">
                    No pending lines match your search. Try another term or clear the search field.
                  </td>
                </tr>
              )}
              {!loading && pendingFiltered.length > 0 && (
                <AssignedDesktopRows
                  rows={pendingFiltered}
                  isMechanic={isMechanic}
                  busyRow={busyRow}
                  onToggle={toggleReceived}
                />
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card assigned-cards-only-mobile" style={{ padding: '0 1.25rem' }}>
        {loading && <p className="empty" style={{ padding: '1.25rem 0' }}>Loading…</p>}
        {!loading && rows.length === 0 && (
          <p className="empty" style={{ padding: '1.25rem 0' }}>
            No assigned parts yet.
          </p>
        )}
        {!loading && rows.length > 0 && pendingRows.length === 0 && (
          <p className="empty" style={{ padding: '1.25rem 0' }}>
            No pending parts — all assigned lines are marked received. Open <strong>Received parts</strong> below to
            review.
          </p>
        )}
        {!loading && pendingRows.length > 0 && pendingFiltered.length === 0 && (
          <p className="empty" style={{ padding: '1.25rem 0' }}>
            No pending lines match your search.
          </p>
        )}
        {!loading && pendingFiltered.length > 0 && (
          <AssignedMobileCards
            rows={pendingFiltered}
            isMechanic={isMechanic}
            busyRow={busyRow}
            onToggle={toggleReceived}
          />
        )}
      </div>

      {!loading && receivedRows.length > 0 && (
        <details
          className="card"
          style={{ marginTop: '1rem', padding: 0, overflow: 'hidden' }}
          open={receivedPanelOpen}
          onToggle={(e) => setReceivedPanelOpen(e.target.open)}
        >
          <summary
            style={{
              cursor: 'pointer',
              fontWeight: 600,
              padding: '0.85rem 1.25rem',
              listStylePosition: 'outside',
              userSelect: 'none',
            }}
          >
            Received parts (
            {searchTrim ? `${receivedFiltered.length} of ${receivedCount} match` : receivedCount})
          </summary>
          <div style={{ borderTop: '1px solid var(--border)' }}>
            <div className="assigned-table-desktop" style={{ borderRadius: 0, border: 'none', boxShadow: 'none' }}>
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
                    {receivedFiltered.length === 0 ? (
                      <tr>
                        <td colSpan={colSpan} className="empty">
                          No received lines match your search.
                        </td>
                      </tr>
                    ) : (
                      <AssignedDesktopRows
                        rows={receivedFiltered}
                        isMechanic={isMechanic}
                        busyRow={busyRow}
                        onToggle={toggleReceived}
                      />
                    )}
                  </tbody>
                </table>
              </div>
            </div>
            <div
              className="assigned-cards-only-mobile"
              style={{ padding: '0 1.25rem 1rem', borderRadius: 0, border: 'none', boxShadow: 'none' }}
            >
              {receivedFiltered.length === 0 ? (
                <p className="empty" style={{ padding: '1rem 0' }}>
                  No received lines match your search.
                </p>
              ) : (
                <AssignedMobileCards
                  rows={receivedFiltered}
                  isMechanic={isMechanic}
                  busyRow={busyRow}
                  onToggle={toggleReceived}
                />
              )}
            </div>
          </div>
        </details>
      )}
    </>
  );
}
