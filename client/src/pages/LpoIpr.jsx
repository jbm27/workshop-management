import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';

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

export default function LpoIpr() {
  const [lpos, setLpos] = useState([]);
  const [stockLpos, setStockLpos] = useState([]);
  const [iprs, setIprs] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    api.lpoIpr
      .summary()
      .then((data) => {
        setLpos(data.lpos || []);
        setStockLpos(data.stock_lpos || []);
        setIprs(data.iprs || []);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  return (
    <>
      <h1 className="page-title">LPO / IPR</h1>
      <p style={{ color: 'var(--text-muted)', marginBottom: '1.5rem' }}>
        Summary of <strong>all</strong> invoice LPOs, stock intake LPOs (draft and finalised), and IPRs. Draft stock
        intake LPOs are edited from <Link to="/stores">Stores</Link>. Totals include VAT where applicable.
      </p>

      <div className="card" style={{ marginBottom: '1.5rem' }}>
        <h2 style={{ marginTop: 0, fontSize: '1.1rem' }}>Invoice LPO documents</h2>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Reference</th>
                <th>Supplier</th>
                <th>Invoice</th>
                <th>Customer</th>
                <th>Document total</th>
                <th>Created</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr>
                  <td colSpan={7}>Loading…</td>
                </tr>
              )}
              {!loading && lpos.length === 0 && (
                <tr>
                  <td colSpan={7} className="empty">
                    No LPO documents yet. Use <strong>Create LPO</strong> on a job or invoice.
                  </td>
                </tr>
              )}
              {!loading &&
                lpos.map((row) => (
                  <tr key={`lpo-${row.lpo_id}`}>
                    <td>
                      <strong>{row.ref}</strong>
                    </td>
                    <td>
                      {row.supplier_id && row.supplier_name ? (
                        <Link to={`/suppliers/${row.supplier_id}`}>{row.supplier_name}</Link>
                      ) : (
                        <span style={{ color: 'var(--text-muted)' }}>—</span>
                      )}
                    </td>
                    <td>
                      <Link to={`/invoices/${row.invoice_id}`}>{row.invoice_number}</Link>
                      {row.job_id != null && (
                        <span style={{ display: 'block', fontSize: '0.8rem', marginTop: '0.2rem' }}>
                          <Link to={`/jobs/${row.job_id}`}>
                            {row.job_number ? `Job ${row.job_number}` : `Job #${row.job_id}`}
                          </Link>
                        </span>
                      )}
                    </td>
                    <td>{row.customer_name || '—'}</td>
                    <td>{kes(row.document_total)}</td>
                    <td style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>{fmtDate(row.created_at)}</td>
                    <td>
                      <button
                        type="button"
                        className="btn"
                        style={{ padding: '0.25rem 0.5rem', fontSize: '0.8rem' }}
                        onClick={() => api.invoices.downloadLpoPDF(row.invoice_id, row.lpo_id)}
                      >
                        Print PDF
                      </button>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card" style={{ marginBottom: '1.5rem' }}>
        <h2 style={{ marginTop: 0, fontSize: '1.1rem' }}>Stock intake LPOs</h2>
        <p style={{ fontSize: '0.9rem', color: 'var(--text-muted)', marginTop: 0 }}>
          All supplier receipts into stock (draft and finalised). Drafts are managed on Stores; finalised rows are
          read-only here.
        </p>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Reference</th>
                <th>Supplier</th>
                <th>Status</th>
                <th>Document total</th>
                <th>Created</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr>
                  <td colSpan={6}>Loading…</td>
                </tr>
              )}
              {!loading && stockLpos.length === 0 && (
                <tr>
                  <td colSpan={6} className="empty">
                    None yet. Use <strong>Receive stock (LPO)</strong> on <Link to="/stores">Stores</Link>.
                  </td>
                </tr>
              )}
              {!loading &&
                stockLpos.map((row) => {
                  const isFinal = Number(row.finalized) === 1;
                  return (
                  <tr key={`slpo-${row.lpo_id}`}>
                    <td>
                      <strong>{row.ref}</strong>
                    </td>
                    <td>
                      {row.supplier_id && row.supplier_name ? (
                        <Link to={`/suppliers/${row.supplier_id}`}>{row.supplier_name}</Link>
                      ) : (
                        <span style={{ color: 'var(--text-muted)' }}>—</span>
                      )}
                    </td>
                    <td style={{ fontSize: '0.85rem' }}>{isFinal ? 'Finalised' : 'Draft'}</td>
                    <td>{kes(row.document_total)}</td>
                    <td style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>{fmtDate(row.created_at)}</td>
                    <td>
                      {!isFinal && (
                        <Link
                          to="/stores"
                          className="btn"
                          style={{ display: 'inline-block', padding: '0.25rem 0.5rem', fontSize: '0.8rem' }}
                        >
                          Edit on Stores
                        </Link>
                      )}
                      <button
                        type="button"
                        className="btn"
                        style={{ padding: '0.25rem 0.5rem', fontSize: '0.8rem' }}
                        onClick={() => api.stock.downloadStockLpoPdf(row.lpo_id)}
                      >
                        Print PDF
                      </button>
                    </td>
                  </tr>
                  );
                })}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card">
        <h2 style={{ marginTop: 0, fontSize: '1.1rem' }}>IPRs (internal stock issues)</h2>
        <p style={{ fontSize: '0.9rem', color: 'var(--text-muted)', marginTop: 0 }}>
          One row per IPR document. Drafts are edited from the job or invoice; finalised IPRs have deducted stock.
        </p>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Reference</th>
                <th>Status</th>
                <th>Invoice</th>
                <th>Customer</th>
                <th>Lines</th>
                <th>Document total</th>
                <th>Created</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr>
                  <td colSpan={8}>Loading…</td>
                </tr>
              )}
              {!loading && iprs.length === 0 && (
                <tr>
                  <td colSpan={8} className="empty">
                    No IPRs yet. Use <strong>Create IPR</strong> on a job or invoice (stock items from{' '}
                    <Link to="/stores">Stores</Link>).
                  </td>
                </tr>
              )}
              {!loading &&
                iprs.map((row) => (
                  <tr key={`ipr-${row.ipr_id}`}>
                    <td>
                      <strong>{row.ref}</strong>
                    </td>
                    <td style={{ fontSize: '0.85rem' }}>
                      {Number(row.finalized) === 1 ? 'Finalised' : 'Draft'}
                    </td>
                    <td>
                      <Link to={`/invoices/${row.invoice_id}`}>{row.invoice_number}</Link>
                      {row.job_id != null && (
                        <span style={{ display: 'block', fontSize: '0.8rem', marginTop: '0.2rem' }}>
                          <Link to={`/jobs/${row.job_id}`}>
                            {row.job_number ? `Job ${row.job_number}` : `Job #${row.job_id}`}
                          </Link>
                        </span>
                      )}
                    </td>
                    <td>{row.customer_name || '—'}</td>
                    <td style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>{row.line_count ?? '—'}</td>
                    <td>{kes(row.document_total)}</td>
                    <td style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>{fmtDate(row.created_at)}</td>
                    <td>
                      <button
                        type="button"
                        className="btn"
                        style={{ padding: '0.25rem 0.5rem', fontSize: '0.8rem' }}
                        onClick={() => api.invoices.downloadIprPDF(row.invoice_id, row.ipr_id)}
                      >
                        Print PDF
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
