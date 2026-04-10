import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';

export default function Dashboard() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.reports.dashboard().then(setData).catch(console.error).finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="page-title">Loading…</div>;
  if (!data) return <div className="page-title">Failed to load dashboard</div>;

  return (
    <>
      <h1 className="page-title">Dashboard</h1>
      <div className="grid-2" style={{ marginBottom: '1.5rem' }}>
        <Link to="/jobs" className="stat-card" style={{ textDecoration: 'none', color: 'inherit' }}>
          <div className="value">{data.pendingJobs}</div>
          <div className="label">Jobs in progress</div>
        </Link>
        <Link to="/invoices" className="stat-card" style={{ textDecoration: 'none', color: 'inherit' }}>
          <div className="value">{data.overdueInvoices}</div>
          <div className="label">Overdue invoices</div>
        </Link>
        <div className="stat-card">
          <div className="value">KES {Number(data.revenueThisMonth || 0).toLocaleString()}</div>
          <div className="label">Revenue this month</div>
        </div>
      </div>
      <div className="card">
        <h3 style={{ marginTop: 0 }}>Jobs by status</h3>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Status</th>
                <th>Count</th>
              </tr>
            </thead>
            <tbody>
              {data.jobsByStatus?.map((row) => (
                <tr key={row.status}>
                  <td><span className={`badge ${row.status}`}>{row.status.replace('_', ' ')}</span></td>
                  <td>{row.count}</td>
                </tr>
              ))}
              {(!data.jobsByStatus || data.jobsByStatus.length === 0) && (
                <tr><td colSpan={2}>No jobs yet</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
