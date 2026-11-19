import { Fragment, useEffect, useRef, useState } from 'react';
import { Routes, Route, useParams, Link } from 'react-router-dom';
import { api } from '../api';
import { testDriveComputedRows, handoverComputed, formatKmDelta } from '../utils/jobMileageFuel';
import { enrichItemsWithSectionTotals, isHeaderLine } from '../utils/invoiceLineSections';
import { partCanBeFitted, partFlagOn, visiblePartRows } from '../utils/portalJobProgress';
import { invoiceLineNet } from '../utils/invoiceLineVat';
import InvoiceTotalsSummary from '../components/InvoiceTotalsSummary';
import { InvoiceLineSubtextView } from '../components/InvoiceLineSubtext';
import { InvoiceLineDiscountView } from '../components/InvoiceLineDiscount';
import { LineProgressToggle, LineProgressSteps, JobProgressBar, VehicleTestedTick } from '../components/LineProgress';
import { isTrackableLine, formatStageDate } from '../utils/lineProgress';
import {
  whatsappWithText,
  PHONE_TEL,
  PHONE_DISPLAY,
  MAPS,
  VEHICLE_HIRE,
  GOOGLE_REVIEW_URL,
} from '../components/PortalShell';

/**
 * Keeps an open portal page up to date with what the workshop changes (new quote items, ticks,
 * payments): refreshes every 30 seconds while the page is visible, and straight away when the
 * customer comes back to the tab / app. Refresh errors are ignored (the next one will retry).
 */
const PORTAL_REFRESH_MS = 30000;
function usePortalAutoRefresh(refresh, deps) {
  useEffect(() => {
    const run = () => {
      if (document.visibilityState !== 'visible') return;
      try {
        const p = refresh();
        if (p && typeof p.catch === 'function') p.catch(() => {});
      } catch {
        /* ignore */
      }
    };
    const timer = setInterval(run, PORTAL_REFRESH_MS);
    const onVisible = () => {
      if (document.visibilityState === 'visible') run();
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', run);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', run);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}

/** Small "Copy" button for till / account numbers. */
function CopyButton({ value, label = 'Copy' }) {
  const [copied, setCopied] = useState(false);
  if (!value) return null;
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(String(value));
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      window.prompt('Copy this:', String(value));
    }
  };
  return (
    <button type="button" className="cf-copy" onClick={copy} aria-label={`${label} ${value}`}>
      {copied ? 'Copied ✓' : label}
    </button>
  );
}

/** How to pay an outstanding balance: M-Pesa till and bank details, with copy buttons. */
function PaymentDetails({ details, balance, reference }) {
  if (!details || !(Number(balance) > 0)) return null;
  const { mpesa_till: till, bank, terms } = details;
  return (
    <div className="cf-pay">
      <div className="cf-pay-head">
        <span className="cf-eyebrow-sm">How to pay</span>
        <span>
          Balance <strong>{kes(balance)}</strong>
          {reference ? <> · use <strong>{reference}</strong> as the reference</> : null}
        </span>
      </div>
      <div className="cf-pay-grid">
        {till && (
          <div className="cf-pay-box">
            <div className="cf-pay-title">M-Pesa · Buy Goods</div>
            <div className="cf-pay-row">
              Till number <strong className="cf-pay-num">{till}</strong> <CopyButton value={till} />
            </div>
          </div>
        )}
        {bank && (
          <div className="cf-pay-box">
            <div className="cf-pay-title">Bank transfer · {bank.name}</div>
            <div className="cf-pay-row">
              Account <strong className="cf-pay-num">{bank.account_number}</strong> <CopyButton value={bank.account_number} />
            </div>
            <div className="cf-pay-sub">
              {[bank.account_name, bank.branch ? `${bank.branch} branch` : null, bank.swift_code ? `SWIFT ${bank.swift_code}` : null]
                .filter(Boolean)
                .join(' · ')}
            </div>
          </div>
        )}
      </div>
      {terms && <div className="cf-pay-sub">Terms: {terms}. Cheque payments must clear before collection.</div>}
    </div>
  );
}

/**
 * "Download PDF" link for a quote / invoice. While the job is still in progress the invoice
 * comes out marked PROVISIONAL (amounts may still change), and the button says so.
 */
function PdfLink({ token, doc, label = 'Download PDF' }) {
  if (!doc || doc.pdf_available === false) return null;
  const provisional = !!doc.pdf_provisional;
  return (
    <a
      className="btn cf-btn-sm"
      href={api.customerPortal.documentPdfUrl(token, doc.id)}
      target="_blank"
      rel="noopener noreferrer"
      title={provisional ? 'Work is still in progress, so items and amounts may change' : undefined}
    >
      ⤓ {provisional ? `${label} (provisional)` : label}
    </a>
  );
}

function formatDueDate(iso) {
  if (!iso) return null;
  const d = new Date(`${String(iso).slice(0, 10)}T00:00:00`);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

/** "166,400 km or 18 May 2027" */
function serviceDueLabel(next) {
  if (!next) return null;
  return [next.km != null ? `${Number(next.km).toLocaleString()} km` : null, formatDueDate(next.date)].filter(Boolean).join(' or ') || null;
}

function bookServiceLink(vehicle, next) {
  const car = [vehicle.registration, [vehicle.make, vehicle.model].filter(Boolean).join(' ')].filter(Boolean).join(' – ');
  const due = serviceDueLabel(next);
  return whatsappWithText(
    `Hello Chequered Flag, I would like to book a service for ${car || 'my vehicle'}.${due ? ` Next service due: ${due}.` : ''} When would suit?`,
  );
}

function isLabourLine(item) {
  return String(item?.type || '').toLowerCase() === 'labour';
}

/** Vehicle released: big, clear "ready for collection" message with hours, directions and how to arrange. */
function CollectionBanner({ job }) {
  const car = [job.vehicle?.registration, [job.vehicle?.make, job.vehicle?.model].filter(Boolean).join(' ')]
    .filter(Boolean)
    .join(' – ');
  const due = job.invoice && Number(job.invoice.balance) > 0 ? job.invoice.balance : 0;
  return (
    <section className="cf-ready" aria-live="polite">
      <div className="cf-ready-main">
        <div className="cf-ready-title">✓ Your vehicle is ready for collection</div>
        <div className="cf-ready-text">
          Collect from our workshop on Ngong Road, Karen · Mon–Fri 8:00am – 5:00pm, Sat 8:00am – 1:00pm
          (closed Sundays & public holidays).
        </div>
        {due > 0 && (
          <div className="cf-ready-text">
            Balance to pay at collection: <strong>{kes(due)}</strong> (see <em>How to pay</em> under the invoice).
          </div>
        )}
      </div>
      <div className="cf-ready-actions">
        <a
          className="btn primary cf-btn-sm"
          href={whatsappWithText(`Hello Chequered Flag, I would like to arrange collection of ${car || 'my vehicle'} (job ${job.job_number}).`)}
          target="_blank"
          rel="noopener noreferrer"
        >
          Arrange collection
        </a>
        <a className="btn cf-btn-sm" href={PHONE_TEL}>Call {PHONE_DISPLAY}</a>
        <a className="btn cf-btn-sm" href={MAPS} target="_blank" rel="noopener noreferrer">Directions</a>
      </div>
    </section>
  );
}

/** While the work is in progress: expected ready date (if set) and a hire-car suggestion. */
function InProgressStrip({ job }) {
  const ready = job.due_date ? formatDueDate(job.due_date) : null;
  return (
    <section className="cf-strip">
      <div>
        {ready ? (
          <>
            Expected ready <strong>{ready}</strong>
            <span className="cf-muted"> · we will message you if that changes</span>
          </>
        ) : (
          <span className="cf-muted">We are working on your vehicle. We will message you when it is ready.</span>
        )}
      </div>
      <a className="cf-strip-hire" href={VEHICLE_HIRE} target="_blank" rel="noopener noreferrer">
        Need a car while yours is in? <strong>See hire vehicles →</strong>
      </a>
    </section>
  );
}

/** Job statuses where the customer can still approve quote items (same rule as the server). */
const QUOTE_APPROVAL_STATUSES = ['pending', 'in_progress', 'vehicle_released'];

/** Quote items still waiting for the customer (headers and the labour line don't count). */
function isQuoteLineDeclined(line) {
  return !isQuoteLineApproved(line) && !!line?.declined_at;
}

/** Quote items the customer hasn't decided on yet (headers, the labour line and declined items don't count). */
function quoteItemsAwaiting(quote) {
  return (quote?.items || []).filter(
    (i) => !isHeaderLine(i) && !isLabourLine(i) && !isQuoteLineApproved(i) && !isQuoteLineDeclined(i),
  ).length;
}

function jobApprovalsNeeded(job) {
  return QUOTE_APPROVAL_STATUSES.includes(job?.status) ? quoteItemsAwaiting(job?.quote) : 0;
}

/** Opens the quote drop-down and scrolls to it. */
function openQuote() {
  const el = document.getElementById('portal-quote');
  if (!el) return;
  el.open = true;
  el.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

/** "Action needed" notice at the top of a job while quote items wait for approval. */
function ApprovalNotice({ count }) {
  if (!count) return null;
  return (
    <section className="cf-attn" role="status">
      <div>
        <div className="cf-attn-title">Action needed: approval</div>
        <div className="cf-attn-text">
          {count === 1 ? '1 item on your quote is' : `${count} items on your quote are`} waiting for your approval. We
          only go ahead with the items you approve.
        </div>
      </div>
      <button type="button" className="btn primary cf-btn-sm" onClick={openQuote}>
        Review & approve
      </button>
    </section>
  );
}

/** A card that opens and closes; the summary line stays visible when it is closed. */
function Collapsible({ title, meta, badge, id, defaultOpen = false, children }) {
  // Opens itself when something needs attention (e.g. new items to approve after a refresh), but never
  // closes itself: the customer decides when to close it.
  const ref = useRef(null);
  const [initiallyOpen] = useState(defaultOpen);
  useEffect(() => {
    if (defaultOpen && ref.current) ref.current.open = true;
  }, [defaultOpen]);
  return (
    <details ref={ref} className="card cf-collapse" id={id} open={initiallyOpen || undefined}>
      <summary>
        <span className="cf-collapse-title">{title}</span>
        {badge ? <span className="cf-attn-badge">{badge}</span> : null}
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
  vehicle_released: 'Ready for collection',
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
      <Route path="vehicle/:vehicleId" element={<PortalVehicle />} />
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

  usePortalAutoRefresh(() => (token ? api.customerPortal.get(token).then(setData) : null), [token]);

  if (loading) return <div className="page-title">Loading…</div>;
  if (error || !data) return <div className="page-title">Link not found or expired.</div>;

  const { customer, jobs, standalone_documents: standaloneDocs = [], vehicles = [] } = data;
  const jobsNeedingApproval = jobs.filter((j) => jobApprovalsNeeded(j) > 0);
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

      {jobsNeedingApproval.length > 0 && (
        <section className="cf-attn" role="status">
          <div>
            <div className="cf-attn-title">
              Action needed: {jobsNeedingApproval.length === 1 ? '1 job needs' : `${jobsNeedingApproval.length} jobs need`} your
              approval
            </div>
            <ul className="cf-attn-list">
              {jobsNeedingApproval.map((j) => {
                const n = jobApprovalsNeeded(j);
                return (
                  <li key={j.id}>
                    <Link to={`job/${j.id}`}>
                      <strong>{j.vehicle?.registration || j.job_number}</strong>
                      {j.vehicle?.registration ? ` · job ${j.job_number}` : ''}
                      {' · '}
                      {n} {n === 1 ? 'item' : 'items'} to approve
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
          {jobsNeedingApproval.length === 1 && (
            <Link className="btn primary cf-btn-sm" to={`job/${jobsNeedingApproval[0].id}`}>
              Review & approve
            </Link>
          )}
        </section>
      )}

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
                        <td>
                          {jobStatusLabel(job.status)}
                          {jobApprovalsNeeded(job) > 0 && <div className="cf-attn-badge cf-attn-badge-sm">Approval needed</div>}
                        </td>
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

      {vehicles.length > 0 && (
        <section className="card">
          <div className="cf-card-head">
            <h3>Your vehicles</h3>
            <span className="cf-card-head-meta">Service history and next service</span>
          </div>
          <div className="cf-vehicles">
            {vehicles.map((v) => {
              const due = serviceDueLabel(v.next_service);
              return (
                <div key={v.id} className="cf-vehicle">
                  <div className="cf-vehicle-main">
                    <div className="cf-vehicle-reg">{v.registration || '—'}</div>
                    <div className="cf-vehicle-name">{[v.make, v.model, v.year].filter(Boolean).join(' ') || '—'}</div>
                    <div className="cf-vehicle-meta">
                      {v.visits} {v.visits === 1 ? 'visit' : 'visits'}
                      {v.last_visit ? ` · last ${formatPortalDate(v.last_visit)}` : ''}
                    </div>
                    <div className="cf-vehicle-due">
                      {due ? (
                        <>
                          Next service <strong>{due}</strong>
                          {v.next_service?.estimated && <span className="cf-est"> (estimate)</span>}
                        </>
                      ) : (
                        <span className="cf-muted">Next service: ask us</span>
                      )}
                    </div>
                  </div>
                  <div className="cf-vehicle-actions">
                    <Link className="btn cf-btn-sm" to={`vehicle/${v.id}`}>History</Link>
                    <a className="btn primary cf-btn-sm" href={bookServiceLink(v, v.next_service)} target="_blank" rel="noopener noreferrer">
                      Book service
                    </a>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}

/** One vehicle: when the next service is due (with a Book button) and every visit to the workshop. */
function PortalVehicle() {
  const { token, vehicleId } = useParams();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!token || !vehicleId) return;
    setLoading(true);
    setError('');
    api.customerPortal
      .getVehicle(token, vehicleId)
      .then(setData)
      .catch((err) => setError(err.message || 'Failed to load'))
      .finally(() => setLoading(false));
  }, [token, vehicleId]);

  if (loading) return <div className="page-title">Loading…</div>;
  if (error || !data) return <div className="page-title">Vehicle not found.</div>;

  const { vehicle, next_service: next, history } = data;
  const due = serviceDueLabel(next);
  return (
    <div className="customer-portal cf-compact">
      <Link to={`/portal/${encodeURIComponent(token)}`} className="cf-back">
        ← Home
      </Link>
      <div className="cf-eyebrow">Your vehicle · Service history</div>
      <h1 className="page-title">{vehicle.registration || 'Vehicle'}</h1>
      <p className="cf-meta-line">
        {[vehicle.make, vehicle.model, vehicle.year].filter(Boolean).join(' ') || '—'}
        {vehicle.last_odometer ? ` · last recorded ${Number(vehicle.last_odometer).toLocaleString()} km` : ''}
      </p>

      <section className="card cf-next-service">
        <div>
          <div className="cf-eyebrow-sm">Next service due</div>
          <div className="cf-next-service-value">{due || 'Ask us when your next service is due'}</div>
          {next?.estimated && (
            <div className="cf-muted cf-small">
              Estimate based on a typical 10,000 km / 6-month interval from your last visit. We will confirm when you book.
            </div>
          )}
        </div>
        <a className="btn primary" href={bookServiceLink(vehicle, next)} target="_blank" rel="noopener noreferrer">
          Book service on WhatsApp
        </a>
      </section>

      <section className="card">
        <div className="cf-card-head">
          <h3>Visits</h3>
          <span className="cf-card-head-meta">
            {history.length} {history.length === 1 ? 'visit' : 'visits'}
          </span>
        </div>
        {history.length === 0 && <p className="empty cf-empty-sm">No visits yet.</p>}
        <ol className="cf-history">
          {history.map((h) => {
            const km = h.odometer_out ?? h.odometer_in;
            return (
              <li key={h.id}>
                <div className="cf-history-date">{formatPortalDate(h.completed_at || h.created_at)}</div>
                <div className="cf-history-body">
                  <div className="cf-history-title">
                    <strong>{h.job_number}</strong>
                    <span className="cf-muted"> · {jobStatusLabel(h.status)}</span>
                    {km != null && <span className="cf-muted"> · {Number(km).toLocaleString()} km</span>}
                  </div>
                  {h.description && <div>{h.description}</div>}
                  {h.work?.length > 0 && <div className="cf-history-work">{h.work.join(' · ')}</div>}
                </div>
                <div className="cf-history-side">
                  {h.invoice_total != null && <div>{kes(h.invoice_total)}</div>}
                  <Link className="btn cf-btn-sm" to={`/portal/${encodeURIComponent(token)}/job/${h.id}`}>
                    View
                  </Link>
                </div>
              </li>
            );
          })}
        </ol>
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

  usePortalAutoRefresh(() => (saving ? null : reload()), [token, invoiceId, saving]);

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
          token={token}
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
          <PaymentDetails details={payload.payment_details} balance={invoice.balance} reference={invoice.invoice_number} />
          <div className="cf-doc-actions">
            <PdfLink token={token} doc={invoice} label="Download invoice PDF" />
          </div>
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

  usePortalAutoRefresh(() => (saving ? null : reload()), [token, jobId, saving]);

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
  const carName = [job.vehicle?.make, job.vehicle?.model].filter(Boolean).join(' ');

  return (
    <div className="customer-portal cf-compact">
      <Link to={`/portal/${encodeURIComponent(token)}`} className="cf-back">
        ← All jobs
      </Link>
      <div className="cf-eyebrow">Workshop job · {jobStatusLabel(job.status)}</div>
      <h1 className="page-title cf-job-title">
        <span>{customer.name}</span>
        {job.vehicle?.registration && <span className="cf-job-reg">{job.vehicle.registration}</span>}
      </h1>
      <p className="cf-meta-line">
        Job <strong>{job.job_number}</strong>
        {carName ? ` · ${carName}` : ''} · In {formatPortalDate(job.created_at)}
        {job.completed_at ? ` · Out ${formatPortalDate(job.completed_at)}` : ''}
      </p>

      {saving && <p className="cf-saving">Saving…</p>}

      {job.status === 'vehicle_released' && <CollectionBanner job={job} />}
      {(job.status === 'in_progress' || job.status === 'pending') && <InProgressStrip job={job} />}

      {allowQuoteApproval && <ApprovalNotice count={quoteItemsAwaiting(job.quote)} />}

      <JobProgressBar items={job.invoice?.items} tasks={tasks} vehicleTested={!!job.vehicle_tested_at} />

      {job.quote && (
        <QuoteSection
          quote={job.quote}
          allowApprove={allowQuoteApproval}
          onToggleApprove={toggleApprove}
          onApproveAllQuote={approveAllQuote}
          showVehicleTested
          vehicleTestedAt={job.vehicle_tested_at}
          token={token}
        />
      )}

      <Collapsible
        title="Invoice"
        meta={
          job.invoice
            ? [
                job.invoice.invoice_number,
                kes(job.invoice.total),
                Number(job.invoice.balance) > 0 ? `${kes(job.invoice.balance)} due` : 'Paid',
              ]
                .filter(Boolean)
                .join(' · ')
            : 'Not issued yet'
        }
      >
        {!job.invoice && (
          <p className="empty cf-empty-sm">No invoice yet. Items you approve on the quote will appear here.</p>
        )}
        {job.invoice && (
          <>
            <div className="cf-doc-bar">
              <span className="cf-muted">
                <strong>{job.invoice.invoice_number}</strong>
                {job.invoice.status ? ` · ${job.invoice.status}` : ''} · open a line's progress to see each step
              </span>
              <PdfLink token={token} doc={job.invoice} />
            </div>
            <PortalLineItemsTable items={job.invoice.items} showPartProgress />
            <PortalDocumentTotals doc={job.invoice} />
            {job.vehicle_tested_at && (
              <VehicleTestedTick id={`portal-invoice-vehicle-tested-${job.id}`} at={job.vehicle_tested_at} />
            )}
            <PaymentDetails
              details={payload.payment_details}
              balance={job.invoice.balance}
              reference={job.invoice.invoice_number}
            />
          </>
        )}
      </Collapsible>

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

function QuoteSection({ quote, allowApprove, onToggleApprove, onApproveAllQuote, showVehicleTested = false, vehicleTestedAt = null, token = null }) {
  // The labour line isn't approved item by item, so it isn't counted as waiting for approval.
  const quotePendingCount = quoteItemsAwaiting(quote);
  const declinedCount = (quote?.items || []).filter((i) => !isHeaderLine(i) && isQuoteLineDeclined(i)).length;
  const needsApproval = quotePendingCount > 0 && allowApprove;
  const meta = [
    quote.invoice_number,
    needsApproval
      ? null
      : quotePendingCount > 0
        ? `${quotePendingCount} not approved`
        : declinedCount > 0
          ? 'All decided'
          : 'All approved',
    declinedCount > 0 ? `${declinedCount} declined` : null,
    kes(quote.total),
    showVehicleTested && vehicleTestedAt ? 'Vehicle tested ✓' : null,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <Collapsible
      title="Quote"
      id="portal-quote"
      badge={needsApproval ? `${quotePendingCount} to approve` : null}
      meta={meta}
      defaultOpen={needsApproval}
    >
      {(needsApproval || (!allowApprove && quotePendingCount > 0)) && (
        <div className="cf-quote-bar">
          {needsApproval ? (
            <>
              <span>
                Approve the items you would like us to go ahead with, or decline the ones you don't. Approved items move to
                your invoice and are final; declined items can still be approved later.
              </span>
              {quotePendingCount >= 2 && (
                <button
                  type="button"
                  className="btn primary"
                  onClick={() => {
                    if (!window.confirm("Approve all the remaining items? Once approved they can't be changed here.")) return;
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
                    {isLabourLine(item) ? (
                      <span className="cf-muted cf-small" title="Labour is charged for the work done; it is not approved item by item">
                        Labour
                      </span>
                    ) : isQuoteLineApproved(item) ? (
                      <span className="cf-approved">
                        ✓ Approved
                        {item.moved_to_invoice_at && <span className="cf-approved-sub">On invoice ↓</span>}
                      </span>
                    ) : isQuoteLineDeclined(item) ? (
                      <span className="cf-declined">
                        ✕ Declined
                        {allowApprove && (
                          <button
                            type="button"
                            className="cf-change"
                            onClick={() => {
                              if (!window.confirm(`Approve "${item.description}" after all? Once approved it can't be changed here.`)) return;
                              onToggleApprove(quote.id, item.id, true);
                            }}
                          >
                            Change
                          </button>
                        )}
                      </span>
                    ) : allowApprove ? (
                      <span className="cf-decide">
                        <button
                          type="button"
                          className="btn primary cf-btn-sm"
                          onClick={() => {
                            if (!window.confirm(`Approve "${item.description}"? Once approved it can't be changed here.`)) return;
                            onToggleApprove(quote.id, item.id, true);
                          }}
                        >
                          Approve
                        </button>
                        <button
                          type="button"
                          className="btn cf-btn-sm cf-decline-btn"
                          onClick={() => {
                            if (!window.confirm(`Decline "${item.description}"? We won't go ahead with it. You can change your mind later.`)) return;
                            onToggleApprove(quote.id, item.id, false);
                          }}
                        >
                          Decline
                        </button>
                      </span>
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
      {showVehicleTested && <VehicleTestedTick id={`portal-vehicle-tested-${quote.id}`} at={vehicleTestedAt} />}
      {token && (
        <div className="cf-doc-actions">
          <PdfLink token={token} doc={quote} label="Download quote PDF" />
        </div>
      )}
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
  const tdCount = testDrivesList.length;
  const meta = [
    inKm,
    outKm,
    job.fuel_in ? `Fuel in ${job.fuel_in}` : null,
    tdCount ? `${tdCount} test ${tdCount === 1 ? 'drive' : 'drives'}` : null,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <Collapsible title="Mileage & fuel" meta={meta || 'Not recorded yet'}>
      <div>
        <div style={rowStyle}>
          <strong>Mileage in</strong>
          <span>{job.odometer_in != null ? `${Number(job.odometer_in).toLocaleString()} km` : '—'}</span>
          <strong>Fuel in</strong>
          <span>{job.fuel_in || '—'}</span>
        </div>
        {tdComputed.length > 0 && (
          <ol className="cf-td-list">
            {tdComputed.map((row) => {
              const td = testDrivesList[row.index] || {};
              return (
                <li key={row.id}>
                  <div className="cf-td-head">
                    <strong>Test drive {row.index + 1}</strong>
                    {td.created_at && <span className="cf-muted">{formatStageDate(td.created_at)}</span>}
                  </div>
                  <div className="cf-td-facts">
                    <span>{formatKmDelta(row.covered)} driven</span>
                    <span>Fuel used {row.used}</span>
                    {td.odometer != null && <span className="cf-muted">back at {Number(td.odometer).toLocaleString()} km</span>}
                  </div>
                  {td.notes && <div className="cf-td-notes">{td.notes}</div>}
                </li>
              );
            })}
          </ol>
        )}
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
          {rating >= 4 && (
            <div className="cf-review">
              <div>
                <strong>Thank you!</strong> Would you share that on Google? It takes a minute and really helps other
                drivers find us.
              </div>
              <a className="btn primary cf-btn-sm" href={GOOGLE_REVIEW_URL} target="_blank" rel="noopener noreferrer">
                Leave a Google review ★
              </a>
            </div>
          )}
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
