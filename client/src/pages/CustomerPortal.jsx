import { Fragment, useEffect, useState } from 'react';
import { Routes, Route, useParams, Link } from 'react-router-dom';
import { api } from '../api';
import { testDriveComputedRows, handoverComputed, formatKmDelta } from '../utils/jobMileageFuel';
import { enrichItemsWithSectionTotals, isHeaderLine } from '../utils/invoiceLineSections';
import { partCanBeFitted, partFlagOn, visiblePartRows } from '../utils/portalJobProgress';
import { invoiceLineNet } from '../utils/invoiceLineVat';
import InvoiceTotalsSummary from '../components/InvoiceTotalsSummary';
import { InvoiceLineSubtextView } from '../components/InvoiceLineSubtext';
import { InvoiceLineDiscountView } from '../components/InvoiceLineDiscount';
import { LineProgressToggle, LineProgressSteps, JobProgressBar } from '../components/LineProgress';
import { isTrackableLine } from '../utils/lineProgress';

/** A card that opens and closes; the summary line stays visible when it is closed. */
function Collapsible({ title, meta, defaultOpen = false, children }) {
  return (
    <details className="card cf-collapse" open={defaultOpen || undefined}>
      <summary>
        <span className="cf-collapse-title">{title}</span>
        {meta ? <span className="cf-collapse-meta">{meta}</span> : null}
        <span className="cf-collapse-chevron" aria-hidden="true">▾</span>
      </summary>
      <div className="cf-collapse-body">{children}</div>
    </details>
  );
}

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
      <Route path="document/:invoiceId" element={<PortalStandaloneDocument />} />
      <Route path="job/:jobId" element={<PortalJobDetail />} />
    </Routes>
  );
}

function PortalJobsList() {
  const { token } = useParams();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [portalSearch, setPortalSearch] = useState('');

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

  const { customer, jobs, standalone_documents: standaloneDocs = [] } = data;
  const q = portalSearch.trim().toLowerCase();
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

  const filteredStandalone = !q
    ? standaloneDocs
    : standaloneDocs.filter((d) => {
        const hay = [
          d.invoice_number,
          d.type,
          d.status,
          formatPortalDate(d.created_at),
          d.total != null ? String(d.total) : '',
          d.registration,
          d.make,
          d.model,
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();
        return hay.includes(q);
      });

  return (
    <div className="customer-portal cf-compact">
      <div className="cf-eyebrow">Customer portal · Karen, Nairobi</div>
      <h1 className="page-title">{customer.name}</h1>
      <p className="cf-meta-line">
        {[customer.email, customer.phone].filter(Boolean).join(' · ') || '—'}
      </p>

      {(jobs.length > 0 || standaloneDocs.length > 0) && (
        <div className="cf-search">
          <label htmlFor="portal-job-search" className="cf-visually-hidden">Search jobs & documents</label>
          <input
            id="portal-job-search"
            type="search"
            placeholder="Search job number, registration, quote #, invoice #, status…"
            value={portalSearch}
            onChange={(e) => setPortalSearch(e.target.value)}
          />
        </div>
      )}

      {standaloneDocs.length > 0 && (
      <section className="card">
        <div className="cf-card-head">
          <h3>Quotes & invoices</h3>
          <span className="cf-card-head-meta">Not linked to a job yet</span>
        </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Document</th>
                  <th>Type</th>
                  <th>Vehicle</th>
                  <th>Total</th>
                  <th>Date</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {filteredStandalone.length === 0 && (
                  <tr>
                    <td colSpan={6} className="empty">No documents match your search.</td>
                  </tr>
                )}
                {filteredStandalone.map((d) => {
                  const isQuoteRow = String(d.type || '').toLowerCase() === 'quote';
                  return (
                  <tr key={d.id}>
                    <td>
                      <strong>{d.invoice_number || `#${d.id}`}</strong>
                      {isQuoteRow && (
                        <div style={{ fontSize: '0.82rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>
                          Open <strong>View</strong> to see line items and approve each line (or approve all).
                        </div>
                      )}
                    </td>
                    <td style={{ textTransform: 'capitalize' }}>{isQuoteRow ? 'Quote' : d.type || '—'}</td>
                    <td>{[d.registration, d.make, d.model].filter(Boolean).join(' ') || '—'}</td>
                    <td>{d.total != null ? kes(d.total) : '—'}</td>
                    <td>{formatPortalDate(d.created_at)}</td>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      <Link
                        className="btn primary"
                        style={{ padding: '0.35rem 0.75rem', fontSize: '0.85rem' }}
                        to={`/portal/${encodeURIComponent(token)}/document/${d.id}`}
                      >
                        {isQuoteRow ? 'View quote' : 'View'}
                      </Link>
                    </td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
      </section>
      )}

      <section className="card">
        <div className="cf-card-head">
          <h3>Your jobs</h3>
          {jobs.length > 0 && (
            <span className="cf-card-head-meta">
              {jobs.length} {jobs.length === 1 ? 'job' : 'jobs'}
            </span>
          )}
        </div>
        {jobs.length === 0 && <p className="empty cf-empty-sm">No jobs yet.</p>}
        {jobs.length > 0 && (
          <>
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
                          <Link className="btn primary cf-btn-sm" to={`job/${job.id}`}>
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

function PortalStandaloneDocument() {
  const { token, invoiceId } = useParams();
  const [payload, setPayload] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const reload = () => {
    if (!token || !invoiceId) return Promise.resolve();
    return api.customerPortal.getDocument(token, invoiceId).then(setPayload);
  };

  useEffect(() => {
    if (!token || !invoiceId) return;
    setLoading(true);
    setError('');
    reload()
      .catch((err) => setError(err.message || 'Failed to load'))
      .finally(() => setLoading(false));
  }, [token, invoiceId]);

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

  if (loading) return <div className="page-title">Loading…</div>;
  if (error || !payload) return <div className="page-title">Document not found.</div>;

  const { customer, quote, invoice, quote_approval_allowed: allowQuoteApproval, vehicle, document_type: docType } =
    payload;

  return (
    <div className="customer-portal cf-compact">
      <Link to={`/portal/${encodeURIComponent(token)}`} className="cf-back">
        ← Home
      </Link>
      <div className="cf-eyebrow">Your document</div>
      <h1 className="page-title" style={{ marginBottom: '0.25rem' }}>
        {String(docType || '').toLowerCase() === 'quote' ? (
          <>
            Quote <span style={{ color: 'var(--text)' }}>{quote?.invoice_number || '—'}</span>
          </>
        ) : (
          <>
            Invoice <span style={{ color: 'var(--text)' }}>{invoice?.invoice_number || '—'}</span>
          </>
        )}
      </h1>
      <p style={{ marginTop: 0, color: 'var(--text-muted)' }}>
        {customer.name}
        {' · '}
        {[vehicle?.registration, vehicle?.make, vehicle?.model].filter(Boolean).join(' ') || 'No vehicle on document'}
      </p>

      {saving && <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>Saving…</p>}

      {quote && (
        <QuoteSection
          quote={quote}
          allowApprove={allowQuoteApproval}
          onToggleApprove={toggleApprove}
          onApproveAllQuote={approveAllQuote}
        />
      )}

      {invoice && (
        <section className="card" style={{ marginTop: '1rem' }}>
          <h3 style={{ marginTop: 0 }}>Invoice</h3>
          <p style={{ margin: '0 0 0.75rem' }}>
            <strong>{invoice.invoice_number}</strong>
            {invoice.status && (
              <span style={{ marginLeft: '0.5rem', color: 'var(--text-muted)', fontSize: '0.9rem' }}>
                ({invoice.status})
              </span>
            )}
          </p>
          <PortalLineItemsTable items={invoice.items} />
          <PortalDocumentTotals doc={invoice} />
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
                  {(!invoice.payments || invoice.payments.length === 0) && (
                    <tr>
                      <td colSpan={3} className="empty">No payments recorded yet.</td>
                    </tr>
                  )}
                  {invoice.payments?.map((p) => (
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
        </section>
      )}
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
  const tasks = job.tasks || [];
  const tasksDone = tasks.filter(isTaskCompleted).length;
  const vehicle = [job.vehicle?.registration, job.vehicle?.make, job.vehicle?.model].filter(Boolean).join(' ') || '—';

  return (
    <div className="customer-portal cf-compact">
      <Link to={`/portal/${encodeURIComponent(token)}`} className="cf-back">
        ← All jobs
      </Link>
      <div className="cf-eyebrow">Workshop job · {jobStatusLabel(job.status)}</div>
      <h1 className="page-title">{job.job_number}</h1>
      <p className="cf-meta-line">
        {customer.name} · {vehicle} · In {formatPortalDate(job.created_at)}
        {job.completed_at ? ` · Out ${formatPortalDate(job.completed_at)}` : ''}
      </p>

      {saving && <p className="cf-saving">Saving…</p>}

      <JobProgressBar items={job.invoice?.items} tasks={tasks} />

      {job.quote && (
        <QuoteSection
          quote={job.quote}
          allowApprove={allowQuoteApproval}
          onToggleApprove={toggleApprove}
          onApproveAllQuote={approveAllQuote}
        />
      )}

      <section className="card">
        <div className="cf-card-head">
          <h3>Invoice</h3>
          {job.invoice && (
            <span className="cf-card-head-meta">
              <strong>{job.invoice.invoice_number}</strong>
              {job.invoice.status ? ` · ${job.invoice.status}` : ''}
            </span>
          )}
        </div>
        {!job.invoice && (
          <p className="empty cf-empty-sm">No invoice yet. Items you approve on the quote will appear here.</p>
        )}
        {job.invoice && (
          <>
            <PortalLineItemsTable items={job.invoice.items} showPartProgress />
            <PortalDocumentTotals doc={job.invoice} />
          </>
        )}
      </section>

      {job.invoice && (
        <Collapsible
          title="Payments"
          meta={`Paid ${kes(job.invoice.amount_paid)} · Balance ${kes(job.invoice.balance)}`}
        >
          <PaymentHistoryTable payments={job.invoice.payments} />
        </Collapsible>
      )}

      {tasks.length > 0 && (
        <Collapsible title="Tasks" meta={`${tasksDone} of ${tasks.length} done`}>
          <ul className="cf-task-list">
            {tasks.map((t) => {
              const done = isTaskCompleted(t);
              return (
                <li key={t.id} className={done ? 'done' : undefined}>
                  <span className="cf-task-tick" aria-hidden="true">{done ? '✓' : ''}</span>
                  <span>{t.description}</span>
                </li>
              );
            })}
          </ul>
        </Collapsible>
      )}

      <PortalMileageReadOnly job={job} />

      {isPast && (
        <FeedbackSection job={job} onSubmitRating={submitRating} />
      )}
    </div>
  );
}

function PaymentHistoryTable({ payments }) {
  return (
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
          {(!payments || payments.length === 0) && (
            <tr>
              <td colSpan={3} className="empty cf-empty-sm">No payments recorded yet.</td>
            </tr>
          )}
          {payments?.map((p) => (
            <tr key={p.id}>
              <td><strong>{kes(p.amount)}</strong></td>
              <td>{p.paid_at ? new Date(p.paid_at).toLocaleString() : '—'}</td>
              <td style={{ color: 'var(--text-muted)' }}>{p.notes || '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function PortalTick({ on }) {
  if (!on) return null;
  return (
    <span className="portal-tick" aria-label="Done">
      ✓
    </span>
  );
}

function PortalLineItemsTable({ items, showPartProgress = false }) {
  const rows = enrichItemsWithSectionTotals(items || []);
  const colSpan = showPartProgress ? 5 : 4;
  // Every line's tick list starts closed so the invoice stays tidy.
  const [openLines, setOpenLines] = useState(() => new Set());
  const toggleLine = (id) =>
    setOpenLines((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  return (
    <div className="table-wrap">
      <table className="cf-lines">
        <thead>
          <tr>
            {showPartProgress && <th className="cf-progress-col">Progress</th>}
            <th>Item</th>
            <th style={{ textAlign: 'right' }}>Qty</th>
            <th className="cf-col-unit" style={{ textAlign: 'right' }}>Unit (ex VAT)</th>
            <th style={{ textAlign: 'right' }}>Line (ex VAT)</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && (
            <tr>
              <td colSpan={colSpan} className="empty">No lines.</td>
            </tr>
          )}
          {rows.map((row) => {
            if (row.kind === 'header') {
              return (
                <tr key={row.item.id} style={{ background: '#f0f0f0' }}>
                  <td colSpan={colSpan - 1} style={{ fontWeight: 600, padding: '0.55rem 0.75rem' }}>
                    {row.item.description || 'Section'}
                  </td>
                  <td style={{ textAlign: 'right', fontWeight: 600, padding: '0.55rem 0.75rem' }}>
                    {kes(row.sectionNet)}
                  </td>
                </tr>
              );
            }
            const item = row.item;
            const qty = Number(item.quantity) || 0;
            const price = Number(item.unit_price) || 0;
            const tracked = showPartProgress && isTrackableLine(item);
            const open = tracked && openLines.has(item.id);
            const stepsId = `portal-line-progress-${item.id}`;
            const childParts = visiblePartRows(item.parts || []);
            return (
              <Fragment key={item.id}>
                <tr className={open ? 'cf-line-open' : undefined}>
                  {showPartProgress && (
                    <td className="cf-progress-col">
                      {tracked && (
                        <LineProgressToggle
                          item={item}
                          open={open}
                          onToggle={() => toggleLine(item.id)}
                          controlsId={stepsId}
                        />
                      )}
                    </td>
                  )}
                  <td>
                    {item.description}
                    <InvoiceLineSubtextView subtext={item.subtext} />
                    <InvoiceLineDiscountView discountPercent={item.discount_percent} />
                  </td>
                  <td style={{ textAlign: 'right' }}>{qty}</td>
                  <td className="cf-col-unit" style={{ textAlign: 'right' }}>{kes(price)}</td>
                  <td style={{ textAlign: 'right' }}>{kes(invoiceLineNet(item))}</td>
                </tr>
                {open && (
                  <tr className="lp-row">
                    <td colSpan={colSpan}>
                      <LineProgressSteps id={stepsId} item={item} canTick={() => false}>
                        {childParts.length > 0 && (
                          <ul className="lp-parts">
                            {childParts.map((part) => (
                              <li key={part.id}>
                                <span className="lp-part-name">{part.description}</span>
                                <span className={partFlagOn(part, 'received_confirmed') ? 'on' : undefined}>
                                  {partFlagOn(part, 'received_confirmed') ? '✓ ' : ''}Received
                                </span>
                                {partCanBeFitted(part) && (
                                  <span className={partFlagOn(part, 'fitted_confirmed') ? 'on' : undefined}>
                                    {partFlagOn(part, 'fitted_confirmed') ? '✓ ' : ''}Fitted
                                  </span>
                                )}
                              </li>
                            ))}
                          </ul>
                        )}
                      </LineProgressSteps>
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function PortalDocumentTotals({ doc }) {
  if (!doc) return null;
  const hasInvoicePaymentSummary = doc.balance != null && doc.balance !== undefined;
  const paid = Number(doc.amount_paid ?? 0);

  return (
    <InvoiceTotalsSummary
      items={doc.items}
      discountPercent={doc.discount_percent}
      amountPaid={paid}
      showPayments={hasInvoicePaymentSummary}
    />
  );
}

function QuoteSection({ quote, allowApprove, onToggleApprove, onApproveAllQuote }) {
  const quotePendingCount = quote?.items?.filter((i) => !isHeaderLine(i) && !isQuoteLineApproved(i)).length ?? 0;
  const needsApproval = quotePendingCount > 0 && allowApprove;
  const meta = [
    quote.invoice_number,
    quotePendingCount > 0 ? `${quotePendingCount} to approve` : 'All approved',
    kes(quote.total),
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <Collapsible title="Quote" meta={meta} defaultOpen={needsApproval}>
      {(needsApproval || (!allowApprove && quotePendingCount > 0)) && (
        <div className="cf-quote-bar">
          {needsApproval ? (
            <>
              <span>Approve the items you would like us to go ahead with. Approved items move to your invoice.</span>
              {(quote.items?.length ?? 0) >= 2 && (
                <button
                  type="button"
                  className="btn primary"
                  onClick={() => {
                    if (!window.confirm('Are you sure you would like to approve all lines?')) return;
                    onApproveAllQuote(quote.id);
                  }}
                >
                  Approve all
                </button>
              )}
            </>
          ) : (
            <span>Some lines are not approved (approval is only available while the job is open).</span>
          )}
        </div>
      )}
      <div className="table-wrap">
        <table className="cf-lines">
          <thead>
            <tr>
              <th>Approval</th>
              <th>Item</th>
              <th style={{ textAlign: 'right' }}>Qty</th>
              <th className="cf-col-unit" style={{ textAlign: 'right' }}>Unit (ex VAT)</th>
              <th style={{ textAlign: 'right' }}>Line (ex VAT)</th>
            </tr>
          </thead>
          <tbody>
            {(!quote.items || quote.items.length === 0) && (
              <tr><td colSpan={5} className="empty">No quote lines.</td></tr>
            )}
            {enrichItemsWithSectionTotals(quote.items).map((row) => {
              if (row.kind === 'header') {
                return (
                  <tr key={row.item.id} style={{ background: '#f0f0f0' }}>
                    <td />
                    <td colSpan={3} style={{ fontWeight: 600, padding: '0.55rem 0.75rem' }}>
                      {row.item.description || 'Section'}
                    </td>
                    <td style={{ textAlign: 'right', fontWeight: 600, padding: '0.55rem 0.75rem' }}>
                      {kes(row.sectionNet)}
                    </td>
                  </tr>
                );
              }
              const item = row.item;
              const qty = Number(item.quantity) || 0;
              const price = Number(item.unit_price) || 0;
              return (
                <tr key={item.id}>
                  <td style={{ textAlign: 'center', whiteSpace: 'nowrap' }}>
                    {isQuoteLineApproved(item) ? (
                      <span className="cf-approved">
                        ✓ Approved
                        {item.moved_to_invoice_at && <span className="cf-approved-sub">On invoice ↓</span>}
                      </span>
                    ) : allowApprove ? (
                      <button
                        type="button"
                        className="btn primary cf-btn-sm"
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
                  <td>
                    {item.description}
                    <InvoiceLineSubtextView subtext={item.subtext} />
                  </td>
                  <td style={{ textAlign: 'right' }}>{qty}</td>
                  <td className="cf-col-unit" style={{ textAlign: 'right' }}>{kes(price)}</td>
                  <td style={{ textAlign: 'right' }}>{kes(qty * price)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <PortalDocumentTotals doc={quote} />
    </Collapsible>
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

  const inKm = job.odometer_in != null ? `${Number(job.odometer_in).toLocaleString()} km in` : null;
  const outKm = job.odometer_out != null ? `${Number(job.odometer_out).toLocaleString()} km out` : null;
  const meta = [inKm, outKm, job.fuel_in ? `Fuel in ${job.fuel_in}` : null].filter(Boolean).join(' · ');

  return (
    <Collapsible title="Mileage & fuel" meta={meta || 'Not recorded yet'}>
      <div>
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
    </Collapsible>
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
