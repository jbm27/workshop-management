import { Fragment, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../api';

const STATUS_LABEL = {
  pending: 'In progress',
  in_progress: 'In progress',
  vehicle_released: 'Vehicle released',
  completed: 'Completed',
  cancelled: 'Cancelled',
};

function kes(n) {
  if (n == null || !Number.isFinite(Number(n))) return '—';
  return `KES ${Math.round(Number(n)).toLocaleString()}`;
}

function km(n) {
  return n == null || !Number.isFinite(Number(n)) ? '—' : `${Number(n).toLocaleString()} km`;
}

function pctLabel(n) {
  return n == null || !Number.isFinite(Number(n)) ? '—' : `${Number(n).toFixed(1)}%`;
}

function dateLabel(s) {
  if (!s) return '—';
  const d = new Date(String(s).includes('T') ? s : `${String(s).replace(' ', 'T')}Z`);
  return Number.isNaN(d.getTime()) ? s : d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

/** Spreadsheet-friendly export of the table (one row per visit). */
function exportCsv(data) {
  const { vehicle, rows, show_profit: showProfit } = data;
  const head = [
    'Date in', 'Date out', 'Job', 'Status', 'Odometer in', 'Odometer out', 'Km since previous visit',
    'Work done', 'Parts', 'Parts count', 'Parts (KES ex VAT)', 'Labour (KES ex VAT)', 'Labour hours',
    'Main mechanic', 'Invoice', 'Invoice total (KES inc VAT)', 'Paid', 'Balance',
    ...(showProfit ? ['Total cost', 'Profit', 'Margin %'] : []),
  ];
  const cell = (v) => {
    const s = v == null ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [head.map(cell).join(',')];
  for (const r of [...rows].reverse()) {
    lines.push(
      [
        dateLabel(r.date_in), r.date_out ? dateLabel(r.date_out) : '', r.job_number, STATUS_LABEL[r.status] || r.status,
        r.odometer_in ?? '', r.odometer_out ?? '', r.km_since_previous ?? '',
        [r.description, ...(r.tasks || [])].filter(Boolean).join('; '),
        r.parts.map((p) => `${p.description} x${p.quantity}`).join('; '), r.parts_count,
        r.parts_revenue, r.labour_revenue, r.labour_hours,
        r.main_mechanic || '', r.invoice_number || '', r.invoice_total ?? '', r.paid, r.balance ?? '',
        ...(showProfit ? [r.total_cost, r.profit, r.profit_margin_pct != null ? r.profit_margin_pct.toFixed(1) : ''] : []),
      ]
        .map(cell)
        .join(','),
    );
  }
  const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${(vehicle.registration || 'vehicle').replace(/\s+/g, '')}-service-history.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
}

function Stat({ label, value, sub }) {
  return (
    <div className="vh-stat">
      <div className="vh-stat-label">{label}</div>
      <div className="vh-stat-value">{value}</div>
      {sub ? <div className="vh-stat-sub">{sub}</div> : null}
    </div>
  );
}

export default function VehicleHistory() {
  const { id } = useParams();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [open, setOpen] = useState(() => new Set());

  useEffect(() => {
    setData(null);
    setError('');
    api.vehicles
      .serviceHistory(id)
      .then(setData)
      .catch((err) => setError(err.message || 'Could not load service history'));
  }, [id]);

  if (error) return <div className="page-title">{error}</div>;
  if (!data) return <div className="page-title">Loading…</div>;

  const { vehicle, summary: s, rows, show_profit: showProfit } = data;
  const toggle = (jobId) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(jobId)) next.delete(jobId);
      else next.add(jobId);
      return next;
    });
  const colCount = showProfit ? 9 : 8;
  const nextService = s.next_service
    ? [s.next_service.km != null ? km(s.next_service.km) : null, s.next_service.date ? dateLabel(s.next_service.date) : null]
        .filter(Boolean)
        .join(' or ')
    : null;

  return (
    <>
      <div style={{ marginBottom: '0.75rem' }}>
        <Link to="/vehicles">← Vehicles</Link>
      </div>
      <div className="vh-head">
        <div>
          <h1 className="page-title" style={{ marginBottom: '0.15rem' }}>
            {vehicle.registration || 'Vehicle'} · service history
          </h1>
          <div style={{ color: 'var(--text-muted)' }}>
            {[vehicle.make, vehicle.model, vehicle.year].filter(Boolean).join(' ') || '—'}
            {vehicle.vin ? ` · VIN ${vehicle.vin}` : ''}
            {vehicle.customer_name ? ` · ${vehicle.customer_name}` : ''}
            {vehicle.customer_phone ? ` · ${vehicle.customer_phone}` : ''}
          </div>
        </div>
        <button type="button" className="btn" onClick={() => exportCsv(data)} disabled={!rows.length}>
          Export CSV
        </button>
      </div>

      <div className="vh-stats">
        <Stat label="Visits" value={s.visits} sub={s.first_visit ? `since ${dateLabel(s.first_visit)}` : null} />
        <Stat label="Total spent" value={kes(s.total_spent)} sub={s.avg_spend_per_visit != null ? `avg ${kes(s.avg_spend_per_visit)} / visit` : 'inc VAT'} />
        {showProfit && (
          <Stat label="Profit" value={kes(s.profit)} sub={`${pctLabel(s.profit_margin_pct)} margin · cost ${kes(s.total_cost)}`} />
        )}
        <Stat label="Parts / labour" value={kes(s.parts_spend)} sub={`labour ${kes(s.labour_spend)} · ${s.labour_hours || 0} h`} />
        <Stat
          label="Outstanding"
          value={kes(s.outstanding)}
          sub={`paid ${kes(s.paid)}`}
        />
        <Stat
          label="Mileage"
          value={km(s.latest_odometer)}
          sub={s.avg_km_between_visits != null ? `avg ${km(s.avg_km_between_visits)} between visits` : 'latest reading'}
        />
        <Stat label="Main mechanic" value={s.main_mechanic?.name || '—'} sub={s.main_mechanic ? `${s.main_mechanic.hours} h logged` : null} />
        <Stat label="Next service" value={nextService || 'Not set'} sub={s.last_visit ? `last visit ${dateLabel(s.last_visit)}` : null} />
      </div>

      {s.top_parts?.length > 0 && (
        <div className="vh-top-parts">
          <span className="vh-stat-label">Most replaced</span>
          {s.top_parts.map((p) => (
            <span key={p.description} className="vh-chip">
              {p.description}
              {p.times > 1 ? ` ×${p.times}` : ''}
            </span>
          ))}
        </div>
      )}

      <div className="card" style={{ padding: 0 }}>
        <div className="table-wrap">
          <table className="vh-table">
            <thead>
              <tr>
                <th>Visit</th>
                <th style={{ textAlign: 'right' }}>Odometer</th>
                <th>Work done</th>
                <th style={{ textAlign: 'right' }}>Parts</th>
                <th style={{ textAlign: 'right' }}>Labour</th>
                <th>Main mechanic</th>
                <th style={{ textAlign: 'right' }}>Spent (inc VAT)</th>
                {showProfit && <th style={{ textAlign: 'right' }}>Profit</th>}
                <th aria-label="Details" />
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr>
                  <td colSpan={colCount} className="empty">No visits recorded for this vehicle yet.</td>
                </tr>
              )}
              {rows.map((r) => {
                const isOpen = open.has(r.job_id);
                const work = [r.description, ...(r.tasks || [])].filter(Boolean);
                return (
                  <Fragment key={r.job_id}>
                    <tr className={isOpen ? 'vh-open' : undefined}>
                      <td style={{ whiteSpace: 'nowrap' }}>
                        <Link to={`/jobs/${r.job_id}`}><strong>{r.job_number}</strong></Link>
                        <span className="vh-sub"> · {dateLabel(r.date_in)}</span>
                        <div className="vh-sub">
                          {STATUS_LABEL[r.status] || r.status}
                          {r.date_out ? ` · out ${dateLabel(r.date_out)}` : ''}
                          {r.repeat_visits ? ` · +${r.repeat_visits} repeat` : ''}
                        </div>
                      </td>
                      <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                        {km(r.odometer_in)}
                        {r.km_since_previous != null && <div className="vh-sub">+{Number(r.km_since_previous).toLocaleString()} since last</div>}
                      </td>
                      <td className="vh-work">
                        {work[0] || '—'}
                        {work.length > 1 && <div className="vh-sub">{work.slice(1).join(' · ')}</div>}
                      </td>
                      <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                        {kes(r.parts_revenue)}
                        <div className="vh-sub">{r.parts_count} {r.parts_count === 1 ? 'item' : 'items'}</div>
                      </td>
                      <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                        {kes(r.labour_revenue)}
                        <div className="vh-sub">{r.labour_hours || 0} h</div>
                      </td>
                      <td>{r.main_mechanic || '—'}</td>
                      <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                        <strong>{kes(r.invoice_total)}</strong>
                        {r.invoice_total != null && (
                          <div className={r.balance > 0 ? 'vh-due' : 'vh-paid'}>
                            {r.balance > 0 ? `${kes(r.balance)} due` : 'Paid'}
                          </div>
                        )}
                      </td>
                      {showProfit && (
                        <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                          {r.invoice_total == null ? '—' : kes(r.profit)}
                          {r.invoice_total != null && <div className="vh-sub">{pctLabel(r.profit_margin_pct)}</div>}
                        </td>
                      )}
                      <td style={{ whiteSpace: 'nowrap' }}>
                        {r.invoice_id && (
                          <button
                            type="button"
                            className="btn vh-more"
                            onClick={() => api.invoices.downloadPDF(r.invoice_id)}
                            title={`Download invoice ${r.invoice_number || ''} PDF${r.status === 'vehicle_released' || r.status === 'completed' ? '' : ' (provisional)'}`}
                            aria-label={`Download invoice PDF for ${r.job_number}`}
                            style={{ marginRight: '0.3rem' }}
                          >
                            ⤓
                          </button>
                        )}
                        <button
                          type="button"
                          className="btn vh-more"
                          onClick={() => toggle(r.job_id)}
                          aria-expanded={isOpen}
                          aria-label={isOpen ? 'Hide details' : 'Show details'}
                          title={isOpen ? 'Hide details' : 'Parts, mechanics and more'}
                        >
                          {isOpen ? '▴' : '▾'}
                        </button>
                      </td>
                    </tr>
                    {isOpen && (
                      <tr className="vh-detail">
                        <td colSpan={colCount}>
                          <div className="vh-detail-grid">
                            <div>
                              <div className="vh-stat-label">Parts & items</div>
                              {r.parts.length === 0 ? (
                                <div className="vh-sub">None on the invoice.</div>
                              ) : (
                                <table className="vh-parts">
                                  <tbody>
                                    {r.parts.map((p, i) => (
                                      <tr key={i}>
                                        <td>{p.description}</td>
                                        <td style={{ textAlign: 'right' }}>×{p.quantity}</td>
                                        <td style={{ textAlign: 'right' }}>{kes(p.amount)}</td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              )}
                            </div>
                            <div>
                              <div className="vh-stat-label">Mechanics</div>
                              {r.mechanics.length === 0 ? (
                                <div className="vh-sub">No time logged.</div>
                              ) : (
                                r.mechanics.map((m) => (
                                  <div key={m.name}>
                                    {m.name} <span className="vh-sub">· {m.hours} h</span>
                                  </div>
                                ))
                              )}
                              <div className="vh-stat-label" style={{ marginTop: '0.6rem' }}>Documents</div>
                              <div className="vh-doc-btns">
                                {r.invoice_id ? (
                                  <button type="button" className="btn" onClick={() => api.invoices.downloadPDF(r.invoice_id)}>
                                    ⤓ Invoice PDF{r.status === 'vehicle_released' || r.status === 'completed' ? '' : ' (provisional)'}
                                  </button>
                                ) : (
                                  <span className="vh-sub">No invoice yet.</span>
                                )}
                                <button
                                  type="button"
                                  className="btn"
                                  disabled={r.status !== 'completed'}
                                  onClick={() => api.jobs.downloadJobSummaryPdf(r.job_id).catch((e) => alert(e.message))}
                                  title={
                                    r.status === 'completed'
                                      ? 'Internal summary with costs and margins: for the office, not for customers'
                                      : 'Available once the job is marked complete'
                                  }
                                >
                                  ⤓ Job summary PDF (internal)
                                </button>
                                {r.status !== 'completed' && <span className="vh-sub">Job summary: available once the job is complete</span>}
                              </div>
                              <div className="vh-stat-label" style={{ marginTop: '0.6rem' }}>Visit</div>
                              <div className="vh-sub">
                                {r.invoice_number ? `Invoice ${r.invoice_number} · ` : ''}
                                {r.quote_total != null ? `Quoted ${kes(r.quote_total)} · ` : ''}
                                Paid {kes(r.paid)}
                                {r.vehicle_tested ? ' · Vehicle tested ✓' : ''}
                                {r.customer_rating ? ` · Rated ${'★'.repeat(r.customer_rating)}` : ''}
                                {r.odometer_out != null ? ` · Out at ${km(r.odometer_out)}` : ''}
                              </div>
                            </div>
                            {showProfit && r.invoice_total != null && (
                              <div>
                                <div className="vh-stat-label">Profit breakdown (ex VAT)</div>
                                <div>Revenue {kes(r.revenue_ex_vat)}</div>
                                <div className="vh-sub">Parts cost {kes(r.parts_cost)} · Labour cost {kes(r.labour_cost)}</div>
                                {r.repeat_visit_cost > 0 && <div className="vh-sub">Repeat visit costs {kes(r.repeat_visit_cost)}</div>}
                                <div>
                                  Profit <strong>{kes(r.profit)}</strong> ({pctLabel(r.profit_margin_pct)})
                                </div>
                              </div>
                            )}
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
            {rows.length > 1 && (
              <tfoot>
                <tr>
                  <td colSpan={3}><strong>Totals · {s.visits} visits</strong></td>
                  <td style={{ textAlign: 'right' }}><strong>{kes(s.parts_spend)}</strong></td>
                  <td style={{ textAlign: 'right' }}><strong>{kes(s.labour_spend)}</strong></td>
                  <td />
                  <td style={{ textAlign: 'right' }}>
                    <strong>{kes(s.total_spent)}</strong>
                    <div className={s.outstanding > 0 ? 'vh-due' : 'vh-paid'}>
                      {s.outstanding > 0 ? `${kes(s.outstanding)} due` : 'Paid'}
                    </div>
                  </td>
                  {showProfit && (
                    <td style={{ textAlign: 'right' }}>
                      <strong>{kes(s.profit)}</strong>
                      <div className="vh-sub">{pctLabel(s.profit_margin_pct)}</div>
                    </td>
                  )}
                  <td />
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>
      {!showProfit && (
        <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>
          Profit and margins are only shown to team members who can view statistics reports.
        </p>
      )}
    </>
  );
}
