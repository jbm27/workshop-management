import { useEffect, useState, useCallback } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { api } from '../api';
import JobInvoiceLpoIprPanel from '../components/JobInvoiceLpoIprPanel';
import InvoiceLineVatSelect from '../components/InvoiceLineVatSelect';
import StockItemSearchInput from '../components/StockItemSearchInput';
import { useAdmin } from '../auth/AdminContext';
import { formatStockItemLabel } from '../utils/stockItemLabel';
import { invoiceLineNet, invoiceLineVat, invoiceVatLabel, vatFromFormData, vatFromElementIds, vatModeFromLine } from '../utils/invoiceLineVat';
import { enrichItemsWithSectionTotals, isHeaderLine } from '../utils/invoiceLineSections';
import InvoiceSectionHeaderRow from '../components/InvoiceSectionHeaderRow';
import InvoiceLineDragHandle from '../components/InvoiceLineDragHandle';
import { InvoiceLineSubtextView, InvoiceLineSubtextField } from '../components/InvoiceLineSubtext';
import { InvoiceLineDiscountField, InvoiceLineDiscountView, readLineDiscountPercent } from '../components/InvoiceLineDiscount';
import InvoiceDocumentDiscountPanel from '../components/InvoiceDocumentDiscountPanel';
import InvoiceDocumentNotesPanel from '../components/InvoiceDocumentNotesPanel';
import EditableDocumentNumber from '../components/EditableDocumentNumber';
import { useInvoiceLineDragReorder } from '../hooks/useInvoiceLineDragReorder';

const emptyStockLineDraft = () => ({ query: '', stockItemId: null, unitPrice: '' });

function kes(n) {
  const x = Number(n);
  if (Number.isNaN(x)) return '—';
  return `KES ${x.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}

/** Portal / DB may send 0/1, "0"/"1", or null. */
function isQuoteLineApproved(line) {
  return Number(line?.approved) === 1;
}

function isLabourLine(it) {
  return String(it?.type || '').toLowerCase() === 'labour';
}

export default function InvoiceDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [inv, setInv] = useState(null);
  const [loading, setLoading] = useState(true);
  const [dueDate, setDueDate] = useState('');
  const [savingMeta, setSavingMeta] = useState(false);
  const [payAmount, setPayAmount] = useState('');
  const [payDate, setPayDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [payNotes, setPayNotes] = useState('');
  const [addingPay, setAddingPay] = useState(false);
  const { admin } = useAdmin();
  const canRecordInvoicePayments = admin?.permissions?.can_record_invoice_payments;
  const [customerVehicles, setCustomerVehicles] = useState([]);
  const [fromQuoteVehicleId, setFromQuoteVehicleId] = useState('');
  const [fromQuoteJobNotes, setFromQuoteJobNotes] = useState('');
  const [fromQuoteOrderNumber, setFromQuoteOrderNumber] = useState('');
  const [fromQuoteBusy, setFromQuoteBusy] = useState(false);
  const [addQuoteItem, setAddQuoteItem] = useState(false);
  const [addQuoteHeader, setAddQuoteHeader] = useState(false);
  const [quoteHeaderTitle, setQuoteHeaderTitle] = useState('');
  const [editingItemId, setEditingItemId] = useState(null);
  const [editingHeaderTitle, setEditingHeaderTitle] = useState('');
  const [quoteLineDraft, setQuoteLineDraft] = useState(emptyStockLineDraft);
  const [quoteEditStock, setQuoteEditStock] = useState({ query: '', stockItemId: null });
  const [copyQuoteOpen, setCopyQuoteOpen] = useState(false);
  const [copyQuoteBusy, setCopyQuoteBusy] = useState(false);
  const [copyCustomers, setCopyCustomers] = useState([]);
  const [copyCustomerId, setCopyCustomerId] = useState('');
  const [copyVehicleId, setCopyVehicleId] = useState('');
  const [copyVehicles, setCopyVehicles] = useState([]);
  const isMechanic = Boolean(admin?.is_mechanic);

  const refresh = () =>
    api.invoices.get(id).then((data) => {
      setInv(data);
      setDueDate(data.due_date ? String(data.due_date).slice(0, 10) : '');
    });

  useEffect(() => {
    setLoading(true);
    api.invoices
      .get(id)
      .then((data) => {
        setInv(data);
        setDueDate(data.due_date ? String(data.due_date).slice(0, 10) : '');
      })
      .catch(() => setInv(null))
      .finally(() => setLoading(false));
  }, [id]);

  useEffect(() => {
    if (!editingItemId || !inv?.items) return;
    const it = inv.items.find((x) => x.id === editingItemId);
    if (it && !isLabourLine(it)) {
      setQuoteEditStock({ query: it.description || '', stockItemId: it.stock_item_id || null });
    }
  }, [editingItemId, inv]);

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
      });
      setInv((prev) => (prev ? { ...prev, ...updated } : prev));
    } catch (err) {
      alert(err.message);
    } finally {
      setSavingMeta(false);
    }
  };

  const saveDocumentDiscount = async (fields) => {
    try {
      const updated = await api.invoices.update(id, fields);
      setInv(updated);
    } catch (err) {
      alert(err.message);
      throw err;
    }
  };

  const saveDocumentNotes = async (fields) => {
    try {
      const updated = await api.invoices.update(id, fields);
      setInv(updated);
    } catch (err) {
      alert(err.message);
      throw err;
    }
  };

  const saveInvoiceNumber = async (invoice_number) => {
    const updated = await api.invoices.update(id, { invoice_number });
    setInv(updated);
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
        order_number: fromQuoteOrderNumber.trim() || undefined,
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

  const submitQuoteItem = async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const description = quoteLineDraft.query.trim();
    const quantity = Number(fd.get('quantity')) || 1;
    const unit_price = Number(quoteLineDraft.unitPrice || fd.get('unit_price')) || 0;
    if (!description) return alert('Item description is required');
    let vat;
    try {
      vat = vatFromFormData(fd);
    } catch (err) {
      return alert(err.message);
    }
    try {
      await api.invoices.addItem(id, {
        description,
        quantity,
        unit_price,
        subtext: String(fd.get('subtext') || '').trim() || undefined,
        discount_percent: readLineDiscountPercent(null) || Number(fd.get('discount_percent')) || 0,
        stock_item_id: quoteLineDraft.stockItemId || undefined,
        type: quoteLineDraft.stockItemId ? 'part' : undefined,
        ...vat,
      });
      await refresh();
      setAddQuoteItem(false);
      setQuoteLineDraft(emptyStockLineDraft());
      e.target.reset();
    } catch (err) {
      alert(err.message);
    }
  };

  const updateQuoteItem = async (itemId, data) => {
    try {
      await api.invoices.updateItem(id, itemId, data);
      await refresh();
      setEditingItemId(null);
    } catch (err) {
      alert(err.message);
    }
  };

  const removeQuoteItem = async (itemId) => {
    if (!confirm('Remove this line from the quote?')) return;
    try {
      await api.invoices.deleteItem(id, itemId);
      await refresh();
    } catch (err) {
      alert(err.message);
    }
  };

  const submitQuoteHeader = async (e) => {
    e.preventDefault();
    const title = quoteHeaderTitle.trim();
    if (!title) return alert('Header title is required');
    try {
      await api.invoices.addItem(id, { description: title, type: 'header' });
      await refresh();
      setAddQuoteHeader(false);
      setQuoteHeaderTitle('');
    } catch (err) {
      alert(err.message);
    }
  };

  const openCopyToQuote = () => {
    setCopyCustomerId(inv?.customer_id ? String(inv.customer_id) : '');
    setCopyVehicleId(inv?.vehicle_id ? String(inv.vehicle_id) : '');
    setCopyQuoteOpen(true);
    api.customers.list().then(setCopyCustomers).catch(() => setCopyCustomers([]));
  };

  useEffect(() => {
    if (!copyQuoteOpen || !copyCustomerId) {
      setCopyVehicles([]);
      return;
    }
    api.customers
      .vehicles(copyCustomerId)
      .then(setCopyVehicles)
      .catch(() => setCopyVehicles([]));
  }, [copyQuoteOpen, copyCustomerId]);

  const submitCopyToQuote = async (e) => {
    e.preventDefault();
    if (!copyCustomerId) return alert('Select a customer for the new quote');
    setCopyQuoteBusy(true);
    try {
      const created = await api.invoices.copyToQuote(id, {
        customer_id: Number(copyCustomerId),
        vehicle_id: copyVehicleId ? Number(copyVehicleId) : null,
      });
      setCopyQuoteOpen(false);
      navigate(`/invoices/${created.id}`);
    } catch (err) {
      alert(err.message);
    } finally {
      setCopyQuoteBusy(false);
    }
  };

  const lineDragDisabled =
    !inv ||
    inv.type !== 'quote' ||
    !!inv.job_id ||
    !!editingItemId ||
    addQuoteItem ||
    addQuoteHeader;

  const persistLineReorder = useCallback(
    async (reordered) => {
      if (!id) return;
      setInv((prev) => (prev ? { ...prev, items: reordered } : prev));
      try {
        const updated = await api.invoices.reorderItems(id, reordered.map((i) => i.id));
        setInv(updated);
      } catch (err) {
        const refreshed = await api.invoices.get(id);
        setInv(refreshed);
        alert(err.message);
      }
    },
    [id],
  );

  const lineDrag = useInvoiceLineDragReorder({
    items: inv?.items || [],
    disabled: lineDragDisabled,
    onReorder: persistLineReorder,
  });

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
  const canEditQuoteLines = isQuote && !inv.job_id;
  const quoteApprovedCount = isQuote ? items.filter((it) => !isHeaderLine(it) && isQuoteLineApproved(it)).length : 0;
  const quoteLineCount = isQuote ? items.filter((it) => !isHeaderLine(it)).length : 0;
  const dueDateDirty = (inv.due_date ? String(inv.due_date).slice(0, 10) : '') !== dueDate;

  return (
    <>
      <div style={{ marginBottom: '1rem' }}>
        <Link to="/invoices">← Invoices & quotes</Link>
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'flex-start', gap: '1rem', marginBottom: '1.5rem' }}>
        <h1 className="page-title" style={{ margin: 0 }}>
          {isMechanic ? (
            inv.invoice_number
          ) : (
            <EditableDocumentNumber
              value={inv.invoice_number}
              onSave={saveInvoiceNumber}
              hint="Must be unique — match your physical booklet number if needed."
            />
          )}{' '}
          <span className={`badge ${inv.type}`} style={{ fontSize: '0.85rem', verticalAlign: 'middle' }}>
            {inv.type}
          </span>
        </h1>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
          {(isQuote || inv.type === 'invoice') && (
            <button type="button" className="btn" onClick={openCopyToQuote}>
              Copy to quote
            </button>
          )}
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
          {inv.customer_company_name ? (
            <>
              <p><strong>{inv.customer_company_name}</strong></p>
              {inv.customer_name && (
                <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>{inv.customer_name}</p>
              )}
            </>
          ) : (
            <p><strong>{inv.customer_name || '—'}</strong></p>
          )}
          {inv.customer_registration_number && (
            <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>Reg: {inv.customer_registration_number}</p>
          )}
          {inv.customer_email && <p>{inv.customer_email}</p>}
          {inv.customer_phone && <p>{inv.customer_phone}</p>}
          {inv.customer_address && <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>{inv.customer_address}</p>}
          {!isQuote && inv.job_order_number && (
            <p style={{ marginTop: '0.75rem' }}>
              <strong>Order no:</strong> {inv.job_order_number}
            </p>
          )}
        </div>
        <div className="card">
          <h3 style={{ marginTop: 0 }}>Vehicle</h3>
          {inv.registration || inv.make || inv.model ? (
            <p><strong>{[inv.registration, inv.make, inv.model].filter(Boolean).join(' ')}</strong></p>
          ) : (
            <p style={{ color: 'var(--text-muted)' }}>No vehicle linked</p>
          )}
          {inv.vin && (
            <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', marginTop: '0.35rem' }}>VIN: {inv.vin}</p>
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
              <label>Order number (optional)</label>
              <input
                value={fromQuoteOrderNumber}
                onChange={(e) => setFromQuoteOrderNumber(e.target.value)}
                placeholder="Customer PO / order number for the invoice"
              />
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
        <h3 style={{ marginTop: 0 }}>Due date</h3>
        <div className="form-group" style={{ margin: 0, maxWidth: '240px' }}>
          <label>Due date</label>
          <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
        </div>
        {dueDateDirty && (
          <button type="button" className="btn primary" style={{ marginTop: '1rem' }} onClick={saveMeta} disabled={savingMeta}>
            {savingMeta ? 'Saving…' : 'Save due date'}
          </button>
        )}
      </div>

      <InvoiceDocumentNotesPanel
        document={inv}
        title={isQuote ? 'Quote notes' : 'Invoice notes'}
        onSave={saveDocumentNotes}
      />

      <div className="card">
        <h3 style={{ marginTop: 0 }}>Line items</h3>
        {canEditQuoteLines && (
          <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', margin: '0 0 0.75rem' }}>
            The <strong>Labour</strong> line is always quantity <strong>1</strong>; enter the quoted labour{' '}
            <strong>sale (ex VAT)</strong> as that line unit price. Choose VAT per line below. Drag the <strong>⋮⋮</strong> handle to reorder lines and section headers.
          </p>
        )}
        {isQuote && items.length > 0 && (
          <p style={{ margin: '0 0 0.75rem', fontSize: '0.88rem', color: 'var(--text-muted)' }}>
            Customer portal: <strong>{quoteApprovedCount}</strong> of <strong>{quoteLineCount}</strong> line
            {quoteLineCount === 1 ? '' : 's'} approved. Refresh the page after the customer approves to see updates.
          </p>
        )}
        {canEditQuoteLines && addQuoteItem && (
          <form
            onSubmit={submitQuoteItem}
            style={{ marginBottom: '1rem', padding: '1rem', background: 'var(--bg)', borderRadius: 'var(--radius)' }}
          >
            <div
              style={{ display: 'grid', gridTemplateColumns: '1fr 80px 100px 140px auto', gap: '0.5rem', alignItems: 'end' }}
              className="form-row-quote"
            >
              <div className="form-group" style={{ margin: 0 }}>
                <label>Store item / description</label>
                <StockItemSearchInput
                  query={quoteLineDraft.query}
                  onQueryChange={(q) => setQuoteLineDraft((d) => ({ ...d, query: q, stockItemId: null }))}
                  selectedStockItemId={quoteLineDraft.stockItemId}
                  onSelect={(item) =>
                    setQuoteLineDraft({
                      query: formatStockItemLabel(item),
                      stockItemId: item.id,
                      unitPrice: item.sell_price != null ? String(item.sell_price) : '',
                    })
                  }
                  placeholder="Search store or type description…"
                  required
                />
              </div>
              <div className="form-group" style={{ margin: 0 }}>
                <label>Qty</label>
                <input type="number" name="quantity" min="0.01" step="0.01" defaultValue="1" />
              </div>
              <div className="form-group" style={{ margin: 0 }}>
                <label>Sale (ex VAT)</label>
                <input
                  type="number"
                  name="unit_price"
                  min="0"
                  step="0.01"
                  required
                  value={quoteLineDraft.unitPrice}
                  onChange={(e) => setQuoteLineDraft((d) => ({ ...d, unitPrice: e.target.value }))}
                  placeholder="0"
                />
                <InvoiceLineDiscountField />
              </div>
              <div className="form-group" style={{ margin: 0 }}>
                <label>VAT</label>
                <InvoiceLineVatSelect />
              </div>
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <button type="submit" className="btn primary">Add</button>
                <button type="button" className="btn" onClick={() => { setAddQuoteItem(false); setQuoteLineDraft(emptyStockLineDraft()); }}>Cancel</button>
              </div>
            </div>
            <InvoiceLineSubtextField />
          </form>
        )}
        {canEditQuoteLines && addQuoteHeader && (
          <form
            onSubmit={submitQuoteHeader}
            style={{ marginBottom: '1rem', padding: '1rem', background: 'var(--bg)', borderRadius: 'var(--radius)' }}
          >
            <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'end', flexWrap: 'wrap' }}>
              <div className="form-group" style={{ margin: 0, flex: '1 1 200px' }}>
                <label>Section header</label>
                <input
                  value={quoteHeaderTitle}
                  onChange={(e) => setQuoteHeaderTitle(e.target.value)}
                  placeholder="e.g. FOR CFL - JAN"
                  required
                />
              </div>
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <button type="submit" className="btn primary">Add header</button>
                <button type="button" className="btn" onClick={() => { setAddQuoteHeader(false); setQuoteHeaderTitle(''); }}>Cancel</button>
              </div>
            </div>
          </form>
        )}
        {canEditQuoteLines && !addQuoteItem && !addQuoteHeader && (
          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap', marginBottom: '1rem' }}>
            <button type="button" className="btn" onClick={() => setAddQuoteItem(true)}>+ Item</button>
            <span style={{ color: 'var(--border)' }}>|</span>
            <button type="button" className="btn" onClick={() => setAddQuoteHeader(true)}>+ Header</button>
          </div>
        )}
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                {canEditQuoteLines && <th style={{ width: '1.75rem' }} aria-label="Reorder" />}
                <th>Description</th>
                {isQuote && <th>Customer approved</th>}
                <th>Qty</th>
                {!isQuote && <th>Purchase (unit)</th>}
                <th>Unit price (ex VAT)</th>
                <th>VAT</th>
                <th>Line total (ex VAT)</th>
                {canEditQuoteLines && <th></th>}
              </tr>
            </thead>
            <tbody>
              {items.length === 0 && (
                <tr>
                  <td colSpan={(canEditQuoteLines ? 8 : isQuote ? 6 : 6)} className="empty">
                    {canEditQuoteLines ? 'No quote lines yet. Add items above.' : 'No line items yet'}
                  </td>
                </tr>
              )}
              {enrichItemsWithSectionTotals(items).map((row) => {
                if (row.kind === 'header') {
                  const it = row.item;
                  return (
                    <InvoiceSectionHeaderRow
                      key={it.id}
                      item={it}
                      sectionNet={row.sectionNet}
                      labelColSpan={5}
                      formatMoney={kes}
                      editable={canEditQuoteLines}
                      editing={editingItemId === it.id}
                      editTitle={editingHeaderTitle}
                      onEditTitleChange={setEditingHeaderTitle}
                      onStartEdit={() => {
                        setEditingItemId(it.id);
                        setEditingHeaderTitle(it.description || '');
                      }}
                      onSave={() => {
                        const title = editingHeaderTitle.trim();
                        if (!title) return alert('Header title is required');
                        updateQuoteItem(it.id, { description: title });
                      }}
                      onCancel={() => {
                        setEditingItemId(null);
                        setEditingHeaderTitle('');
                      }}
                      onRemove={() => removeQuoteItem(it.id)}
                      sortable={canEditQuoteLines && lineDrag.sortable}
                      dragHandle={
                        canEditQuoteLines ? (
                          <InvoiceLineDragHandle
                            disabled={!lineDrag.sortable}
                            onDragStart={lineDrag.handleDragStart(it.id)}
                            onDragEnd={lineDrag.handleDragEnd}
                          />
                        ) : null
                      }
                      rowProps={canEditQuoteLines ? lineDrag.rowProps(it.id) : undefined}
                    />
                  );
                }
                const it = row.item;
                const labour = isLabourLine(it);
                const qty = labour ? 1 : Number(it.quantity) || 0;
                const price = Number(it.unit_price) || 0;
                if (canEditQuoteLines && editingItemId === it.id) {
                  return (
                    <tr key={it.id} {...lineDrag.rowProps(it.id)}>
                      <InvoiceLineDragHandle
                        disabled={!lineDrag.sortable}
                        onDragStart={lineDrag.handleDragStart(it.id)}
                        onDragEnd={lineDrag.handleDragEnd}
                      />
                      <td>
                        {labour ? (
                          <span style={{ fontWeight: 600 }}>Labour</span>
                        ) : (
                          <StockItemSearchInput
                            query={quoteEditStock.query}
                            onQueryChange={(q) => setQuoteEditStock((s) => ({ ...s, query: q, stockItemId: null }))}
                            selectedStockItemId={quoteEditStock.stockItemId}
                            onSelect={(item) =>
                              setQuoteEditStock({
                                query: formatStockItemLabel(item),
                                stockItemId: item.id,
                              })
                            }
                            placeholder="Search store or type description…"
                          />
                        )}
                        <InvoiceLineSubtextField id={`item-subtext-${it.id}`} defaultValue={it.subtext} />
                      </td>
                      <td style={{ whiteSpace: 'nowrap' }}>
                        {isQuoteLineApproved(it) ? (
                          <span style={{ color: 'var(--success)', fontWeight: 600 }}>Yes</span>
                        ) : (
                          <span style={{ color: 'var(--text-muted)' }}>Pending</span>
                        )}
                      </td>
                      <td>
                        {labour ? (
                          <span>1</span>
                        ) : (
                          <input
                            type="number"
                            id={`qty-${it.id}`}
                            min="0.01"
                            step="0.01"
                            defaultValue={it.quantity}
                            style={{ width: '4rem' }}
                          />
                        )}
                      </td>
                      <td>
                        <input
                          type="number"
                          id={`sale-${it.id}`}
                          min="0"
                          step="0.01"
                          defaultValue={it.unit_price}
                          style={{ width: '5rem' }}
                        />
                        <InvoiceLineDiscountField id={`item-discount-${it.id}`} defaultValue={it.discount_percent} />
                      </td>
                      <td>
                        <InvoiceLineVatSelect idPrefix={`item-${it.id}`} defaultFields={vatModeFromLine(it)} />
                      </td>
                      <td>—</td>
                      <td>
                        <button
                          type="button"
                          className="btn primary"
                          onClick={() => {
                            let vat;
                            try {
                              vat = vatFromElementIds(`item-${it.id}`);
                            } catch (err) {
                              alert(err.message);
                              return;
                            }
                            const sale = Number(document.getElementById(`sale-${it.id}`)?.value) ?? it.unit_price;
                            const subtextVal = String(document.getElementById(`item-subtext-${it.id}`)?.value || '').trim();
                            const subtextPayload = subtextVal ? subtextVal : null;
                            const lineDiscount = readLineDiscountPercent(`item-discount-${it.id}`);
                            if (labour) {
                              updateQuoteItem(it.id, { unit_price: sale, subtext: subtextPayload, discount_percent: lineDiscount, ...vat });
                              return;
                            }
                            const desc = quoteEditStock.query.trim();
                            const itemQty = Number(document.getElementById(`qty-${it.id}`)?.value) || 1;
                            if (desc) {
                              updateQuoteItem(it.id, {
                                description: desc,
                                quantity: itemQty,
                                unit_price: sale,
                                stock_item_id: quoteEditStock.stockItemId,
                                subtext: subtextPayload,
                                discount_percent: lineDiscount,
                                ...vat,
                              });
                            }
                          }}
                        >
                          Save
                        </button>
                        <button type="button" className="btn" onClick={() => setEditingItemId(null)}>Cancel</button>
                      </td>
                    </tr>
                  );
                }
                return (
                  <tr key={it.id} {...(canEditQuoteLines ? lineDrag.rowProps(it.id) : {})}>
                    {canEditQuoteLines && (
                      <InvoiceLineDragHandle
                        disabled={!lineDrag.sortable}
                        onDragStart={lineDrag.handleDragStart(it.id)}
                        onDragEnd={lineDrag.handleDragEnd}
                      />
                    )}
                    <td>
                      {labour ? <strong>Labour</strong> : it.description}
                      <InvoiceLineSubtextView subtext={it.subtext} />
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
                    <td>
                      {kes(price)}
                      <InvoiceLineDiscountView discountPercent={it.discount_percent} />
                    </td>
                    <td style={{ whiteSpace: 'nowrap' }}>{invoiceVatLabel(it)}</td>
                    <td>{kes(invoiceLineNet(it))}</td>
                    {canEditQuoteLines && (
                      <td>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.35rem', alignItems: 'center' }}>
                          <button type="button" className="btn" onClick={() => setEditingItemId(it.id)}>Edit</button>
                          {!labour && (
                            <button type="button" className="btn danger" onClick={() => removeQuoteItem(it.id)}>
                              Remove
                            </button>
                          )}
                        </div>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {items.length > 0 && (
          <InvoiceDocumentDiscountPanel
            document={inv}
            title={isQuote ? 'Quote discount' : 'Invoice discount'}
            onSave={saveDocumentDiscount}
          />
        )}
        <div style={{ marginTop: '1rem', textAlign: 'right', maxWidth: '280px', marginLeft: 'auto' }}>
          <p style={{ margin: '0.25rem 0' }}>Subtotal (ex VAT) <strong>{kes(subtotal)}</strong></p>
          <p style={{ margin: '0.25rem 0', color: 'var(--text-muted)' }}>
            VAT <strong>{kes(tax)}</strong></p>
          <p style={{ margin: '0.5rem 0 0', fontSize: '1.1rem' }}>Total (inc VAT) <strong>{kes(total)}</strong></p>
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

      {copyQuoteOpen && (
        <div className="modal-overlay" onClick={() => !copyQuoteBusy && setCopyQuoteOpen(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '480px' }}>
            <header>Copy to new quote</header>
            <form className="body" onSubmit={submitCopyToQuote}>
              <p style={{ margin: '0 0 1rem', fontSize: '0.9rem', color: 'var(--text-muted)' }}>
                Creates a new standalone quote with the same line items. Choose the customer (and vehicle) for the new quote.
              </p>
              <div className="form-group">
                <label>Customer *</label>
                <select
                  value={copyCustomerId}
                  onChange={(e) => {
                    setCopyCustomerId(e.target.value);
                    setCopyVehicleId('');
                  }}
                  required
                >
                  <option value="">— Select customer —</option>
                  {copyCustomers.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.company_name ? `${c.company_name}${c.name ? ` · ${c.name}` : ''}` : c.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="form-group">
                <label>Vehicle (optional)</label>
                <select value={copyVehicleId} onChange={(e) => setCopyVehicleId(e.target.value)}>
                  <option value="">— None —</option>
                  {copyVehicles.map((v) => (
                    <option key={v.id} value={v.id}>
                      {[v.registration, v.make, v.model].filter(Boolean).join(' ') || `Vehicle #${v.id}`}
                    </option>
                  ))}
                </select>
              </div>
            </form>
            <footer>
              <button type="button" className="btn" onClick={() => setCopyQuoteOpen(false)} disabled={copyQuoteBusy}>
                Cancel
              </button>
              <button type="submit" className="btn primary" onClick={submitCopyToQuote} disabled={copyQuoteBusy}>
                {copyQuoteBusy ? 'Creating…' : 'Create quote'}
              </button>
            </footer>
          </div>
        </div>
      )}
    </>
  );
}
