import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { useAdmin } from '../auth/AdminContext';

function fmtJobLabel(j) {
  const reg = j.registration || '—';
  const veh = [j.make, j.model].filter(Boolean).join(' ');
  return `${j.job_number || `Job #${j.id}`} · ${reg}${veh ? ` · ${veh}` : ''}`;
}

export default function TimeLogs() {
  const { admin } = useAdmin();
  const isMechanic = Boolean(admin?.is_mechanic);
  const [jobs, setJobs] = useState([]);
  const [jobSearch, setJobSearch] = useState('');
  const [selectedJobId, setSelectedJobId] = useState('');
  const [hours, setHours] = useState('');
  const [workedDate, setWorkedDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [myLogs, setMyLogs] = useState([]);
  const [loadingLogs, setLoadingLogs] = useState(true);

  const loadJobs = () =>
    api.jobs
      .list({ q: jobSearch.trim() || undefined })
      .then(setJobs)
      .catch((e) => alert(e.message));

  const loadMyLogs = () => {
    setLoadingLogs(true);
    return api.jobs
      .myTimeLogs(workedDate)
      .then(setMyLogs)
      .catch((e) => alert(e.message))
      .finally(() => setLoadingLogs(false));
  };

  useEffect(() => {
    loadJobs();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobSearch]);

  useEffect(() => {
    loadMyLogs();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workedDate]);

  const submit = async (e) => {
    e.preventDefault();
    const jobId = Number(selectedJobId);
    const hrs = Number(hours);
    if (!jobId) return alert('Select a job');
    if (!hrs || hrs <= 0) return alert('Enter a positive hours value');
    setBusy(true);
    try {
      await api.jobs.addTimeLog(jobId, {
        hours: hrs,
        worked_at: workedDate ? `${workedDate}T12:00:00` : undefined,
        notes: notes.trim() || undefined,
      });
      setHours('');
      setNotes('');
      await loadMyLogs();
    } catch (err) {
      alert(err.message);
    } finally {
      setBusy(false);
    }
  };

  const removeLog = async (row) => {
    if (!confirm('Remove this time log?')) return;
    try {
      await api.jobs.deleteTimeLog(row.job_id, row.id);
      await loadMyLogs();
    } catch (err) {
      alert(err.message);
    }
  };

  const dayTotal = useMemo(
    () => (myLogs || []).reduce((s, r) => s + Number(r.hours || 0), 0),
    [myLogs],
  );

  return (
    <>
      <h1 className="page-title">Time logs</h1>
      <p style={{ color: 'var(--text-muted)', marginTop: 0 }}>
        Log your daily hours against jobs. Job pages show a summary by employee.
      </p>

      <div className="card" style={{ marginBottom: '1rem' }}>
        <form onSubmit={submit}>
          <div className="form-group">
            <label>Find job</label>
            <input
              type="search"
              value={jobSearch}
              onChange={(e) => setJobSearch(e.target.value)}
              placeholder="Search by job number, registration, customer…"
            />
          </div>
          <div className="form-group">
            <label>Job *</label>
            <select value={selectedJobId} onChange={(e) => setSelectedJobId(e.target.value)} required>
              <option value="">— Select job —</option>
              {jobs.map((j) => (
                <option key={j.id} value={j.id}>
                  {fmtJobLabel(j)}
                </option>
              ))}
            </select>
          </div>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))',
              gap: '0.75rem',
              alignItems: 'end',
            }}
          >
            <div className="form-group" style={{ margin: 0 }}>
              <label>Hours *</label>
              <input type="number" min="0.1" step="0.1" value={hours} onChange={(e) => setHours(e.target.value)} required />
            </div>
            <div className="form-group" style={{ margin: 0 }}>
              <label>Date worked</label>
              <input type="date" value={workedDate} onChange={(e) => setWorkedDate(e.target.value)} />
            </div>
          </div>
          <div className="form-group" style={{ marginTop: '0.75rem' }}>
            <label>Notes (optional)</label>
            <input type="text" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. Fault diagnostics, repairs" />
          </div>
          <button type="submit" className="btn primary" disabled={busy}>
            {busy ? 'Saving…' : 'Log hours'}
          </button>
        </form>
      </div>

      <div className="card">
        <h3 style={{ marginTop: 0 }}>My logs for {workedDate}</h3>
        <p style={{ color: 'var(--text-muted)' }}>Total logged: <strong>{dayTotal.toLocaleString(undefined, { maximumFractionDigits: 2 })} hrs</strong></p>
        <div className="table-wrap time-logs-table-desktop">
          <table>
            <thead>
              <tr>
                <th>Job</th>
                <th>Hours</th>
                <th>Notes</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {loadingLogs && (
                <tr><td colSpan={4}>Loading…</td></tr>
              )}
              {!loadingLogs && myLogs.length === 0 && (
                <tr><td colSpan={4} className="empty">No time logs for this date.</td></tr>
              )}
              {!loadingLogs &&
                myLogs.map((r) => (
                  <tr key={r.id}>
                    <td>
                      {isMechanic ? (
                        r.job_number || `Job #${r.job_id}`
                      ) : (
                        <Link to={`/jobs/${r.job_id}`}>{r.job_number || `Job #${r.job_id}`}</Link>
                      )}
                    </td>
                    <td>{Number(r.hours || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}</td>
                    <td style={{ color: 'var(--text-muted)' }}>{r.notes || '—'}</td>
                    <td>
                      <button type="button" className="btn" style={{ padding: '0.2rem 0.5rem', fontSize: '0.8rem' }} onClick={() => removeLog(r)}>
                        Remove
                      </button>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>

        <div className="time-logs-cards-only-mobile">
          {loadingLogs && <p className="empty" style={{ padding: '0.5rem 0' }}>Loading…</p>}
          {!loadingLogs && myLogs.length === 0 && (
            <p className="empty" style={{ padding: '0.5rem 0' }}>No time logs for this date.</p>
          )}
          {!loadingLogs &&
            myLogs.map((r) => (
              <div key={r.id} className="time-log-card">
                <div className="time-log-card-job">
                  {isMechanic ? (
                    r.job_number || `Job #${r.job_id}`
                  ) : (
                    <Link to={`/jobs/${r.job_id}`}>{r.job_number || `Job #${r.job_id}`}</Link>
                  )}
                </div>
                <div className="time-log-card-meta">
                  <span>
                    <strong style={{ color: 'var(--text)' }}>{Number(r.hours || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}</strong> hrs
                  </span>
                  {r.notes ? <span>{r.notes}</span> : <span>No notes</span>}
                </div>
                <div style={{ marginTop: '0.65rem' }}>
                  <button type="button" className="btn danger" onClick={() => removeLog(r)}>
                    Remove log
                  </button>
                </div>
              </div>
            ))}
        </div>
      </div>
    </>
  );
}

