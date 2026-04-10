import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../api';
import { lpoLineNet, lpoLineVat, lpoLineGross, lpoVatLabel } from '../utils/lpoLine';
import { useAdmin } from '../auth/AdminContext';

function kes(n) {
  const x = Number(n);
  if (Number.isNaN(x)) return '—';
  return `KES ${x.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}

function fmtDate(s) {
  if (!s) return '—';
  try {
    return new Date(s).toLocaleString();
  } catch {
    return s;
  }
}

export default function SupplierDetail() {
  const { id } = useParams();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [payAmount, setPayAmount] = useState('');
  const [payDate, setPayDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [payNotes, setPayNotes] = useState('');
  const [addingPay, setAddingPay] = useState(false);

  const { admin } = useAdmin();
  const canRecordSupplierPayments = admin?.permissions?.can_record_supplier_payments;

  const refresh = () =>
    api.suppliers.get(id).then(setData).catch(() => setData(null));

  useEffect(() => {
    setLoading(true);
    refresh()
      .finally(() => setLoading(false));
  }, [id]);

  const addPayment = async (e) => {
    e.preventDefault();
    if (!canRecordSupplierPayments) return alert('You do not have permission to record payments');
    const amount = Number(payAmount);
    if (!amount || amount <= 0) return alert('Enter a positive amount');
    setAddingPay(true);
    try {
      const updated = await api.suppliers.addPayment(id, {
        amount,
        paid_at: payDate ? `${payDate}T12:00:00` : undefined,
        notes: payNotes.trim() || undefined,
      });
      setData(updated);
      setPayAmount('');
      setPayNotes('');
      setPayDate(new Date().toISOString().slice(0, 10));
    } catch (err) {
      alert(err.message);
    } finally {
      setAddingPay(false);
    }
  };

  const removePayment = async (paymentId) => {
    if (!canRecordSupplierPayments) return alert('You do not have permission to remove payments');
    if (!confirm('Remove this supplier payment record?')) return;
    try {
      await api.suppliers.deletePayment(id, paymentId);
      const updated = await api.suppliers.get(id);
      setData(updated);
    } catch (err) {
      alert(err.message);
    }
  };

  if (loading) return <div className="page-title">Loading…</div>;
  if (!data) {
    return (
      <>
        <p className="page-title">Supplier not found</p>
        <Link to="/suppliers">← Back to suppliers</Link>
      </>
    );
  }

  const lpos = data.lpos || [];
  const payments = data.payments || [];

  return (
    <>
      <div style={{ marginBottom: '1rem' }}>
        <Link to="/suppliers">← Suppliers</Link>
      </div>
      <h1 className="page-title" style={{ marginBottom: '0.5rem' }}>
        {data.name}
      </h1>
      <div style={{ color: 'var(--text-muted)', marginBottom: '1.5rem' }}>
        {(data.phone || data.email || data.pin) && (
          <span>
            {data.phone && <span>{data.phone}</span>}
            {data.phone && (data.email || data.pin) && ' · '}
            {data.email && <span>{data.email}</span>}
            {data.email && data.pin && ' · '}
            {data.pin && <span>PIN: {data.pin}</span>}
          </span>
        )}
        {data.address && (
          <p style={{ margin: '0.5rem 0 0', fontSize: '0.9rem' }}>{data.address}</p>
        )}
        {data.notes && (
          <p style={{ margin: '0.5rem 0 0', fontSize: '0.9rem' }}>{data.notes}</p>
        )}
      </div>

      <div className="grid-2" style={{ marginBottom: '1.5rem' }}>
        <div className="card">
          <h3 style={{ marginTop: 0 }}>Amount owed</h3>
          <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginTop: 0 }}>
            LPO line totals include VAT where charged (net + VAT per line), minus payments recorded here.
          </p>
          <div style={{ display: 'grid', gap: '0.75rem' }}>
            <div>
              <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>LPO purchase total</div>
              <div style={{ fontSize: '1.15rem' }}>{kes(data.lpo_total_cost)}</div>
            </div>
            <div>
              <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>Paid to supplier</div>
              <div style={{ fontSize: '1.15rem' }}>{kes(data.payments_total)}</div>
            </div>
            <div>
              <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>Balance owed</div>
              <div style={{ fontSize: '1.35rem', fontWeight: 700 }}>{kes(data.balance_owed)}</div>
            </div>
          </div>
        </div>
        <div className="card">
          <h3 style={{ marginTop: 0 }}>Record payment</h3>
          <form onSubmit={addPayment}>
            <div className="form-group" style={{ marginBottom: '0.75rem' }}>
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
            <div className="form-group" style={{ marginBottom: '0.75rem' }}>
              <label>Date paid</label>
              <input type="date" value={payDate} onChange={(e) => setPayDate(e.target.value)} />
            </div>
            <div className="form-group" style={{ marginBottom: '0.75rem' }}>
              <label>Note (optional)</label>
              <input
                type="text"
                value={payNotes}
                onChange={(e) => setPayNotes(e.target.value)}
                placeholder="e.g. Invoice ref, M-Pesa"
              />
            </div>
            <button type="submit" className="btn primary" disabled={addingPay || !canRecordSupplierPayments}>
              {addingPay ? 'Saving…' : 'Record payment'}
            </button>
          </form>
        </div>
      </div>

      <div className="card" style={{ marginBottom: '1.5rem' }}>
        <h3 style={{ marginTop: 0 }}>LPOs issued to this supplier</h3>
        {lpos.length === 0 && (
          <p className="empty" style={{ margin: 0 }}>
            No LPO documents yet. Create an LPO from a job or invoice, or receive stock from{' '}
            <Link to="/stores">Stores</Link>, and assign this supplier.
          </p>
        )}
        {lpos.map((doc) => (
          <div
            key={doc.lpo_id}
            style={{
              marginBottom: '1.25rem',
              padding: '1rem',
              background: 'var(--bg)',
              borderRadius: 'var(--radius)',
            }}
          >
            <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', gap: '0.5rem', marginBottom: '0.75rem' }}>
              <div>
                <strong>{doc.ref}</strong>
                <span style={{ color: 'var(--text-muted)', marginLeft: '0.5rem', fontSize: '0.9rem' }}>
                  Total {kes(doc.document_total)}
                </span>
              </div>
              <div style={{ fontSize: '0.9rem' }}>
                {doc.invoice_id != null ? (
                  <>
                    <Link to={`/invoices/${doc.invoice_id}`}>{doc.invoice_number}</Link>
                    {doc.job_id != null && (
                      <>
                        {' · '}
                        <Link to={`/jobs/${doc.job_id}`}>
                          {doc.job_number ? `Job ${doc.job_number}` : `Job #${doc.job_id}`}
                        </Link>
                      </>
                    )}
                  </>
                ) : (
                  <span style={{ color: 'var(--text-muted)' }}>Store stock intake</span>
                )}
              </div>
            </div>
            <p style={{ margin: '0 0 0.5rem', fontSize: '0.85rem', color: 'var(--text-muted)' }}>
              {doc.invoice_id != null ? doc.customer_name || '—' : 'Into stores'}
              {doc.notes ? ` · ${doc.notes}` : ''}
            </p>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Purchase (LPO line)</th>
                    <th>Invoice / stock line</th>
                    <th>Qty</th>
                    <th>Unit (ex VAT)</th>
                    <th>Net</th>
                    <th>VAT</th>
                    <th>Total</th>
                  </tr>
                </thead>
                <tbody>
                  {(doc.lines || []).map((ln) => (
                    <tr key={ln.lpo_line_id}>
                      <td>{ln.purchase_description}</td>
                      <td>{ln.invoice_line_description}</td>
                      <td>{ln.quantity}</td>
                      <td>{kes(ln.unit_cost)}</td>
                      <td>{kes(lpoLineNet(ln))}</td>
                      <td style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                        {lpoVatLabel(ln)}
                        {lpoLineVat(ln) > 0 ? ` · ${kes(lpoLineVat(ln))}` : ''}
                      </td>
                      <td>{kes(lpoLineGross(ln))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ))}
      </div>

      <div className="card">
        <h3 style={{ marginTop: 0 }}>Payments to supplier</h3>
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
                  <td colSpan={4} className="empty">
                    No payments recorded. Use the form above to reduce the balance owed.
                  </td>
                </tr>
              )}
              {payments.map((p) => (
                <tr key={p.id}>
                  <td>
                    <strong>{kes(p.amount)}</strong>
                  </td>
                  <td>{fmtDate(p.paid_at)}</td>
                  <td style={{ color: 'var(--text-muted)' }}>{p.notes || '—'}</td>
                  <td>
                    <button
                      type="button"
                      className="btn"
                      style={{ padding: '0.2rem 0.5rem', fontSize: '0.8rem' }}
                      onClick={() => removePayment(p.id)}
                      disabled={!canRecordSupplierPayments}
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
  );
}
