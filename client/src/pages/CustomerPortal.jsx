import { useEffect, useState } from 'react';
import { Routes, Route, useParams, Link } from 'react-router-dom';
import { api } from '../api';
import { testDriveComputedRows, handoverComputed, formatKmDelta } from '../utils/jobMileageFuel';

const JOB_STATUS_LABEL = {
  pending: 'In progress',
  in_progress: 'In progress',
  vehicle_released: 'Vehicle released',
  completed: 'Complete',
  cancelled: 'Cancelled',
};

function jobStatusLabel(status) {
  if (!status) return '—';
  return JOB_STATUS_LABEL[status] || status.replace(/_/g, ' ');
}

function formatPortalDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString(undefined, { dateStyle: 'medium' });
}

function isQuoteLineApproved(line) {
  return Number(line?.approved) === 1;
}

function kes(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return 'KES 0';
  return `KES ${v.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}

function isTaskCompleted(t) {
  return Number(t?.completed) === 1;
}

export default function CustomerPortal() {
  return (
    <Routes>
      <Route index element={<PortalJobsList />} />
      <Route path="job/:jobId" element={<PortalJobDetail />} />
    </Routes>
  );
}

function PortalJobsList() {
  const { token } = useParams();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [jobSearch, setJobSearch] = useState('');

  useEffect(() => {
    if (!token) return;
    setLoading(true);
    setError('');
    api.customerPortal
      .get(token)
      .then(setData)
      .catch((err) => setError(err.message || 'Failed to load'))
      .finally(() => setLoading(false));
  }, [token]);

  if (loading) return <div className="page-title">Loading…</div>;
  if (error || !data) return <div className="page-title">Link not found or expired.</div>;

  const { customer, jobs } = data;
  const q = jobSearch.trim().toLowerCase();
  const filteredJobs = !q
    ? jobs
    : jobs.filter((job) => {
        const hay = [
          job.job_number,
          job.vehicle?.registration,
          job.vehicle?.make,
          job.vehicle?.model,
          jobStatusLabel(job.status),
          formatPortalDate(job.created_at),
          formatPortalDate(job.completed_at),
          job.quote?.total != null ? String(job.quote.total) : '',
          job.quote?.invoice_number,
          job.invoice?.total != null ? String(job.invoice.total) : '',
          job.invoice?.invoice_number,
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();
        return hay.includes(q);
      });

  return (
    <div className="customer-portal">
      <h1 className="page-title" style={{ marginBottom: '0.5rem' }}>{customer.name}</h1>
      <p style={{ marginTop: 0, color: 'var(--text-muted)' }}>
        {customer.email || '—'} {customer.phone ? ` · ${customer.phone}` : ''}
      </p>

      <section className="card">
        <h3 style={{ marginTop: 0 }}>Your jobs</h3>
        {jobs.length === 0 && <p className="empty">No jobs yet.</p>}
        {jobs.length > 0 && (
          <>
            <div className="form-group" style={{ marginBottom: '1rem' }}>
              <label htmlFor="portal-job-search">Search jobs</label>
              <input
                id="portal-job-search"
                type="search"
                placeholder="Job number, registration, vehicle, status, dates…"
                value={jobSearch}
                onChange={(e) => setJobSearch(e.target.value)}
                style={{ width: '100%', maxWidth: '28rem' }}
              />
            </div>
            {filteredJobs.length === 0 && <p className="empty">No jobs match your search.</p>}
            {filteredJobs.length > 0 && (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Job</th>
                      <th>Registration</th>
                      <th>Date in</th>
                      <th>Date out</th>
                      <th>Status</th>
                      <th>Quoted</th>
                      <th>Invoiced</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {filteredJobs.map((job) => (
                      <tr key={job.id}>
                        <td><strong>{job.job_number}</strong></td>
                        <td>{job.vehicle?.registration || '—'}</td>
                        <td>{formatPortalDate(job.created_at)}</td>
                        <td>{formatPortalDate(job.completed_at)}</td>
                        <td>{jobStatusLabel(job.status)}</td>
                        <td>
                          {job.quote ? (
                            <span title={job.quote.invoice_number ? `Quote ${job.quote.invoice_number}` : undefined}>
                              {kes(job.quote.total)}
                            </span>
                          ) : (
                            <span style={{ color: 'var(--text-muted)' }}>—</span>
                          )}
                        </td>
                        <td>
                          {job.invoice ? (
                            <span title={job.invoice.invoice_number ? `Invoice ${job.invoice.invoice_number}` : undefined}>
                              {kes(job.invoice.total)}
                            </span>
                          ) : (
                            <span style={{ color: 'var(--text-muted)' }}>—</span>
                          )}
                        </td>
                        <td style={{ whiteSpace: 'nowrap' }}>
                          <Link className="btn primary" style={{ padding: '0.35rem 0.75rem', fontSize: '0.85rem' }} to={`job/${job.id}`}>
                            View
                          </Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </section>
    </div>
  );
}

function PortalJobDetail() {
  const { token, jobId } = useParams();
  const [payload, setPayload] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const reload = () => {
    if (!token || !jobId) return Promise.resolve();
    return api.customerPortal.getJob(token, jobId).then(setPayload);
  };

  useEffect(() => {
    if (!token || !jobId) return;
    setLoading(true);
    setError('');
    reload()
      .catch((err) => setError(err.message || 'Failed to load'))
      .finally(() => setLoading(false));
  }, [token, jobId]);

  const toggleApprove = async (quoteId, itemId, approved) => {
    if (!token) return;
    try {
      setSaving(true);
      await api.customerPortal.approveItem(token, quoteId, itemId, approved);
      await reload();
    } catch (err) {
      alert(err.message);
    } finally {
      setSaving(false);
    }
  };

  const approveAllQuote = async (quoteId) => {
    if (!token) return;
    try {
      setSaving(true);
      await api.customerPortal.approveAllQuote(token, quoteId);
      await reload();
    } catch (err) {
      alert(err.message);
    } finally {
      setSaving(false);
    }
  };

  const submitRating = async (id, rating, feedback) => {
    if (!token) return;
    try {
      setSaving(true);
      await api.customerPortal.submitRating(token, id, rating, feedback);
      await reload();
    } catch (err) {
      alert(err.message);
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div className="page-title">Loading…</div>;
  if (error || !payload) return <div className="page-title">Job not found.</div>;

  const { customer, job, quote_approval_allowed: allowQuoteApproval } = payload;
  const isPast = job.status === 'completed' || job.status === 'cancelled';

  return (
    <div className="customer-portal">
      <p style={{ marginBottom: '0.75rem' }}>
        <Link to={`/portal/${encodeURIComponent(token)}`} className="btn" style={{ padding: '0.35rem 0.75rem', fontSize: '0.85rem' }}>
          ← All jobs
        </Link>
      </p>
      <h1 className="page-title" style={{ marginBottom: '0.25rem' }}>{job.job_number}</h1>
      <p style={{ marginTop: 0, color: 'var(--text-muted)' }}>
        {customer.name}
        {' · '}
        {[job.vehicle?.registration, job.vehicle?.make, job.vehicle?.model].filter(Boolean).join(' ') || '—'}
      </p>
      <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>
        {jobStatusLabel(job.status)}
        {' · '}
        In {formatPortalDate(job.created_at)}
        {job.completed_at ? ` · Out ${formatPortalDate(job.completed_at)}` : ''}
        {job.invoice ? (
          <>
            {' · '}
            Invoiced {kes(job.invoice.total)}
            {job.invoice.invoice_number ? ` (${job.invoice.invoice_number})` : ''}
          </>
        ) : null}
      </p>

      {saving && <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>Saving…</p>}

      <section className="card" style={{ marginTop: '1rem' }}>
        <h3 style={{ marginTop: 0 }}>Tasks</h3>
        {(!job.tasks || job.tasks.length === 0) && <p className="empty">No tasks listed.</p>}
        {job.tasks?.length > 0 && (
          <ul style={{ margin: 0, paddingLeft: '1.25rem' }}>
            {job.tasks.map((t) => {
              const done = isTaskCompleted(t);
              return (
                <li key={t.id} style={{ marginBottom: '0.35rem' }}>
                  {done ? (
                    <span style={{ textDecoration: 'line-through', color: 'var(--text-muted)' }}>{t.description}</span>
                  ) : (
                    t.description
                  )}
                  {done ? (
                    <span style={{ marginLeft: '0.5rem', fontSize: '0.8rem', color: 'var(--success)' }}>Done</span>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {job.quote && (
        <QuoteSection
          quote={job.quote}
          allowApprove={allowQuoteApproval}
          onToggleApprove={toggleApprove}
          onApproveAllQuote={approveAllQuote}
        />
      )}

      <section className="card" style={{ marginTop: '1rem' }}>
        <h3 style={{ marginTop: 0 }}>Invoice</h3>
        {!job.invoice && <p className="empty">No invoice yet.</p>}
        {job.invoice && (
          <>
            <p style={{ margin: '0 0 0.75rem' }}>
              <strong>{job.invoice.invoice_number}</strong>
              {job.invoice.status && (
                <span style={{ marginLeft: '0.5rem', color: 'var(--text-muted)', fontSize: '0.9rem' }}>
                  ({job.invoice.status})
                </span>
              )}
            </p>
            <PortalLineItemsTable items={job.invoice.items} />
            <PortalDocumentTotals doc={job.invoice} />
            <div style={{ marginTop: '1.25rem' }}>
              <h4 style={{ margin: '0 0 0.5rem', fontSize: '1rem' }}>Payment history</h4>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Amount</th>
                      <th>Date</th>
                      <th>Note</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(!job.invoice.payments || job.invoice.payments.length === 0) && (
                      <tr>
                        <td colSpan={3} className="empty">No payments recorded yet.</td>
                      </tr>
                    )}
                    {job.invoice.payments?.map((p) => (
                      <tr key={p.id}>
                        <td><strong>{kes(p.amount)}</strong></td>
                        <td>{p.paid_at ? new Date(p.paid_at).toLocaleString() : '—'}</td>
                        <td style={{ color: 'var(--text-muted)' }}>{p.notes || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}
      </section>

      <PortalMileageReadOnly job={job} />

      {isPast && (
        <FeedbackSection job={job} onSubmitRating={submitRating} />
      )}
    </div>
  );
}

function PortalLineItemsTable({ items }) {
  const list = items || [];
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Item</th>
            <th style={{ textAlign: 'right' }}>Qty</th>
            <th style={{ textAlign: 'right' }}>Unit (ex VAT)</th>
            <th style={{ textAlign: 'right' }}>Line (ex VAT)</th>
          </tr>
        </thead>
        <tbody>
          {list.length === 0 && (
            <tr>
              <td colSpan={4} className="empty">No lines.</td>
            </tr>
          )}
          {list.map((item) => {
            const qty = Number(item.quantity) || 0;
            const price = Number(item.unit_price) || 0;
            return (
              <tr key={item.id}>
                <td>{item.description}</td>
                <td style={{ textAlign: 'right' }}>{qty}</td>
                <td style={{ textAlign: 'right' }}>{kes(price)}</td>
                <td style={{ textAlign: 'right' }}>{kes(qty * price)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function PortalDocumentTotals({ doc }) {
  if (!doc) return null;
  const subtotal = Number(doc.subtotal || 0);
  const tax = Number(doc.tax_amount || 0);
  const total = Number(doc.total || 0);
  const rate = Number(doc.tax_rate) || 0;
  const pct = (rate * 100).toFixed(0);
  const hasInvoicePaymentSummary = doc.balance != null && doc.balance !== undefined;
  const paid = Number(doc.amount_paid ?? 0);
  const balance = Number(doc.balance);

  return (
    <div style={{ marginTop: '1rem', textAlign: 'right', maxWidth: '320px', marginLeft: 'auto' }}>
      <p style={{ margin: '0.25rem 0' }}>
        Subtotal (ex VAT) <strong>{kes(subtotal)}</strong>
      </p>
      <p style={{ margin: '0.25rem 0', color: 'var(--text-muted)' }}>
        VAT ({pct}%) <strong>{kes(tax)}</strong>
      </p>
      <p style={{ margin: '0.5rem 0 0', fontSize: '1.1rem' }}>
        Total (inc VAT) <strong>{kes(total)}</strong>
      </p>
      {hasInvoicePaymentSummary && (
        <>
          <div
            style={{
              marginTop: '0.85rem',
              paddingTop: '0.85rem',
              borderTop: '1px solid var(--border)',
            }}
          />
          <p style={{ margin: '0.25rem 0' }}>
            <span style={{ color: 'var(--text-muted)' }}>Paid to date</span>{' '}
            <strong>{kes(paid)}</strong>
          </p>
          <p style={{ margin: '0.35rem 0 0', fontSize: '1.05rem' }}>
            <span style={{ color: 'var(--text-muted)' }}>Balance due</span>{' '}
            <strong>{kes(balance)}</strong>
          </p>
        </>
      )}
    </div>
  );
}

function QuoteSection({ quote, allowApprove, onToggleApprove, onApproveAllQuote }) {
  const quotePendingCount = quote?.items?.filter((i) => !isQuoteLineApproved(i)).length ?? 0;

  return (
    <section className="card" style={{ marginTop: '1rem' }}>
      <h3 style={{ marginTop: 0 }}>Quote</h3>
      <p style={{ margin: '0 0 0.75rem', color: 'var(--text-muted)', fontSize: '0.9rem' }}>
        <strong>{quote.invoice_number}</strong>
        {quote.status && (
          <span style={{ marginLeft: '0.35rem' }}>({quote.status})</span>
        )}
        {!allowApprove && quotePendingCount > 0 && (
          <span> · Some lines are not approved (approval is only available while the job is open).</span>
        )}
      </p>
      <div className="table-wrap">
        <table>
          <thead>
            {(quote.items?.length ?? 0) >= 2 && quotePendingCount > 0 && allowApprove && (
              <tr>
                <th
                  style={{
                    textAlign: 'center',
                    verticalAlign: 'bottom',
                    borderBottom: 'none',
                    paddingBottom: '0.35rem',
                  }}
                >
                  <button
                    type="button"
                    className="btn primary"
                    style={{ padding: '0.35rem 0.75rem', fontSize: '0.85rem' }}
                    onClick={() => {
                      if (!window.confirm('Are you sure you would like to approve all lines?')) return;
                      onApproveAllQuote(quote.id);
                    }}
                  >
                    Approve all
                  </button>
                </th>
                <th style={{ borderBottom: 'none', padding: 0 }} aria-hidden="true" />
                <th style={{ borderBottom: 'none', padding: 0 }} aria-hidden="true" />
                <th style={{ borderBottom: 'none', padding: 0 }} aria-hidden="true" />
                <th style={{ borderBottom: 'none', padding: 0 }} aria-hidden="true" />
              </tr>
            )}
            <tr>
              <th>Approval</th>
              <th>Item</th>
              <th style={{ textAlign: 'right' }}>Qty</th>
              <th style={{ textAlign: 'right' }}>Unit (ex VAT)</th>
              <th style={{ textAlign: 'right' }}>Line (ex VAT)</th>
            </tr>
          </thead>
          <tbody>
            {(!quote.items || quote.items.length === 0) && (
              <tr><td colSpan={5} className="empty">No quote lines.</td></tr>
            )}
            {quote.items?.map((item) => {
              const qty = Number(item.quantity) || 0;
              const price = Number(item.unit_price) || 0;
              return (
                <tr key={item.id}>
                  <td style={{ textAlign: 'center', whiteSpace: 'nowrap' }}>
                    {isQuoteLineApproved(item) ? (
                      <span style={{ color: 'var(--success)', fontSize: '0.9rem', fontWeight: 600 }}>Approved</span>
                    ) : allowApprove ? (
                      <button
                        type="button"
                        className="btn primary"
                        style={{ padding: '0.3rem 0.65rem', fontSize: '0.85rem' }}
                        onClick={() => {
                          if (!window.confirm('Are you sure you would like to approve?')) return;
                          onToggleApprove(quote.id, item.id, true);
                        }}
                      >
                        Approve
                      </button>
                    ) : (
                      <span style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>Pending</span>
                    )}
                  </td>
                  <td>{item.description}</td>
                  <td style={{ textAlign: 'right' }}>{qty}</td>
                  <td style={{ textAlign: 'right' }}>{kes(price)}</td>
                  <td style={{ textAlign: 'right' }}>{kes(qty * price)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <PortalDocumentTotals doc={quote} />
    </section>
  );
}

function PortalMileageReadOnly({ job }) {
  const testDrivesList = job.test_drives || [];
  const tdComputed = testDriveComputedRows(testDrivesList, job.odometer_in, job.fuel_in);
  const ho = handoverComputed(
    testDrivesList,
    job.odometer_in,
    job.fuel_in,
    job.odometer_out,
    job.fuel_out,
  );
  const rowStyle = {
    display: 'flex',
    flexWrap: 'wrap',
    gap: '0.35rem 0.75rem',
    alignItems: 'baseline',
    marginBottom: '0.35rem',
  };

  return (
    <section className="card" style={{ marginTop: '1rem' }}>
      <h3 style={{ marginTop: 0 }}>Mileage & fuel</h3>
      <div style={{ marginBottom: '0.75rem' }}>
        <div style={rowStyle}>
          <strong>Mileage in</strong>
          <span>{job.odometer_in != null ? `${Number(job.odometer_in).toLocaleString()} km` : '—'}</span>
          <strong>Fuel in</strong>
          <span>{job.fuel_in || '—'}</span>
        </div>
        {tdComputed.map((row) => (
          <div key={row.id} style={rowStyle}>
            <strong>Test drive {row.index + 1}:</strong>
            Mileage covered {formatKmDelta(row.covered)}, Fuel used {row.used}
          </div>
        ))}
        <div style={rowStyle}>
          <strong>Mileage out</strong>
          <span>{job.odometer_out != null ? `${Number(job.odometer_out).toLocaleString()} km` : '—'}</span>
          <span>
            Mileage covered {formatKmDelta(ho.mileageCovered)}
          </span>
          <strong>Fuel out</strong>
          <span>{job.fuel_out || '—'}</span>
          <span>, Fuel used {ho.fuelUsed}</span>
        </div>
      </div>
    </section>
  );
}

function FeedbackSection({ job, onSubmitRating }) {
  const { rating, feedback } = job;
  const [localRating, setLocalRating] = useState(rating || 0);
  const [localFeedback, setLocalFeedback] = useState(feedback || '');

  return (
    <section className="card" style={{ marginTop: '1rem' }}>
      <h3 style={{ marginTop: 0 }}>Your feedback</h3>
      {rating ? (
        <>
          <p style={{ margin: '0.25rem 0' }}>Rating: {'★'.repeat(rating)}{'☆'.repeat(5 - rating)}</p>
          {feedback && <p style={{ margin: 0 }}>{feedback}</p>}
        </>
      ) : (
        <>
          <div style={{ marginBottom: '0.5rem' }}>
            {[1, 2, 3, 4, 5].map((r) => (
              <label key={r} style={{ marginRight: '0.5rem', cursor: 'pointer' }}>
                <input
                  type="radio"
                  name={`rating-${job.id}`}
                  value={r}
                  checked={localRating === r}
                  onChange={() => setLocalRating(r)}
                />{' '}
                {r}
              </label>
            ))}
          </div>
          <textarea
            rows={2}
            style={{ width: '100%', marginBottom: '0.5rem' }}
            placeholder="How was the service?"
            value={localFeedback}
            onChange={(e) => setLocalFeedback(e.target.value)}
          />
          <button
            type="button"
            className="btn primary"
            onClick={() => onSubmitRating(job.id, localRating, localFeedback)}
            disabled={!localRating}
          >
            Submit feedback
          </button>
        </>
      )}
    </section>
  );
}
