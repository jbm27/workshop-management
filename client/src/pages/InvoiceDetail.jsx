import { useEffect, useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { api } from '../api';
import JobInvoiceLpoIprPanel from '../components/JobInvoiceLpoIprPanel';
import { useAdmin } from '../auth/AdminContext';

function kes(n) {
  const x = Number(n);
  if (Number.isNaN(x)) return '—';
  return `KES ${x.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}

/** Portal / DB may send 0/1, "0"/"1", or null. */
function isQuoteLineApproved(line) {
  return Number(line?.approved) === 1;
}

export default function InvoiceDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [inv, setInv] = useState(null);
  const [loading, setLoading] = useState(true);
  const [dueDate, setDueDate] = useState('');
  const [notes, setNotes] = useState('');
  const [savingMeta, setSavingMeta] = useState(false);
  const [metaDirty, setMetaDirty] = useState(false);
  const [payAmount, setPayAmount] = useState('');
  const [payDate, setPayDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [payNotes, setPayNotes] = useState('');
  const [addingPay, setAddingPay] = useState(false);
  const { admin } = useAdmin();
  const canRecordInvoicePayments = admin?.permissions?.can_record_invoice_payments;
  const [customerVehicles, setCustomerVehicles] = useState([]);
  const [fromQuoteVehicleId, setFromQuoteVehicleId] = useState('');
  const [fromQuoteJobNotes, setFromQuoteJobNotes] = useState('');
  const [fromQuoteBusy, setFromQuoteBusy] = useState(false);

  const refresh = () =>
    api.invoices.get(id).then((data) => {
      setInv(data);
      setDueDate(data.due_date ? String(data.due_date).slice(0, 10) : '');
      setNotes(data.notes || '');
      setMetaDirty(false);
    });

  useEffect(() => {
    setLoading(true);
    api.invoices
      .get(id)
      .then((data) => {
        setInv(data);
        setDueDate(data.due_date ? String(data.due_date).slice(0, 10) : '');
        setNotes(data.notes || '');
        setMetaDirty(false);
      })
      .catch(() => setInv(null))
      .finally(() => setLoading(false));
  }, [id]);

  useEffect(() => {
    if (!inv || inv.type !== 'quote' || inv.job_id || !inv.customer_id) {
      setCustomerVehicles([]);
      return;
    }
    api.customers
      .vehicles(inv.customer_id)
      .then(setCustomerVehicles)
      .catch(() => setCustomerVehicles([]));
  }, [inv?.customer_id, inv?.type, inv?.job_id]);

  useEffect(() => {
    if (inv?.vehicle_id) setFromQuoteVehicleId(String(inv.vehicle_id));
    else setFromQuoteVehicleId('');
  }, [inv?.vehicle_id, inv?.id]);

  useEffect(() => {
    if (!inv) return;
    const d =
      (inv.due_date ? String(inv.due_date).slice(0, 10) : '') !== dueDate || (inv.notes || '') !== notes;
    setMetaDirty(d);
  }, [inv, dueDate, notes]);

  /** When the customer approves lines in the portal (another tab), reload this quote on return to the tab. */
  useEffect(() => {
    if (!id || inv?.type !== 'quote') return;
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return;
      api.invoices
        .get(id)
        .then((data) => {
          setInv(data);
          setDueDate(data.due_date ? String(data.due_date).slice(0, 10) : '');
          setNotes(data.notes || '');
          setMetaDirty(false);
        })
        .catch(() => {});
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [id, inv?.type]);

  const saveMeta = async () => {
    setSavingMeta(true);
    try {
      const updated = await api.invoices.update(id, {
        due_date: dueDate || null,
        notes: notes || null,
      });
      setInv((prev) => (prev ? { ...prev, ...updated } : prev));
      setMetaDirty(false);
    } catch (err) {
      alert(err.message);
    } finally {
      setSavingMeta(false);
    }
  };

  const addPayment = async (e) => {
    e.preventDefault();
    if (!canRecordInvoicePayments) return alert('You do not have permission to record payments');
    const amount = Number(payAmount);
    if (!amount || amount <= 0) return alert('Enter a positive amount');
    setAddingPay(true);
    try {
      const updated = await api.invoices.addPayment(id, {
        amount,
        paid_at: payDate ? `${payDate}T12:00:00` : undefined,
        notes: payNotes.trim() || undefined,
      });
      setInv(updated);
      setPayAmount('');
      setPayNotes('');
      setPayDate(new Date().toISOString().slice(0, 10));
    } catch (err) {
      alert(err.message);
    } finally {
      setAddingPay(false);
    }
  };

  const startJobFromQuote = async (e) => {
    e.preventDefault();
    const vid = fromQuoteVehicleId || (inv.vehicle_id ? String(inv.vehicle_id) : '');
    if (!vid) {
      alert('Select a vehicle for this job (or link a vehicle on the quote first).');
      return;
    }
    setFromQuoteBusy(true);
    try {
      const { job } = await api.jobs.createFromQuote({
        quote_id: Number(id),
        vehicle_id: Number(vid),
        notes: fromQuoteJobNotes.trim() || undefined,
      });
      navigate(`/jobs/${job.id}`);
    } catch (err) {
      alert(err.message);
    } finally {
      setFromQuoteBusy(false);
    }
  };

  const removePayment = async (paymentId) => {
    if (!canRecordInvoicePayments) return alert('You do not have permission to remove payments');
    if (!confirm('Remove this payment record?')) return;
    try {
      await api.invoices.deletePayment(id, paymentId);
      await refresh();
    } catch (err) {
      alert(err.message);
    }
  };

  if (loading) return <div className="page-title">Loading…</div>;
  if (!inv) {
    return (
      <>
        <p className="page-title">Invoice not found</p>
        <Link to="/invoices">← Back to invoices</Link>
      </>
    );
  }

  const subtotal = Number(inv.subtotal || 0);
  const tax = Number(inv.tax_amount || 0);
  const total = Number(inv.total || 0);
  const items = inv.items || [];
  const payments = inv.payments || [];
  const amountPaid = Number(inv.amount_paid ?? payments.reduce((s, p) => s + Number(p.amount || 0), 0)) || 0;
  const balance = inv.type === 'invoice' ? Number(inv.balance ?? total - amountPaid) : null;
  const isQuote = inv.type === 'quote';
  const quoteApprovedCount = isQuote ? items.filter((it) => isQuoteLineApproved(it)).length : 0;

  return (
    <>
      <div style={{ marginBottom: '1rem' }}>
        <Link to="/invoices">← Invoices & quotes</Link>
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'flex-start', gap: '1rem', marginBottom: '1.5rem' }}>
        <h1 className="page-title" style={{ margin: 0 }}>
          {inv.invoice_number}{' '}
          <span className={`badge ${inv.type}`} style={{ fontSize: '0.85rem', verticalAlign: 'middle' }}>
            {inv.type}
          </span>
        </h1>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
          {items.length > 0 && (
            <button type="button" className="btn primary" onClick={() => api.invoices.downloadPDF(inv.id)}>
              Download PDF
            </button>
          )}
          {inv.job_id && (
            <Link to={`/jobs/${inv.job_id}`} className="btn">
              Open job
            </Link>
          )}
        </div>
      </div>

      <div className="grid-2">
        <div className="card">
          <h3 style={{ marginTop: 0 }}>Customer</h3>
          <p><strong>{inv.customer_name || '—'}</strong></p>
          {inv.customer_email && <p>{inv.customer_email}</p>}
          {inv.customer_phone && <p>{inv.customer_phone}</p>}
          {inv.customer_address && <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>{inv.customer_address}</p>}
        </div>
        <div className="card">
          <h3 style={{ marginTop: 0 }}>Vehicle</h3>
          {inv.registration || inv.make || inv.model ? (
            <p><strong>{[inv.registration, inv.make, inv.model].filter(Boolean).join(' ')}</strong></p>
          ) : (
            <p style={{ color: 'var(--text-muted)' }}>No vehicle linked</p>
          )}
          <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', marginTop: '0.75rem' }}>
            Created {inv.created_at ? new Date(inv.created_at).toLocaleString() : '—'}
          </p>
        </div>
      </div>

      {isQuote && !inv.job_id && (
        <div className="card" style={{ marginBottom: '1.5rem' }}>
          <h3 style={{ marginTop: 0 }}>Start a job from this quote</h3>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', marginTop: 0 }}>
            When the customer accepts and brings the vehicle in, create a job here. This quote stays the same document
            and is linked to the new job (you can continue from the job page).
          </p>
          <form onSubmit={startJobFromQuote}>
            <div className="form-group">
              <label>Vehicle for the job *</label>
              <select
                value={fromQuoteVehicleId}
                onChange={(e) => setFromQuoteVehicleId(e.target.value)}
                required={!inv.vehicle_id}
              >
                <option value="">{inv.vehicle_id ? '— Use vehicle on quote —' : '— Select vehicle —'}</option>
                {customerVehicles.map((v) => (
                  <option key={v.id} value={v.id}>
                    {[v.registration, v.make, v.model].filter(Boolean).join(' ') || `Vehicle #${v.id}`}
                  </option>
                ))}
              </select>
              {customerVehicles.length === 0 && (
                <p style={{ fontSize: '0.85rem', color: 'var(--warning)', margin: '0.35rem 0 0' }}>
                  No vehicles on file for this customer. Add one under Customers, or link a vehicle on the quote (edit
                  invoice metadata if your app supports it).
                </p>
              )}
            </div>
            <div className="form-group">
              <label>Job notes (optional)</label>
              <textarea
                rows={2}
                value={fromQuoteJobNotes}
                onChange={(e) => setFromQuoteJobNotes(e.target.value)}
                placeholder="e.g. Customer confirmed quote by phone…"
              />
            </div>
            <button type="submit" className="btn primary" disabled={fromQuoteBusy}>
              {fromQuoteBusy ? 'Creating…' : 'Create job from quote'}
            </button>
          </form>
        </div>
      )}

      {!isQuote && (
        <div className="card" style={{ marginBottom: '1.5rem' }}>
          <h3 style={{ marginTop: 0 }}>Payments</h3>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', marginTop: 0 }}>
            Record deposits and instalments. Balance updates on the list and here.
          </p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '1.5rem', marginBottom: '1rem' }}>
            <div>
              <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>Total due</div>
              <div style={{ fontSize: '1.15rem' }}>{kes(total)}</div>
            </div>
            <div>
              <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>Paid to date</div>
              <div style={{ fontSize: '1.15rem' }}>{kes(amountPaid)}</div>
            </div>
            <div>
              <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>Balance</div>
              <div style={{ fontSize: '1.15rem', fontWeight: 600 }}>{kes(balance)}</div>
            </div>
          </div>

          <form onSubmit={addPayment} style={{ marginBottom: '1.25rem', padding: '1rem', background: 'var(--bg)', borderRadius: 'var(--radius)' }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: '0.75rem', alignItems: 'end' }}>
              <div className="form-group" style={{ margin: 0 }}>
                <label>Amount (KES) *</label>
                <input
                  type="number"
                  min="0.01"
                  step="0.01"
                  value={payAmount}
                  onChange={(e) => setPayAmount(e.target.value)}
                  required
                  placeholder="0"
                />
              </div>
              <div className="form-group" style={{ margin: 0 }}>
                <label>Date paid</label>
                <input type="date" value={payDate} onChange={(e) => setPayDate(e.target.value)} />
              </div>
              <div className="form-group" style={{ margin: 0, gridColumn: '1 / -1' }}>
                <label>Note (optional)</label>
                <input type="text" value={payNotes} onChange={(e) => setPayNotes(e.target.value)} placeholder="e.g. Deposit, M-Pesa ref" />
              </div>
            </div>
            <button type="submit" className="btn primary" style={{ marginTop: '0.75rem' }} disabled={addingPay || !canRecordInvoicePayments}>
              {addingPay ? 'Adding…' : 'Record payment'}
            </button>
          </form>

          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Amount</th>
                  <th>Date</th>
                  <th>Note</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {payments.length === 0 && (
                  <tr>
                    <td colSpan={4} className="empty">No payments recorded yet</td>
                  </tr>
                )}
                {payments.map((p) => (
                  <tr key={p.id}>
                    <td><strong>{kes(p.amount)}</strong></td>
                    <td>{p.paid_at ? new Date(p.paid_at).toLocaleString() : '—'}</td>
                    <td style={{ color: 'var(--text-muted)' }}>{p.notes || '—'}</td>
                    <td>
                      <button
                        type="button"
                        className="btn"
                        style={{ padding: '0.2rem 0.5rem', fontSize: '0.8rem' }}
                        onClick={() => removePayment(p.id)}
                        disabled={!canRecordInvoicePayments}
                      >
                        Remove
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {isQuote && (
        <div className="card" style={{ marginBottom: '1.5rem' }}>
          <h3 style={{ marginTop: 0 }}>Payments</h3>
          <p style={{ color: 'var(--text-muted)', margin: 0 }}>Payments and balances apply to invoices only, not quotes.</p>
        </div>
      )}

      <div className="card" style={{ marginBottom: '1.5rem' }}>
        <h3 style={{ marginTop: 0 }}>Due date & notes</h3>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '1rem', alignItems: 'end' }}>
          <div className="form-group" style={{ margin: 0 }}>
            <label>Due date</label>
            <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
          </div>
          <div className="form-group" style={{ margin: 0, gridColumn: '1 / -1' }}>
            <label>Notes</label>
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
          </div>
        </div>
        {metaDirty && (
          <button type="button" className="btn primary" style={{ marginTop: '1rem' }} onClick={saveMeta} disabled={savingMeta}>
            {savingMeta ? 'Saving…' : 'Save'}
          </button>
        )}
      </div>

      <div className="card">
        <h3 style={{ marginTop: 0 }}>Line items</h3>
        {isQuote && items.length > 0 && (
          <p style={{ margin: '0 0 0.75rem', fontSize: '0.88rem', color: 'var(--text-muted)' }}>
            Customer portal: <strong>{quoteApprovedCount}</strong> of <strong>{items.length}</strong> line
            {items.length === 1 ? '' : 's'} approved. Refresh the page after the customer approves to see updates.
          </p>
        )}
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Description</th>
                {isQuote && <th>Customer approved</th>}
                <th>Qty</th>
                {!isQuote && <th>Purchase (unit)</th>}
                <th>Unit price</th>
                <th>Line total</th>
              </tr>
            </thead>
            <tbody>
              {items.length === 0 && (
                <tr>
                  <td colSpan={5} className="empty">No line items yet</td>
                </tr>
              )}
              {items.map((it) => {
                const labour = String(it.type || '').toLowerCase() === 'labour';
                const qty = labour ? 1 : Number(it.quantity) || 0;
                const price = Number(it.unit_price) || 0;
                return (
                  <tr key={it.id}>
                    <td>
                      {labour ? <strong>Labour</strong> : it.description}
                      {!isQuote && Number(it.lpo_line_count) > 0 && (
                        <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>
                          LPO net: {kes(Number(it.lpo_allocated_cost) || 0)}
                        </div>
                      )}
                      {!isQuote && Number(it.ipr_line_count) > 0 && (
                        <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>
                          IPR net: {kes(Number(it.ipr_allocated_cost) || 0)}
                        </div>
                      )}
                      {!isQuote && (it.lpo_ref || it.ipr_ref || it.ipr_refs) && (
                        <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>
                          {[
                            it.lpo_ref && `Legacy LPO ${it.lpo_ref}`,
                            (it.ipr_refs || it.ipr_ref) &&
                              `IPR ${String(it.ipr_refs || it.ipr_ref).replace(/,/g, ', ')}`,
                          ]
                            .filter(Boolean)
                            .join(' · ')}
                        </div>
                      )}
                    </td>
                    {isQuote && (
                      <td style={{ whiteSpace: 'nowrap' }}>
                        {isQuoteLineApproved(it) ? (
                          <span style={{ color: 'var(--success)', fontWeight: 600 }}>Yes</span>
                        ) : (
                          <span style={{ color: 'var(--text-muted)' }}>Pending</span>
                        )}
                      </td>
                    )}
                    <td>{qty}</td>
                    {!isQuote && (
                      <td>
                        {kes(it.purchase_price)}
                        {labour && (
                          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>
                            Logged hours × labour cost rate
                          </div>
                        )}
                      </td>
                    )}
                    <td>{kes(price)}</td>
                    <td>{kes(qty * price)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div style={{ marginTop: '1rem', textAlign: 'right', maxWidth: '280px', marginLeft: 'auto' }}>
          <p style={{ margin: '0.25rem 0' }}>Subtotal <strong>{kes(subtotal)}</strong></p>
          <p style={{ margin: '0.25rem 0', color: 'var(--text-muted)' }}>
            VAT ({((Number(inv.tax_rate) || 0) * 100).toFixed(0)}%) <strong>{kes(tax)}</strong></p>
          <p style={{ margin: '0.5rem 0 0', fontSize: '1.1rem' }}>Total <strong>{kes(total)}</strong></p>
        </div>
      </div>

      {!isQuote && (
        <div className="card">
          <h3 style={{ marginTop: 0 }}>LPO & IPR</h3>
          <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', margin: '0 0 0.75rem' }}>
            LPOs record supplier purchases; IPRs mirror that layout but each line must be a stock item. Save IPRs as draft,
            then finalise to deduct stock. Print PDFs anytime.
          </p>
          <JobInvoiceLpoIprPanel invoice={inv} onInvoiceUpdated={setInv} />
        </div>
      )}
    </>
  );
}
