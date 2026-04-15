import { useEffect, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { api } from '../api';
import JobInvoiceLpoIprPanel from '../components/JobInvoiceLpoIprPanel';
import { useAdmin } from '../auth/AdminContext';
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

const UNAPPROVED_QUOTE_WARNING =
  'Customer approval has not been given for one or more items on the quote. Are you sure you want to continue?';

const INVOICE_EDIT_QUOTE_APPROVAL_WARNING =
  'Customer approval has not been sought for this item on the quote. Are you sure you want to continue?';
const VALUABLE_ITEMS = ['Spare wheel', 'Wheel caps', 'Jack', 'Wheel spanner', 'Tool kit', '1st aid kit'];

function parseValuables(value) {
  const raw = String(value || '').trim();
  if (!raw) return { selected: new Set(), notes: '' };

  const selected = new Set();
  const checklistMatch = raw.match(/Checklist:\s*([^\n\r]*)/i);
  if (checklistMatch?.[1]) {
    checklistMatch[1]
      .split(';')
      .map((s) => s.trim())
      .filter(Boolean)
      .forEach((item) => {
        const canonical = VALUABLE_ITEMS.find((v) => v.toLowerCase() === item.toLowerCase());
        if (canonical) selected.add(canonical);
      });
  } else {
    VALUABLE_ITEMS.forEach((item) => {
      if (new RegExp(`\\b${item.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(raw)) {
        selected.add(item);
      }
    });
  }

  const notesMatch = raw.match(/Notes:\s*([\s\S]*)$/i);
  let notes = notesMatch?.[1]?.trim() || '';
  if (!checklistMatch && !notesMatch) notes = raw;

  return { selected, notes };
}

function buildValuablesPayload(checks, notes) {
  const selectedItems = VALUABLE_ITEMS.filter((item) => !!checks?.[item]);
  const parts = [];
  if (selectedItems.length) parts.push(`Checklist: ${selectedItems.join('; ')}`);
  const noteText = String(notes || '').trim();
  if (noteText) parts.push(`Notes: ${noteText}`);
  return parts.join('\n');
}

function quoteLines(q) {
  return q?.items || [];
}

/** Quote item approved in portal (DB may send 0/1, "0"/"1", or null). */
function isQuoteLineApproved(line) {
  return Number(line?.approved) === 1;
}

function hasUnapprovedQuoteLines(q) {
  return quoteLines(q).some((line) => !isQuoteLineApproved(line));
}

function descriptionMatchesUnapprovedQuote(q, description) {
  if (!q || !description) return false;
  const d = description.trim().toLowerCase();
  return quoteLines(q).some(
    (line) => !isQuoteLineApproved(line) && (line.description || '').trim().toLowerCase() === d,
  );
}

function isLabourLine(it) {
  return String(it?.type || '').toLowerCase() === 'labour';
}

export default function JobDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [job, setJob] = useState(null);
  const [loading, setLoading] = useState(true);
  const [statusMenuKey, setStatusMenuKey] = useState(0);
  const [readings, setReadings] = useState({
    odometer_in: '',
    odometer_out: '',
    fuel_in: '',
    fuel_out: '',
    valuables_in_vehicle: '',
  });
  const [readingsDirty, setReadingsDirty] = useState(false);
  const [valuablesChecks, setValuablesChecks] = useState({});
  const [valuablesNotes, setValuablesNotes] = useState('');
  const [closeJobModal, setCloseJobModal] = useState(false);
  const [closeReadings, setCloseReadings] = useState({ odometer_out: '', fuel_out: '' });
  const [tasks, setTasks] = useState([]);
  const [tasksDirty, setTasksDirty] = useState(false);
  const [quote, setQuote] = useState(null);
  const [quoteLoading, setQuoteLoading] = useState(true);
  const [addQuoteItem, setAddQuoteItem] = useState(false);
  const [editingItemId, setEditingItemId] = useState(null);
  const [invoice, setInvoice] = useState(null);
  const [invoiceLoading, setInvoiceLoading] = useState(true);
  const [addInvoiceItem, setAddInvoiceItem] = useState(false);
  const [editingInvoiceItemId, setEditingInvoiceItemId] = useState(null);
  const [testDriveOdo, setTestDriveOdo] = useState('');
  const [testDriveFuel, setTestDriveFuel] = useState('');
  const [testDriveBusy, setTestDriveBusy] = useState(false);
  const [payAmount, setPayAmount] = useState('');
  const [payDate, setPayDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [payNotes, setPayNotes] = useState('');
  const [addingPay, setAddingPay] = useState(false);

  const { admin } = useAdmin();
  const canRecordInvoicePayments = admin?.permissions?.can_record_invoice_payments;

  useEffect(() => {
    api.jobs.get(id).then((j) => {
      const parsedValuables = parseValuables(j.valuables_in_vehicle);
      const nextChecks = {};
      VALUABLE_ITEMS.forEach((item) => {
        nextChecks[item] = parsedValuables.selected.has(item);
      });
      setJob(j);
      setReadings({
        odometer_in: j.odometer_in ?? '',
        odometer_out: j.odometer_out ?? '',
        fuel_in: j.fuel_in ?? '',
        fuel_out: j.fuel_out ?? '',
        valuables_in_vehicle: j.valuables_in_vehicle ?? '',
      });
      setValuablesChecks(nextChecks);
      setValuablesNotes(parsedValuables.notes || '');
      setTasks((j.tasks || []).map((t) => ({
        description: t.description || (typeof t === 'string' ? t : ''),
        completed: !!t.completed,
      })));
    }).catch(() => setJob(null)).finally(() => setLoading(false));
  }, [id]);

  useEffect(() => {
    if (!id) return;
    setQuoteLoading(true);
    api.invoices
      .list({ job_id: id, type: 'quote' })
      .then((list) => (list.length ? api.invoices.get(list[0].id) : null))
      .then(setQuote)
      .catch(() => setQuote(null))
      .finally(() => setQuoteLoading(false));
  }, [id]);

  useEffect(() => {
    if (!id) return;
    setInvoiceLoading(true);
    api.invoices
      .list({ job_id: id, type: 'invoice' })
      .then((list) => (list.length ? api.invoices.get(list[0].id) : null))
      .then(setInvoice)
      .catch(() => setInvoice(null))
      .finally(() => setInvoiceLoading(false));
  }, [id]);

  const updateStatus = async (newStatus) => {
    if (newStatus === 'completed') {
      setCloseReadings({ odometer_out: job.odometer_out ?? '', fuel_out: job.fuel_out ?? '' });
      setCloseJobModal(true);
      return;
    }
    try {
      await api.jobs.update(id, { status: newStatus, completed_at: null });
      setJob((j) => ({ ...j, status: newStatus }));
    } catch (err) {
      alert(err.message);
    }
  };

  const submitCloseJob = async () => {
    try {
      await api.jobs.update(id, {
        status: 'completed',
        completed_at: new Date().toISOString(),
        odometer_out: closeReadings.odometer_out ? Number(closeReadings.odometer_out) : null,
        fuel_out: closeReadings.fuel_out || null,
      });
      const j = await api.jobs.get(id);
      setJob(j);
      setReadings((r) => ({
        ...r,
        odometer_out: closeReadings.odometer_out,
        fuel_out: closeReadings.fuel_out,
      }));
      setCloseJobModal(false);
    } catch (err) {
      alert(err.message);
    }
  };

  const submitTestDrive = async (e) => {
    e?.preventDefault?.();
    const odo = Number(testDriveOdo);
    if (!Number.isFinite(odo) || odo < 0) return alert('Enter mileage in (km) when the vehicle returns to the workshop');
    if (!testDriveFuel) return alert('Select fuel in on return');
    setTestDriveBusy(true);
    try {
      const j = await api.jobs.addTestDrive(id, { odometer: odo, fuel: testDriveFuel });
      setJob(j);
      setTestDriveOdo('');
      setTestDriveFuel('');
    } catch (err) {
      alert(err.message);
    } finally {
      setTestDriveBusy(false);
    }
  };

  const addTask = () => { setTasks((t) => [...t, { description: '', completed: false }]); setTasksDirty(true); };
  const updateTask = (i, value) => {
    setTasks((t) => t.map((x, j) => (j === i ? { ...x, description: value } : x)));
    setTasksDirty(true);
  };
  const toggleTaskCompleted = (i) => {
    setTasks((t) => t.map((x, j) => (j === i ? { ...x, completed: !x.completed } : x)));
    setTasksDirty(true);
  };
  const removeTask = (i) => { setTasks((t) => t.filter((_, j) => j !== i)); setTasksDirty(true); };

  const saveTasks = async () => {
    const taskList = tasks
      .filter((t) => t && String(t.description).trim())
      .map((t) => ({ description: String(t.description).trim(), completed: !!t.completed }));
    try {
      const updated = await api.jobs.update(id, { tasks: taskList });
      setJob(updated);
      setTasks((updated.tasks || []).map((t) => ({
        description: t.description || (typeof t === 'string' ? t : ''),
        completed: !!t.completed,
      })));
      setTasksDirty(false);
    } catch (err) {
      alert(err.message);
    }
  };

  const saveReadings = async () => {
    const mileageInLocked = job.odometer_in != null;
    const fuelInLocked = job.fuel_in != null && String(job.fuel_in).trim() !== '';
    try {
      const updated = await api.jobs.update(id, {
        odometer_in: mileageInLocked
          ? job.odometer_in
          : readings.odometer_in
            ? Number(readings.odometer_in)
            : null,
        odometer_out: readings.odometer_out ? Number(readings.odometer_out) : null,
        fuel_in: fuelInLocked ? job.fuel_in : readings.fuel_in || null,
        fuel_out: readings.fuel_out || null,
        valuables_in_vehicle: buildValuablesPayload(valuablesChecks, valuablesNotes) || null,
      });
      const parsedValuables = parseValuables(updated.valuables_in_vehicle);
      const nextChecks = {};
      VALUABLE_ITEMS.forEach((item) => {
        nextChecks[item] = parsedValuables.selected.has(item);
      });
      setJob(updated);
      setReadings({
        odometer_in: updated.odometer_in ?? '',
        odometer_out: updated.odometer_out ?? '',
        fuel_in: updated.fuel_in ?? '',
        fuel_out: updated.fuel_out ?? '',
        valuables_in_vehicle: updated.valuables_in_vehicle ?? '',
      });
      setValuablesChecks(nextChecks);
      setValuablesNotes(parsedValuables.notes || '');
      setReadingsDirty(false);
    } catch (err) {
      alert(err.message);
    }
  };

  const createQuote = async () => {
    try {
      const q = await api.jobs.createQuote(id);
      setQuote(q);
    } catch (err) {
      alert(err.message);
    }
  };

  const createInvoice = async () => {
    try {
      const inv = await api.jobs.createInvoice(id);
      setInvoice(inv);
    } catch (err) {
      alert(err.message);
    }
  };

  const submitQuoteItem = async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const description = fd.get('description')?.trim();
    const quantity = Number(fd.get('quantity')) || 1;
    const unit_price = Number(fd.get('unit_price')) || 0;
    if (!description) return alert('Item description is required');
    try {
      await api.invoices.addItem(quote.id, { description, quantity, unit_price });
      const inv = await api.invoices.get(quote.id);
      setQuote(inv);
      setAddQuoteItem(false);
      e.target.reset();
    } catch (err) {
      alert(err.message);
    }
  };

  const updateQuoteItem = async (itemId, data) => {
    try {
      await api.invoices.updateItem(quote.id, itemId, data);
      const inv = await api.invoices.get(quote.id);
      setQuote(inv);
      setEditingItemId(null);
    } catch (err) {
      alert(err.message);
    }
  };

  const removeQuoteItem = async (itemId) => {
    if (!confirm('Remove this line from the quote?')) return;
    try {
      await api.invoices.deleteItem(quote.id, itemId);
      setQuote((q) => ({ ...q, items: q.items.filter((i) => i.id !== itemId) }));
      const inv = await api.invoices.get(quote.id);
      setQuote(inv);
    } catch (err) {
      alert(err.message);
    }
  };

  const submitInvoiceItem = async (e) => {
    e.preventDefault();
    if (!invoice) return;
    const fd = new FormData(e.target);
    const description = fd.get('description')?.trim();
    const quantity = Number(fd.get('quantity')) || 1;
    const purchase_price = Number(fd.get('purchase_price')) || 0;
    const unit_price = Number(fd.get('unit_price')) || 0;
    if (!description) return alert('Item description is required');
    if (descriptionMatchesUnapprovedQuote(quote, description) && !window.confirm(UNAPPROVED_QUOTE_WARNING)) {
      return;
    }
    try {
      await api.invoices.addItem(invoice.id, { description, quantity, unit_price, purchase_price });
      const inv = await api.invoices.get(invoice.id);
      setInvoice(inv);
      setAddInvoiceItem(false);
      e.target.reset();
    } catch (err) {
      alert(err.message);
    }
  };

  const updateInvoiceItem = async (itemId, data) => {
    if (!invoice) return;
    const row = invoice.items.find((x) => x.id === itemId);
    if (!row) return;
    const descAfter = (
      data?.description != null ? String(data.description) : row.description || ''
    ).trim();
    if (quote) {
      const matchesUnapproved = descriptionMatchesUnapprovedQuote(quote, descAfter);
      const anyUnapproved = hasUnapprovedQuoteLines(quote);
      if (matchesUnapproved) {
        if (!window.confirm(INVOICE_EDIT_QUOTE_APPROVAL_WARNING)) return;
      } else if (anyUnapproved) {
        if (!window.confirm(UNAPPROVED_QUOTE_WARNING)) return;
      }
    }
    try {
      await api.invoices.updateItem(invoice.id, itemId, data);
      const inv = await api.invoices.get(invoice.id);
      setInvoice(inv);
      setEditingInvoiceItemId(null);
    } catch (err) {
      alert(err.message);
    }
  };

  const removeInvoiceItem = async (itemId) => {
    if (!invoice) return;
    if (!confirm('Remove this line from the invoice?')) return;
    try {
      await api.invoices.deleteItem(invoice.id, itemId);
      const inv = await api.invoices.get(invoice.id);
      setInvoice(inv);
    } catch (err) {
      alert(err.message);
    }
  };

  const addQuoteLineToInvoice = async (line) => {
    if (!invoice) {
      alert('Create an invoice first (see Invoice section above).');
      return;
    }
    if (String(line.type || '').toLowerCase() === 'labour') {
      alert('Labour is already on the job invoice and stays in sync with time logs; you do not need to copy it from the quote.');
      return;
    }
    if (!isQuoteLineApproved(line) && !window.confirm(UNAPPROVED_QUOTE_WARNING)) return;
    try {
      await api.invoices.addItem(invoice.id, {
        description: line.description,
        quantity: line.quantity ?? 1,
        unit_price: line.unit_price ?? 0,
      });
      const inv = await api.invoices.get(invoice.id);
      setInvoice(inv);
    } catch (err) {
      alert(err.message);
    }
  };

  const refreshInvoice = async () => {
    if (!invoice?.id) return;
    const inv = await api.invoices.get(invoice.id);
    setInvoice(inv);
  };

  const addCustomerPayment = async (e) => {
    e.preventDefault();
    if (!invoice?.id) return;
    if (!canRecordInvoicePayments) return alert('You do not have permission to record payments');
    const amount = Number(payAmount);
    if (!amount || amount <= 0) return alert('Enter a positive amount');
    setAddingPay(true);
    try {
      const updated = await api.invoices.addPayment(invoice.id, {
        amount,
        paid_at: payDate ? `${payDate}T12:00:00` : undefined,
        notes: payNotes.trim() || undefined,
      });
      setInvoice(updated);
      setPayAmount('');
      setPayNotes('');
      setPayDate(new Date().toISOString().slice(0, 10));
    } catch (err) {
      alert(err.message);
    } finally {
      setAddingPay(false);
    }
  };

  const removeCustomerPayment = async (paymentId) => {
    if (!invoice?.id) return;
    if (!canRecordInvoicePayments) return alert('You do not have permission to remove payments');
    if (!confirm('Remove this payment record?')) return;
    try {
      await api.invoices.deletePayment(invoice.id, paymentId);
      await refreshInvoice();
    } catch (err) {
      alert(err.message);
    }
  };


  const copyQuoteToInvoice = async () => {
    if (!quote || !invoice) {
      alert('You need both a quote and an invoice to copy items.');
      return;
    }
    if (!quote.items || !quote.items.length) {
      alert('No items on the quote to copy.');
      return;
    }
    if (hasUnapprovedQuoteLines(quote) && !window.confirm(UNAPPROVED_QUOTE_WARNING)) return;
    if (!confirm('Copy all quote items into the invoice? This will add them to any existing invoice lines.')) return;
    try {
      const toCopy = quote.items.filter((it) => String(it.type || '').toLowerCase() !== 'labour');
      for (const it of toCopy) {
        await api.invoices.addItem(invoice.id, {
          description: it.description,
          quantity: it.quantity ?? 1,
          unit_price: it.unit_price ?? 0,
        });
      }
      const inv = await api.invoices.get(invoice.id);
      setInvoice(inv);
    } catch (err) {
      alert(err.message);
    }
  };

  const fuelOptions = ['', 'Empty', '1/4', '1/2', '3/4', 'Full'];

  const formatKes = (n) => {
    const x = Number(n);
    if (Number.isNaN(x)) return '—';
    return `KES ${x.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
  };

  const invoicePaidTotal = invoice
    ? Number(
        invoice.amount_paid
        ?? (invoice.payments || []).reduce((s, p) => s + Number(p.amount || 0), 0),
      ) || 0
    : 0;
  const invoiceBalance =
    invoice != null
      ? (invoice.balance != null
        ? Number(invoice.balance)
        : Number(invoice.total || 0) - invoicePaidTotal)
      : null;

  if (loading) return <div className="page-title">Loading…</div>;
  if (!job) return <div className="page-title">Job not found. <Link to="/jobs">Back to jobs</Link></div>;

  const testDrivesList = job.test_drives || [];
  const mileageInLocked = job.odometer_in != null;
  const fuelInLocked = job.fuel_in != null && String(job.fuel_in).trim() !== '';
  const canAddTestDrive = mileageInLocked;
  const tdComputed = testDriveComputedRows(testDrivesList, job.odometer_in, job.fuel_in);
  const ho = handoverComputed(
    testDrivesList,
    job.odometer_in,
    job.fuel_in,
    readings.odometer_out,
    readings.fuel_out,
  );

  const rowStyle = {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: '0.35rem 0.65rem',
    marginBottom: '0.55rem',
    fontSize: '0.9rem',
    lineHeight: 1.45,
  };
  const inlineInp = { width: '5.25rem', padding: '0.2rem 0.35rem', fontSize: '0.9rem' };
  const inlineSel = { padding: '0.2rem 0.35rem', fontSize: '0.9rem', minWidth: '4.5rem' };

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '1.5rem', flexWrap: 'wrap' }}>
        <h1 className="page-title" style={{ margin: 0 }}>{job.job_number}</h1>
        <Link to="/jobs" className="btn">← Jobs</Link>
        <span className={`badge ${job.status}`}>{jobStatusLabel(job.status)}</span>
        <select
          key={`${job.id}-${job.status}-${statusMenuKey}`}
          aria-label="Change job status"
          defaultValue=""
          onChange={(e) => {
            const v = e.target.value;
            if (v) updateStatus(v);
          }}
          className="btn"
          style={{ width: 'auto' }}
        >
          <option value="">Change status…</option>
          <option value="in_progress">In progress</option>
          <option value="vehicle_released">Vehicle released</option>
          <option value="completed">Complete</option>
          <option value="cancelled">Cancelled</option>
        </select>
      </div>

      {closeJobModal && (
        <div className="modal-overlay" onClick={() => { setCloseJobModal(false); setStatusMenuKey((k) => k + 1); }}>
          <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '400px' }}>
            <header>Close job – final readings</header>
            <div className="body">
              <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', marginBottom: '1rem' }}>
                Enter mileage and fuel level when returning the vehicle (after testing).
              </p>
              <div className="form-group">
                <label>Odometer out (km)</label>
                <input
                  type="number"
                  min="0"
                  value={closeReadings.odometer_out}
                  onChange={(e) => setCloseReadings((r) => ({ ...r, odometer_out: e.target.value }))}
                  placeholder="km"
                />
              </div>
              <div className="form-group">
                <label>Fuel out</label>
                <select
                  value={closeReadings.fuel_out}
                  onChange={(e) => setCloseReadings((r) => ({ ...r, fuel_out: e.target.value }))}
                >
                  {fuelOptions.map((opt) => (
                    <option key={opt || 'blank'} value={opt}>{opt || '—'}</option>
                  ))}
                </select>
              </div>
            </div>
            <footer>
              <button type="button" className="btn" onClick={() => { setCloseJobModal(false); setStatusMenuKey((k) => k + 1); }}>Cancel</button>
              <button type="button" className="btn primary" onClick={submitCloseJob}>Close job</button>
            </footer>
          </div>
        </div>
      )}

      <div className="grid-2">
        <div className="card">
          <h3 style={{ marginTop: 0 }}>Vehicle & customer</h3>
          <p><strong>{[job.registration, job.make, job.model].filter(Boolean).join(' ')}</strong></p>
          <p>{job.customer_name}</p>
          <p>{job.customer_phone || '—'}</p>
          <p>{job.customer_email || '—'}</p>
        </div>
        <div className="card">
          <h3 style={{ marginTop: 0 }}>Job details</h3>
          <p><strong>Due:</strong> {job.due_date ? new Date(job.due_date).toLocaleDateString() : '—'}</p>
          {job.notes && <p><em>{job.notes}</em></p>}
          <div
            style={{
              marginTop: '1rem',
              paddingTop: '1rem',
              borderTop: '1px solid var(--border)',
            }}
          >
            <h4 style={{ margin: '0 0 0.65rem', fontSize: '0.95rem' }}>Financial summary</h4>
            <dl style={{ margin: 0, display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap' }}>
                <dt style={{ margin: 0, color: 'var(--text-muted)' }}>Quoted amount</dt>
                <dd style={{ margin: 0, fontWeight: 600, textAlign: 'right' }}>
                  {quoteLoading ? '…' : quote ? formatKes(quote.total) : '—'}
                </dd>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap' }}>
                <dt style={{ margin: 0, color: 'var(--text-muted)' }}>Invoiced amount</dt>
                <dd style={{ margin: 0, fontWeight: 600, textAlign: 'right' }}>
                  {invoiceLoading ? '…' : invoice ? formatKes(invoice.total) : '—'}
                </dd>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap' }}>
                <dt style={{ margin: 0, color: 'var(--text-muted)' }}>Amount paid</dt>
                <dd style={{ margin: 0, fontWeight: 600, textAlign: 'right' }}>
                  {invoiceLoading ? '…' : invoice ? formatKes(invoicePaidTotal) : '—'}
                </dd>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap' }}>
                <dt style={{ margin: 0, color: 'var(--text-muted)' }}>Balance</dt>
                <dd style={{ margin: 0, fontWeight: 600, textAlign: 'right' }}>
                  {invoiceLoading ? '…' : invoice ? formatKes(invoiceBalance) : '—'}
                </dd>
              </div>
            </dl>
            {(quote || invoice) && (
              <p style={{ margin: '0.75rem 0 0', fontSize: '0.85rem' }}>
                {quote && (
                  <>
                    <Link to={`/invoices/${quote.id}`}>Open quote</Link>
                    {invoice ? ' · ' : ''}
                  </>
                )}
                {invoice && <Link to={`/invoices/${invoice.id}`}>Open invoice</Link>}
              </p>
            )}
          </div>
        </div>
      </div>

      <div className="card">
        <h3 style={{ marginTop: 0 }}>Tasks</h3>
        {tasks.length === 0 && !tasksDirty && <p style={{ color: 'var(--text-muted)' }}>No tasks yet.</p>}
        {tasks.map((task, i) => (
          <div key={i} style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.5rem', alignItems: 'center' }}>
            <input
              type="checkbox"
              checked={!!task.completed}
              onChange={() => toggleTaskCompleted(i)}
            />
            <span style={{ color: 'var(--text-muted)', minWidth: '1.5rem' }}>{i + 1}.</span>
            <input
              type="text"
              value={task.description}
              onChange={(e) => updateTask(i, e.target.value)}
              placeholder="Task description"
              style={{ flex: 1 }}
            />
            <button type="button" className="btn" onClick={() => removeTask(i)} title="Remove task">×</button>
          </div>
        ))}
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginTop: '0.5rem' }}>
          <button type="button" className="btn" onClick={addTask}>+ Add task</button>
          {tasksDirty && (
            <button type="button" className="btn primary" onClick={saveTasks}>Save tasks</button>
          )}
        </div>
      </div>

      <div className="card">
        <h3 style={{ marginTop: 0 }}>Mileage & fuel</h3>
        <div style={{ marginBottom: '0.75rem' }}>
          <div style={rowStyle}>
            <strong>Mileage in</strong>
            {mileageInLocked ? (
              <span>{Number(job.odometer_in).toLocaleString()} km</span>
            ) : (
              <>
                <input
                  type="number"
                  min="0"
                  value={readings.odometer_in}
                  onChange={(e) => { setReadings((r) => ({ ...r, odometer_in: e.target.value })); setReadingsDirty(true); }}
                  style={inlineInp}
                />
                km
              </>
            )}
            ,
            <strong>Fuel in</strong>
            {fuelInLocked ? (
              <span>{job.fuel_in}</span>
            ) : (
              <select
                value={readings.fuel_in}
                onChange={(e) => { setReadings((r) => ({ ...r, fuel_in: e.target.value })); setReadingsDirty(true); }}
                style={inlineSel}
              >
                {fuelOptions.map((opt) => (
                  <option key={opt || 'blank'} value={opt}>{opt || '—'}</option>
                ))}
              </select>
            )}
          </div>
          {tdComputed.map((row) => (
            <div key={row.id} style={rowStyle}>
              <strong>Test drive {row.index + 1}:</strong>
              Mileage covered {formatKmDelta(row.covered)}, Fuel used {row.used}
            </div>
          ))}
          {canAddTestDrive && (
            <div style={rowStyle}>
              <strong>Add test drive:</strong>
              Mileage in
              <input
                type="number"
                min="0"
                value={testDriveOdo}
                onChange={(e) => setTestDriveOdo(e.target.value)}
                style={inlineInp}
              />
              km,
              Fuel in
              <select
                value={testDriveFuel}
                onChange={(e) => setTestDriveFuel(e.target.value)}
                style={inlineSel}
              >
                <option value="">—</option>
                {fuelOptions.filter(Boolean).map((opt) => (
                  <option key={opt} value={opt}>{opt}</option>
                ))}
              </select>
              <button type="button" className="btn primary" onClick={submitTestDrive} disabled={testDriveBusy} style={{ padding: '0.2rem 0.5rem', fontSize: '0.85rem' }}>
                {testDriveBusy ? '…' : 'Add'}
              </button>
            </div>
          )}
          <div style={rowStyle}>
            <strong>Mileage out</strong>
            <input
              type="number"
              min="0"
              value={readings.odometer_out}
              onChange={(e) => { setReadings((r) => ({ ...r, odometer_out: e.target.value })); setReadingsDirty(true); }}
              style={inlineInp}
            />
            km, Mileage covered {formatKmDelta(ho.mileageCovered)},
            <strong>Fuel out</strong>
            <select
              value={readings.fuel_out}
              onChange={(e) => { setReadings((r) => ({ ...r, fuel_out: e.target.value })); setReadingsDirty(true); }}
              style={inlineSel}
            >
              {fuelOptions.map((opt) => (
                <option key={opt || 'blank'} value={opt}>{opt || '—'}</option>
              ))}
            </select>
            , Fuel used {ho.fuelUsed}
          </div>
        </div>
        <div
          className="form-group"
          style={{
            marginTop: '1.25rem',
            marginBottom: 0,
            padding: '1rem',
            background: 'var(--bg)',
            borderRadius: 'var(--radius)',
            border: '1px solid var(--border)',
          }}
        >
          <label style={{ fontWeight: 600 }}>Valuables left in vehicle</label>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', margin: '0.35rem 0 0.5rem' }}>
            Note anything the customer has left in the car (bags, electronics, cash, etc.).
          </p>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))',
              gap: '0.5rem 0.75rem',
              marginBottom: '0.75rem',
            }}
          >
            {VALUABLE_ITEMS.map((item) => (
              <label key={item} style={{ display: 'flex', alignItems: 'center', gap: '0.45rem' }}>
                <input
                  type="checkbox"
                  checked={!!valuablesChecks[item]}
                  onChange={(e) => {
                    setValuablesChecks((prev) => ({ ...prev, [item]: e.target.checked }));
                    setReadingsDirty(true);
                  }}
                />
                {item}
              </label>
            ))}
          </div>
          <label style={{ display: 'block', marginBottom: '0.35rem', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
            Notes (custom items)
          </label>
          <textarea
            value={valuablesNotes}
            onChange={(e) => {
              setValuablesNotes(e.target.value);
              setReadingsDirty(true);
            }}
            placeholder="e.g. Laptop in boot, sunglasses in glovebox"
            rows={4}
            style={{ width: '100%', resize: 'vertical', minHeight: '4.5rem' }}
          />
        </div>
        {readingsDirty && (
          <div style={{ marginTop: '1rem' }}>
            <button type="button" className="btn primary" onClick={saveReadings}>
              Save readings
            </button>
          </div>
        )}
      </div>

      <div className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', flexWrap: 'wrap', gap: '0.5rem' }}>
          <h3 style={{ margin: 0 }}>Invoice</h3>
          {!invoiceLoading && !invoice && (
            <button type="button" className="btn primary" onClick={createInvoice}>Create invoice</button>
          )}
          {invoice && (
            <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
              <span style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>{invoice.invoice_number}</span>
              {quote && quote.items && quote.items.length > 0 && (
                <button type="button" className="btn" onClick={copyQuoteToInvoice}>
                  Copy from quote
                </button>
              )}
              {invoice.items && invoice.items.length > 0 && (
                <button type="button" className="btn primary" onClick={() => api.invoices.downloadPDF(invoice.id)}>
                  Download PDF
                </button>
              )}
            </div>
          )}
        </div>
        {invoiceLoading && <p style={{ color: 'var(--text-muted)' }}>Loading…</p>}
        {!invoiceLoading && invoice && (
          <>
            <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', margin: '0 0 0.75rem' }}>
              <strong>Purchase</strong> (unit cost) can be an internal estimate. Use the <strong>LPO & IPR</strong> section
              below to allocate real supplier costs; several purchases can map to one invoice line. The{' '}
              <strong>Labour</strong> line is fixed at quantity 1: enter the labour <strong>sale</strong> as the line total;
              internal <strong>cost</strong> follows logged hours × the average labour cost rate (Team members).
            </p>
            {addInvoiceItem && (
              <form onSubmit={submitInvoiceItem} style={{ marginBottom: '1rem', padding: '1rem', background: 'var(--bg)', borderRadius: 'var(--radius)' }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 80px 100px 100px auto', gap: '0.5rem', alignItems: 'end', flexWrap: 'wrap' }}>
                  <div className="form-group" style={{ margin: 0 }}>
                    <label>Item / description</label>
                    <input type="text" name="description" required placeholder="e.g. Labour" />
                  </div>
                  <div className="form-group" style={{ margin: 0 }}>
                    <label>Qty</label>
                    <input type="number" name="quantity" min="0.01" step="0.01" defaultValue="1" />
                  </div>
                  <div className="form-group" style={{ margin: 0 }}>
                    <label>Purchase (estimate)</label>
                    <input type="number" name="purchase_price" min="0" step="0.01" defaultValue="0" placeholder="0" />
                  </div>
                  <div className="form-group" style={{ margin: 0 }}>
                    <label>Sale (customer)</label>
                    <input type="number" name="unit_price" min="0" step="0.01" required placeholder="0" />
                  </div>
                  <div style={{ display: 'flex', gap: '0.5rem' }}>
                    <button type="submit" className="btn primary">Add</button>
                    <button type="button" className="btn" onClick={() => setAddInvoiceItem(false)}>Cancel</button>
                  </div>
                </div>
              </form>
            )}
            {!addInvoiceItem && (
              <button
                type="button"
                className="btn"
                onClick={() => {
                  if (hasUnapprovedQuoteLines(quote) && !window.confirm(UNAPPROVED_QUOTE_WARNING)) return;
                  setAddInvoiceItem(true);
                }}
                style={{ marginBottom: '1rem' }}
              >
                + Add item
              </button>
            )}
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Item</th>
                    <th>Qty</th>
                    <th>Purchase (unit cost)</th>
                    <th>Sale price</th>
                    <th>Total</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {(!invoice.items || invoice.items.length === 0) && (
                    <tr><td colSpan={6} className="empty">No invoice lines yet. Add items above.</td></tr>
                  )}
                  {invoice.items?.map((it) => {
                    const purchaseFromAlloc =
                      Number(it.lpo_line_count) > 0 || Number(it.ipr_line_count) > 0;
                    const labour = isLabourLine(it);
                    return (
                    <tr key={it.id}>
                      {editingInvoiceItemId === it.id ? (
                        <>
                          <td>
                            {labour ? (
                              <span style={{ fontWeight: 600 }}>Labour</span>
                            ) : (
                              <input type="text" id={`inv-desc-${it.id}`} defaultValue={it.description} style={{ width: '100%' }} />
                            )}
                          </td>
                          <td>
                            {labour ? <span>1</span> : (
                              <input type="number" id={`inv-qty-${it.id}`} min="0.01" step="0.01" defaultValue={it.quantity} style={{ width: '4rem' }} />
                            )}
                          </td>
                          <td>
                            {labour ? (
                              <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                                KES {Number(it.purchase_price ?? 0).toLocaleString()}
                                <span style={{ display: 'block', fontSize: '0.75rem' }}>
                                  Logged hours × labour cost rate (Team members)
                                </span>
                              </span>
                            ) : purchaseFromAlloc ? (
                              <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                                KES {Number(it.purchase_price ?? 0).toLocaleString()}
                                <span style={{ display: 'block', fontSize: '0.75rem' }}>Set by LPO / IPR allocations</span>
                              </span>
                            ) : (
                              <input type="number" id={`inv-purchase-${it.id}`} min="0" step="0.01" defaultValue={it.purchase_price ?? 0} style={{ width: '5rem' }} />
                            )}
                          </td>
                          <td><input type="number" id={`inv-sale-${it.id}`} min="0" step="0.01" defaultValue={it.unit_price} style={{ width: '5rem' }} /></td>
                          <td>—</td>
                          <td>
                            <button
                              type="button"
                              className="btn primary"
                              onClick={() => {
                                const sale = Number(document.getElementById(`inv-sale-${it.id}`)?.value) ?? it.unit_price;
                                if (labour) {
                                  updateInvoiceItem(it.id, { unit_price: sale });
                                  return;
                                }
                                const desc = document.getElementById(`inv-desc-${it.id}`)?.value?.trim();
                                const qty = Number(document.getElementById(`inv-qty-${it.id}`)?.value) || 1;
                                const purchase =
                                  purchaseFromAlloc
                                    ? Number(it.purchase_price ?? 0)
                                    : Number(document.getElementById(`inv-purchase-${it.id}`)?.value) || 0;
                                if (desc) updateInvoiceItem(it.id, { description: desc, quantity: qty, purchase_price: purchase, unit_price: sale });
                              }}
                            >
                              Save
                            </button>
                            <button type="button" className="btn" onClick={() => setEditingInvoiceItemId(null)}>Cancel</button>
                          </td>
                        </>
                      ) : (
                        <>
                          <td>{labour ? <span style={{ fontWeight: 600 }}>Labour</span> : it.description}</td>
                          <td>{labour ? 1 : it.quantity}</td>
                          <td>
                            {labour ? (
                              <>
                                {it.purchase_price != null ? 'KES ' + Number(it.purchase_price).toLocaleString() : '—'}
                                <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>
                                  Hours × rate (Team members)
                                </div>
                              </>
                            ) : (
                              <>
                                {it.purchase_price != null ? 'KES ' + Number(it.purchase_price).toLocaleString() : '—'}
                                {Number(it.lpo_line_count) > 0 && (
                                  <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>
                                    LPO net · KES {Number(it.lpo_allocated_cost || 0).toLocaleString()}
                                  </div>
                                )}
                                {Number(it.ipr_line_count) > 0 && (
                                  <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>
                                    IPR net · KES {Number(it.ipr_allocated_cost || 0).toLocaleString()}
                                  </div>
                                )}
                              </>
                            )}
                          </td>
                          <td>{it.unit_price != null ? 'KES ' + Number(it.unit_price).toLocaleString() : '—'}</td>
                          <td><strong>KES {((it.quantity ?? 1) * (it.unit_price ?? 0)).toLocaleString()}</strong></td>
                          <td>
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.35rem', alignItems: 'center' }}>
                              <button type="button" className="btn" onClick={() => setEditingInvoiceItemId(it.id)}>Edit</button>
                              {!labour && (
                                <button type="button" className="btn danger" onClick={() => removeInvoiceItem(it.id)}>Remove</button>
                              )}
                            </div>
                            {(it.lpo_ref || it.ipr_ref || it.ipr_refs) && (
                              <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.35rem' }}>
                                {[
                                  it.lpo_ref &&
                                    `Legacy LPO ${it.lpo_ref}${it.supplier_name ? ` (${it.supplier_name})` : ''}`,
                                  (it.ipr_refs || it.ipr_ref) &&
                                    `IPR ${String(it.ipr_refs || it.ipr_ref).replace(/,/g, ', ')}`,
                                ]
                                  .filter(Boolean)
                                  .join(' · ')}
                              </div>
                            )}
                          </td>
                        </>
                      )}
                    </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {invoice.items?.length > 0 && (
              <div style={{ marginTop: '1rem' }}>
                <p style={{ margin: '0 0 0.35rem', fontWeight: 600 }}>
                  Invoice total (inc VAT): {formatKes(invoice.total ?? 0)}
                </p>
                {invoice.tax_amount != null && Number(invoice.tax_amount) > 0 && (
                  <p style={{ margin: '0 0 0.35rem', fontSize: '0.9rem', color: 'var(--text-muted)' }}>
                    Subtotal (ex VAT) {formatKes(invoice.subtotal ?? 0)}
                    {' · '}
                    VAT ({((Number(invoice.tax_rate) || 0) * 100).toFixed(0)}%) {formatKes(invoice.tax_amount)}
                  </p>
                )}
                <p style={{ margin: 0, fontSize: '0.95rem' }}>
                  <span style={{ color: 'var(--text-muted)' }}>Paid to date</span>{' '}
                  <strong>{formatKes(invoicePaidTotal)}</strong>
                  {' · '}
                  <span style={{ color: 'var(--text-muted)' }}>Balance</span>{' '}
                  <strong>{formatKes(invoiceBalance)}</strong>
                </p>
              </div>
            )}

            <div
              style={{
                marginTop: '1.5rem',
                paddingTop: '1.25rem',
                borderTop: '1px solid var(--border)',
              }}
            >
              <h4 style={{ margin: '0 0 0.35rem', fontSize: '1rem' }}>Customer payments</h4>
              <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', margin: '0 0 1rem' }}>
                Record deposits and instalments against this invoice. Totals here, in the job summary above, and on the
                invoice page stay in sync.
              </p>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '1.5rem', marginBottom: '1rem' }}>
                <div>
                  <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>Total due (inc VAT)</div>
                  <div style={{ fontSize: '1.05rem' }}>{formatKes(invoice.total ?? 0)}</div>
                </div>
                <div>
                  <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>Paid to date</div>
                  <div style={{ fontSize: '1.05rem' }}>{formatKes(invoicePaidTotal)}</div>
                </div>
                <div>
                  <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>Balance</div>
                  <div style={{ fontSize: '1.05rem', fontWeight: 600 }}>{formatKes(invoiceBalance)}</div>
                </div>
              </div>

              <form
                onSubmit={addCustomerPayment}
                style={{ marginBottom: '1.25rem', padding: '1rem', background: 'var(--bg)', borderRadius: 'var(--radius)' }}
              >
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))',
                    gap: '0.75rem',
                    alignItems: 'end',
                  }}
                >
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
                    <input
                      type="text"
                      value={payNotes}
                      onChange={(e) => setPayNotes(e.target.value)}
                      placeholder="e.g. Deposit, M-Pesa ref"
                    />
                  </div>
                </div>
                <button
                  type="submit"
                  className="btn primary"
                  style={{ marginTop: '0.75rem' }}
                  disabled={addingPay || !canRecordInvoicePayments}
                >
                  {addingPay ? 'Recording…' : 'Record payment'}
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
                    {(!invoice.payments || invoice.payments.length === 0) && (
                      <tr>
                        <td colSpan={4} className="empty">No payments recorded yet.</td>
                      </tr>
                    )}
                    {(invoice.payments || []).map((p) => (
                      <tr key={p.id}>
                        <td><strong>{formatKes(p.amount)}</strong></td>
                        <td>{p.paid_at ? new Date(p.paid_at).toLocaleString() : '—'}</td>
                        <td style={{ color: 'var(--text-muted)' }}>{p.notes || '—'}</td>
                        <td>
                          <button
                            type="button"
                            className="btn"
                            style={{ padding: '0.2rem 0.5rem', fontSize: '0.8rem' }}
                            onClick={() => removeCustomerPayment(p.id)}
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
          </>
        )}
      </div>

      <div className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', flexWrap: 'wrap', gap: '0.5rem' }}>
          <h3 style={{ margin: 0 }}>Quote</h3>
          {!quoteLoading && !quote && (
            <button type="button" className="btn primary" onClick={createQuote}>Create quote</button>
          )}
          {quote && (
            <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
              <span style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>{quote.invoice_number}</span>
              {quote.items && quote.items.length > 0 && (
                <button type="button" className="btn primary" onClick={() => api.invoices.downloadPDF(quote.id)}>
                  Download PDF
                </button>
              )}
            </div>
          )}
        </div>
        {quoteLoading && <p style={{ color: 'var(--text-muted)' }}>Loading…</p>}
        {!quoteLoading && quote && (
          <>
            <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', margin: '0 0 0.75rem' }}>
              The <strong>Labour</strong> line is always quantity <strong>1</strong>; enter the quoted labour <strong>sale</strong> as that line total.
              It is not tied to logged hours (hours only affect internal costing on the invoice).
            </p>
            {addQuoteItem && (
              <form onSubmit={submitQuoteItem} style={{ marginBottom: '1rem', padding: '1rem', background: 'var(--bg)', borderRadius: 'var(--radius)' }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 80px 100px auto', gap: '0.5rem', alignItems: 'end', flexWrap: 'wrap' }} className="form-row-quote">
                  <div className="form-group" style={{ margin: 0 }}>
                    <label>Item / description</label>
                    <input type="text" name="description" required placeholder="e.g. Oil filter" />
                  </div>
                  <div className="form-group" style={{ margin: 0 }}>
                    <label>Qty</label>
                    <input type="number" name="quantity" min="0.01" step="0.01" defaultValue="1" />
                  </div>
                  <div className="form-group" style={{ margin: 0 }}>
                    <label>Sale (customer)</label>
                    <input type="number" name="unit_price" min="0" step="0.01" required placeholder="0" />
                  </div>
                  <div style={{ display: 'flex', gap: '0.5rem' }}>
                    <button type="submit" className="btn primary">Add</button>
                    <button type="button" className="btn" onClick={() => setAddQuoteItem(false)}>Cancel</button>
                  </div>
                </div>
              </form>
            )}
            {!addQuoteItem && (
              <button type="button" className="btn" onClick={() => setAddQuoteItem(true)} style={{ marginBottom: '1rem' }}>+ Add item</button>
            )}
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Approved</th>
                    <th>Item</th>
                    <th>Qty</th>
                    <th>Sale price</th>
                    <th>Total</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {(!quote.items || quote.items.length === 0) && (
                    <tr><td colSpan={6} className="empty">No quote lines yet. Add items above.</td></tr>
                  )}
                  {quote.items?.map((it) => {
                    const labour = isLabourLine(it);
                    return (
                    <tr key={it.id}>
                      {editingItemId === it.id ? (
                        <>
                          <td>{/* approval is read-only from customer side */}</td>
                          <td>
                            {labour ? (
                              <span style={{ fontWeight: 600 }}>Labour</span>
                            ) : (
                              <input type="text" id={`desc-${it.id}`} defaultValue={it.description} style={{ width: '100%' }} />
                            )}
                          </td>
                          <td>{labour ? <span>1</span> : <input type="number" id={`qty-${it.id}`} min="0.01" step="0.01" defaultValue={it.quantity} style={{ width: '4rem' }} />}</td>
                          <td><input type="number" id={`sale-${it.id}`} min="0" step="0.01" defaultValue={it.unit_price} style={{ width: '5rem' }} /></td>
                          <td>—</td>
                          <td>
                            <button type="button" className="btn primary" onClick={() => {
                              const sale = Number(document.getElementById(`sale-${it.id}`)?.value) ?? it.unit_price;
                              if (labour) {
                                updateQuoteItem(it.id, { unit_price: sale });
                                return;
                              }
                              const desc = document.getElementById(`desc-${it.id}`)?.value?.trim();
                              const qty = Number(document.getElementById(`qty-${it.id}`)?.value) || 1;
                              if (desc) updateQuoteItem(it.id, { description: desc, quantity: qty, unit_price: sale });
                            }}>Save</button>
                            <button type="button" className="btn" onClick={() => setEditingItemId(null)}>Cancel</button>
                          </td>
                        </>
                      ) : (
                        <>
                          <td style={{ textAlign: 'center' }}>
                            {isQuoteLineApproved(it) ? <span style={{ color: 'green', fontWeight: 600 }}>✔</span> : ''}
                          </td>
                          <td>{labour ? <span style={{ fontWeight: 600 }}>Labour</span> : it.description}</td>
                          <td>{labour ? 1 : it.quantity}</td>
                          <td>{it.unit_price != null ? 'KES ' + Number(it.unit_price).toLocaleString() : '—'}</td>
                          <td><strong>KES {((it.quantity ?? 1) * (it.unit_price ?? 0)).toLocaleString()}</strong></td>
                          <td>
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.35rem', alignItems: 'center' }}>
                              <button type="button" className="btn" onClick={() => setEditingItemId(it.id)}>Edit</button>
                              {invoice && !invoiceLoading && String(it.type || '').toLowerCase() !== 'labour' && (
                                <button type="button" className="btn primary" onClick={() => addQuoteLineToInvoice(it)}>
                                  Add to invoice
                                </button>
                              )}
                              {!labour && (
                                <button type="button" className="btn danger" onClick={() => removeQuoteItem(it.id)}>Remove</button>
                              )}
                            </div>
                          </td>
                        </>
                      )}
                    </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {quote.items?.length > 0 && (
              <p style={{ marginTop: '1rem', fontWeight: 600 }}>
                Quote total: KES {(quote.total ?? 0).toLocaleString()}
                {quote.tax_amount != null && quote.tax_amount > 0 && (
                  <span style={{ fontWeight: 400, color: 'var(--text-muted)', fontSize: '0.9rem' }}> (incl. tax)</span>
                )}
              </p>
            )}
          </>
        )}
      </div>

      <div className="card">
        <h3 style={{ marginTop: 0 }}>LPO & IPR</h3>
        {!invoiceLoading && invoice && (
          <JobInvoiceLpoIprPanel invoice={invoice} onInvoiceUpdated={setInvoice} />
        )}
        {!invoiceLoading && !invoice && (
          <p style={{ color: 'var(--text-muted)', margin: 0 }}>Create an invoice on this job to record LPOs and IPRs.</p>
        )}
        {invoiceLoading && <p style={{ color: 'var(--text-muted)' }}>Loading…</p>}
      </div>

      <div className="card">
        <h3 style={{ marginTop: 0 }}>Team time logs</h3>
        <p style={{ color: 'var(--text-muted)', marginTop: 0 }}>
          Time is logged from <Link to="/time-logs">Time logs</Link>. This job view shows the hours summary by employee.
        </p>
        {(() => {
          const byUser = new Map();
          for (const row of job?.time_logs || []) {
            const key = row.admin_username || row.admin_display_name || `user-${row.admin_user_id}`;
            const existing = byUser.get(key) || {
              label: row.admin_display_name || row.admin_username || '—',
              hours: 0,
              entries: 0,
            };
            existing.hours += Number(row.hours || 0);
            existing.entries += 1;
            byUser.set(key, existing);
          }
          const summary = Array.from(byUser.values()).sort((a, b) => b.hours - a.hours);
          const rate = Number(job?.average_labour_cost_per_hour ?? 0);
          const totalH =
            job?.total_labour_hours != null && Number.isFinite(Number(job.total_labour_hours))
              ? Number(job.total_labour_hours)
              : (job?.time_logs || []).reduce((s, tl) => s + (Number(tl.hours) || 0), 0);
          const totalCost =
            job?.total_labour_cost != null && Number.isFinite(Number(job.total_labour_cost))
              ? Number(job.total_labour_cost)
              : Math.round(totalH * rate * 100) / 100;
          return (
            <>
            <div className="table-wrap" style={{ marginBottom: '1rem' }}>
              <table>
                <thead>
                  <tr>
                    <th>Team member</th>
                    <th>Total hours</th>
                    <th>Entries</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.length === 0 && (
                    <tr><td colSpan={3} className="empty">No time logged yet.</td></tr>
                  )}
                  {summary.map((s) => (
                    <tr key={s.label}>
                      <td>{s.label}</td>
                      <td><strong>{s.hours.toLocaleString(undefined, { maximumFractionDigits: 2 })}</strong></td>
                      <td>{s.entries}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p style={{ margin: '0 0 1rem', fontSize: '0.95rem' }}>
              <strong>Job labour (cost):</strong>{' '}
              {job?.labour_cost_locked ? (
                <>
                  {totalH.toLocaleString(undefined, { maximumFractionDigits: 2 })} h × KES{' '}
                  {rate.toLocaleString(undefined, { maximumFractionDigits: 2 })}/h ={' '}
                  <strong>KES {totalCost.toLocaleString(undefined, { maximumFractionDigits: 2 })}</strong>
                  <span style={{ color: 'var(--text-muted)', fontWeight: 400, fontSize: '0.88rem' }}>
                    {' '}
                    (fixed when the job was completed — changing the workshop rate does not change this figure.)
                  </span>
                </>
              ) : rate > 0 ? (
                <>
                  {totalH.toLocaleString(undefined, { maximumFractionDigits: 2 })} h total × KES{' '}
                  {rate.toLocaleString(undefined, { maximumFractionDigits: 2 })}/h ={' '}
                  <strong>KES {totalCost.toLocaleString(undefined, { maximumFractionDigits: 2 })}</strong>
                </>
              ) : (
                <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>
                  {totalH > 0 ? (
                    <>
                      {totalH.toLocaleString(undefined, { maximumFractionDigits: 2 })} h logged — set average labour cost
                      under <Link to="/admin/team-members">Team members</Link> to show a cost total.
                    </>
                  ) : (
                    <>
                      — set average labour cost under <Link to="/admin/team-members">Team members</Link> to show a cost
                      total.
                    </>
                  )}
                </span>
              )}
            </p>
            </>
          );
        })()}
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Team member</th>
                <th>Hours</th>
                <th>Date</th>
                <th>Notes</th>
              </tr>
            </thead>
            <tbody>
              {(!job?.time_logs || job.time_logs.length === 0) && (
                <tr><td colSpan={4} className="empty">No time logs yet.</td></tr>
              )}
              {(job?.time_logs || []).map((tl) => (
                <tr key={tl.id}>
                  <td>{tl.admin_display_name || tl.admin_username || '—'}</td>
                  <td>{Number(tl.hours || 0).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })}</td>
                  <td>{tl.worked_at ? new Date(tl.worked_at).toLocaleString() : '—'}</td>
                  <td style={{ color: 'var(--text-muted)' }}>{tl.notes || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
