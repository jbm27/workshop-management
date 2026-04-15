import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';

function kes(n) {
  const x = Number(n);
  if (Number.isNaN(x)) return '—';
  return `KES ${x.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}

function pct(n) {
  if (n == null || Number.isNaN(n)) return '—';
  return `${Number(n).toFixed(1)}%`;
}

function stars(rating) {
  const r = Math.round(Number(rating) || 0);
  if (r < 1) return '—';
  return '★'.repeat(Math.min(5, r)) + '☆'.repeat(Math.max(0, 5 - Math.min(5, r)));
}

function defaultFromTo() {
  const now = new Date();
  const from = new Date(now.getFullYear(), now.getMonth(), 1);
  return {
    from: from.toISOString().slice(0, 10),
    to: now.toISOString().slice(0, 10),
  };
}

export default function JobReports() {
  const [{ from, to }, setRange] = useState(() => defaultFromTo());
  const [dateBasis, setDateBasis] = useState('created');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [payload, setPayload] = useState(null);

  const fetchReport = (f, t, basis) => {
    if (!f || !t) {
      setError('Choose both from and to dates.');
      return;
    }
    setLoading(true);
    setError('');
    api.reports
      .jobsFinancial({ from: f, to: t, date_basis: basis })
      .then(setPayload)
      .catch((e) => {
        setError(e.message || 'Failed to load report');
        setPayload(null);
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    const d = defaultFromTo();
    fetchReport(d.from, d.to, 'created');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const s = payload?.summary;
  const rows = payload?.rows || [];

  return (
    <>
      <h1 className="page-title">Job reports</h1>
      <p style={{ color: 'var(--text-muted)', marginTop: '-0.5rem', marginBottom: '1rem', maxWidth: '52rem' }}>
        Financial figures match each job&apos;s invoice (ex-VAT subtotal vs internal costs: LPO/IPR allocations where set,
        otherwise line purchase estimates; labour from time logs × rate). Margins are undefined when the relevant
        revenue is zero.
      </p>

      <div className="card" style={{ marginBottom: '1rem' }}>
        <div style={{ display: 'flex', gap: '1rem', alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <div className="form-group" style={{ margin: 0 }}>
            <label>From date</label>
            <input type="date" value={from} onChange={(e) => setRange((r) => ({ ...r, from: e.target.value }))} />
          </div>
          <div className="form-group" style={{ margin: 0 }}>
            <label>To date</label>
            <input type="date" value={to} onChange={(e) => setRange((r) => ({ ...r, to: e.target.value }))} />
          </div>
          <div className="form-group" style={{ margin: 0 }}>
            <label>Date basis</label>
            <select value={dateBasis} onChange={(e) => setDateBasis(e.target.value)}>
              <option value="created">Job created</option>
              <option value="completed">Job completed</option>
            </select>
          </div>
          <button type="button" className="btn primary" onClick={() => fetchReport(from, to, dateBasis)} disabled={loading}>
            {loading ? 'Loading…' : 'Apply'}
          </button>
          <button
            type="button"
            className="btn"
            onClick={() => {
              const d = defaultFromTo();
              setRange(d);
              setDateBasis('created');
              fetchReport(d.from, d.to, 'created');
            }}
          >
            Reset to this month
          </button>
        </div>
        {error ? <p style={{ color: 'var(--danger)', margin: '0.75rem 0 0' }}>{error}</p> : null}
      </div>

      {payload && !loading && (
        <div className="card" style={{ marginBottom: '1rem' }}>
          <h3 style={{ marginTop: 0 }}>Period averages ({payload.date_basis === 'completed' ? 'completed date' : 'created date'})</h3>
          <p style={{ fontSize: '0.88rem', color: 'var(--text-muted)', marginTop: 0 }}>
            {s.job_count} job{s.job_count === 1 ? '' : 's'} · {s.jobs_with_invoice} with an invoice · Averages are simple means across all jobs in the table (margins exclude rows where the value is not applicable).
          </p>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Jobs</th>
                  <th style={{ textAlign: 'right' }}>Avg revenue</th>
                  <th style={{ textAlign: 'right' }}>Avg total cost</th>
                  <th style={{ textAlign: 'right' }}>Avg profit</th>
                  <th style={{ textAlign: 'right' }}>Avg profit margin</th>
                  <th style={{ textAlign: 'right' }}>Avg labour margin</th>
                  <th style={{ textAlign: 'right' }}>Avg spares margin</th>
                  <th style={{ textAlign: 'right' }}>Avg rating</th>
                  <th style={{ textAlign: 'right' }}>Σ revenue</th>
                  <th style={{ textAlign: 'right' }}>Σ profit</th>
                  <th style={{ textAlign: 'right' }}>Aggregate profit margin</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>{s.job_count}</td>
                  <td style={{ textAlign: 'right' }}>{s.avg_revenue != null ? kes(s.avg_revenue) : '—'}</td>
                  <td style={{ textAlign: 'right' }}>{s.avg_total_cost != null ? kes(s.avg_total_cost) : '—'}</td>
                  <td style={{ textAlign: 'right' }}>{s.avg_profit != null ? kes(s.avg_profit) : '—'}</td>
                  <td style={{ textAlign: 'right' }}>{pct(s.avg_profit_margin_pct)}</td>
                  <td style={{ textAlign: 'right' }}>{pct(s.avg_labour_margin_pct)}</td>
                  <td style={{ textAlign: 'right' }}>{pct(s.avg_spares_margin_pct)}</td>
                  <td style={{ textAlign: 'right' }}>
                    {s.avg_customer_rating != null ? `${s.avg_customer_rating.toFixed(1)} / 5` : '—'}
                  </td>
                  <td style={{ textAlign: 'right' }}>{kes(s.sum_revenue)}</td>
                  <td style={{ textAlign: 'right' }}>{kes(s.sum_profit)}</td>
                  <td style={{ textAlign: 'right' }}>{pct(s.aggregate_profit_margin_pct)}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <p style={{ fontSize: '0.82rem', color: 'var(--text-muted)', marginBottom: 0 }}>
            <strong>Aggregate profit margin</strong> is total profit ÷ total revenue for the period (not the same as the average of per-job margins).
          </p>
        </div>
      )}

      <div className="card">
        <h3 style={{ marginTop: 0 }}>Jobs in period</h3>
        {loading && <p style={{ color: 'var(--text-muted)' }}>Loading…</p>}
        {!loading && rows.length === 0 && <p style={{ color: 'var(--text-muted)' }}>No jobs in this date range.</p>}
        {!loading && rows.length > 0 && (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Job</th>
                  <th>Customer</th>
                  <th>Vehicle</th>
                  <th style={{ textAlign: 'right' }}>Revenue</th>
                  <th style={{ textAlign: 'right' }}>Total cost</th>
                  <th style={{ textAlign: 'right' }}>Profit</th>
                  <th style={{ textAlign: 'right' }}>Profit margin</th>
                  <th style={{ textAlign: 'right' }}>Labour margin</th>
                  <th style={{ textAlign: 'right' }}>Spares margin</th>
                  <th>Rating</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.job_id}>
                    <td>
                      <Link to={`/jobs/${r.job_id}`}>{r.job_number}</Link>
                      {!r.has_invoice && (
                        <span style={{ display: 'block', fontSize: '0.75rem', color: 'var(--text-muted)' }}>No invoice</span>
                      )}
                    </td>
                    <td>{r.customer_name || '—'}</td>
                    <td>{r.vehicle_label || '—'}</td>
                    <td style={{ textAlign: 'right' }}>{kes(r.revenue)}</td>
                    <td style={{ textAlign: 'right' }}>{kes(r.total_cost)}</td>
                    <td style={{ textAlign: 'right' }}>{kes(r.profit)}</td>
                    <td style={{ textAlign: 'right' }}>{pct(r.profit_margin_pct)}</td>
                    <td style={{ textAlign: 'right' }}>{pct(r.labour_margin_pct)}</td>
                    <td style={{ textAlign: 'right' }}>{pct(r.spares_margin_pct)}</td>
                    <td style={{ whiteSpace: 'nowrap' }} title={r.customer_rating != null ? `${r.customer_rating} / 5` : ''}>
                      {stars(r.customer_rating)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
