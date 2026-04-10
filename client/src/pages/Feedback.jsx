import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';

export default function Feedback() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [summary, setSummary] = useState({ count: 0, avg_rating: 0 });

  const load = (f, t) => {
    setLoading(true);
    api.reports.feedback(f, t)
      .then((res) => {
        if (Array.isArray(res)) {
          // backwards-compat, but current API returns { rows, summary }
          setRows(res);
          setSummary({ count: res.length, avg_rating: 0 });
        } else {
          setRows(res.rows || []);
          setSummary(res.summary || { count: 0, avg_rating: 0 });
        }
      })
      .catch((err) => {
        console.error(err);
        alert('Failed to load feedback');
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load(from, to);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <>
      <h1 className="page-title">Customer feedback</h1>
      <div className="card" style={{ marginBottom: '1rem' }}>
        <div style={{ display: 'flex', gap: '1rem', alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <div className="form-group" style={{ margin: 0 }}>
            <label>From date</label>
            <input
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
            />
          </div>
          <div className="form-group" style={{ margin: 0 }}>
            <label>To date</label>
            <input
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
            />
          </div>
          <button
            type="button"
            className="btn"
            onClick={() => load(from, to)}
          >
            Apply filter
          </button>
          <button
            type="button"
            className="btn"
            onClick={() => {
              setFrom('');
              setTo('');
              load('', '');
            }}
          >
            Clear
          </button>
          <div style={{ marginLeft: 'auto', fontSize: '0.9rem', color: 'var(--text-muted)' }}>
            {summary.count > 0 ? (
              <>
                <span style={{ fontWeight: 600 }}>
                  Avg rating: {summary.avg_rating.toFixed(1)} / 5
                </span>{' '}
                <span style={{ marginLeft: '0.5rem' }}>
                  {'★'.repeat(Math.round(summary.avg_rating))}{'☆'.repeat(5 - Math.round(summary.avg_rating))}
                </span>{' '}
                <span>
                  ({summary.count} {summary.count === 1 ? 'response' : 'responses'})
                </span>
              </>
            ) : (
              <span>No ratings in this range.</span>
            )}
          </div>
        </div>
      </div>
      <div className="card">
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th>Job</th>
                <th>Customer</th>
                <th>Vehicle</th>
                <th>Rating</th>
                <th>Feedback</th>
              </tr>
            </thead>
            <tbody>
              {loading && <tr><td colSpan={6}>Loading…</td></tr>}
              {!loading && rows.length === 0 && (
                <tr><td colSpan={6} className="empty">No feedback yet.</td></tr>
              )}
              {!loading && rows.map((r) => (
                <tr key={r.id}>
                  <td>{r.completed_at ? new Date(r.completed_at).toLocaleDateString() : '—'}</td>
                  <td>
                    <Link to={`/jobs/${r.id}`}>{r.job_number}</Link>
                  </td>
                  <td>{r.customer_name || '—'}</td>
                  <td>{[r.registration, r.make, r.model].filter(Boolean).join(' ') || '—'}</td>
                  <td>
                    {r.customer_rating
                      ? '★'.repeat(r.customer_rating) + '☆'.repeat(5 - r.customer_rating)
                      : '—'}
                  </td>
                  <td style={{ maxWidth: '24rem', whiteSpace: 'pre-wrap' }}>
                    {r.customer_feedback || '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}

