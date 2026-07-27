import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { useAdmin } from '../auth/AdminContext';
import { lpoLineGross, lpoLineNet, lpoVatLabel } from '../utils/lpoLine';

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

function lpoStatusGroup(row) {
  if (Number(row.finalized) === 1) return 'finalised';
  if (Number(row.approved) === 1) return 'approved';
  return 'open';
}

function lineLabel(ln) {
  if (ln.invoice_line_description) return ln.invoice_line_description;
  if (ln.stock_code || ln.stock_name) {
    return [ln.stock_code, ln.stock_name].filter(Boolean).join(' — ');
  }
  return null;
}

const STATUS_SECTIONS = [
  {
    key: 'open',
    title: 'Open',
    hint: 'Awaiting approval — expand a row to review parts and approve.',
    defaultOpen: true,
  },
  {
    key: 'approved',
    title: 'Approved',
    hint: 'Approved but not yet finalised.',
    defaultOpen: false,
  },
  {
    key: 'finalised',
    title: 'Finalised',
    hint: 'Locked documents.',
    defaultOpen: false,
  },
];

function LpoLinesTable({ lines }) {
  if (!lines?.length) {
    return <p className="empty" style={{ margin: '0.5rem 0 0', padding: 0 }}>No lines on this LPO.</p>;
  }
  return (
    <div className="table-wrap" style={{ marginTop: '0.5rem' }}>
      <table>
        <thead>
          <tr>
            <th>Part / description</th>
            <th>Qty</th>
            <th>Unit (ex VAT)</th>
            <th>Net</th>
            <th>VAT</th>
            <th>Total</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((ln) => {
            const linked = lineLabel(ln);
            return (
              <tr key={ln.line_id}>
                <td>
                  {ln.description || '—'}
                  {linked && linked !== ln.description && (
                    <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: '0.15rem' }}>
                      → {linked}
                    </div>
                  )}
                </td>
                <td>{ln.quantity}</td>
                <td>{kes(ln.unit_cost)}</td>
                <td>{kes(ln.line_net ?? lpoLineNet(ln))}</td>
                <td style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                  {lpoVatLabel(ln)}
                  {(ln.line_vat ?? 0) > 0 ? ` · ${kes(ln.line_vat)}` : ''}
                </td>
                <td>{kes(ln.line_gross ?? lpoLineGross(ln))}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function LpoRow({ row, expanded, onToggleExpand, canApprove, busy, onApprove }) {
  const isOpen = lpoStatusGroup(row) === 'open';
  const isStock = row.kind === 'stock';
  const colSpan = 8;

  return (
    <>
      <tr>
        <td style={{ width: '2.25rem', verticalAlign: 'middle' }}>
          {isOpen ? (
            <button
              type="button"
              className="btn"
              aria-expanded={expanded}
              aria-label={expanded ? 'Collapse LPO details' : 'Expand LPO details'}
              title={expanded ? 'Hide parts' : 'Show parts'}
              onClick={() => onToggleExpand(row.lpo_id)}
              style={{
                padding: '0.15rem 0.4rem',
                fontSize: '1rem',
                lineHeight: 1,
                minWidth: '1.75rem',
                fontWeight: 600,
              }}
            >
              {expanded ? '−' : '+'}
            </button>
          ) : (
            <span style={{ color: 'var(--text-muted)' }}>—</span>
          )}
        </td>
        <td>
          <strong>{row.ref}</strong>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.15rem' }}>
            {isStock ? 'Stock intake' : 'Invoice LPO'}
          </div>
        </td>
        <td>
          {row.supplier_id && row.supplier_name ? (
            <Link to={`/suppliers/${row.supplier_id}`}>{row.supplier_name}</Link>
          ) : (
            <span style={{ color: 'var(--text-muted)' }}>—</span>
          )}
        </td>
        <td>
          {isStock ? (
            <span style={{ color: 'var(--text-muted)' }}>Into stores</span>
          ) : (
            <>
              <Link to={`/invoices/${row.invoice_id}`}>{row.invoice_number}</Link>
              {row.job_id != null && (
                <span style={{ display: 'block', fontSize: '0.8rem', marginTop: '0.2rem' }}>
                  <Link to={`/jobs/${row.job_id}`}>
                    {row.job_number ? `Job ${row.job_number}` : `Job #${row.job_id}`}
                  </Link>
                </span>
              )}
            </>
          )}
        </td>
        <td>{isStock ? '—' : row.customer_name || '—'}</td>
        <td>{kes(row.document_total)}</td>
        <td style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>{fmtDate(row.created_at)}</td>
        <td>
          {isStock && Number(row.finalized) !== 1 && (
            <Link
              to="/stores"
              className="btn"
              style={{ display: 'inline-block', padding: '0.25rem 0.5rem', fontSize: '0.8rem', marginRight: '0.25rem' }}
            >
              Edit on Stores
            </Link>
          )}
          <button
            type="button"
            className="btn"
            style={{ padding: '0.25rem 0.5rem', fontSize: '0.8rem' }}
            onClick={() =>
              isStock
                ? api.stock.downloadStockLpoPdf(row.lpo_id)
                : api.invoices.downloadLpoPDF(row.invoice_id, row.lpo_id)
            }
            disabled={Number(row.approved) !== 1}
            title={Number(row.approved) !== 1 ? 'Approve the LPO before printing' : undefined}
          >
            Print PDF
          </button>
        </td>
      </tr>
      {isOpen && expanded && (
        <tr>
          <td colSpan={colSpan} style={{ background: 'var(--bg-muted, #f6f8fb)', padding: '0.85rem 1rem' }}>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.75rem', alignItems: 'flex-start', justifyContent: 'space-between' }}>
              <div style={{ flex: '1 1 16rem', minWidth: 0 }}>
                <div style={{ fontSize: '0.85rem', fontWeight: 600, marginBottom: '0.25rem' }}>Parts on this LPO</div>
                <LpoLinesTable lines={row.lines} />
              </div>
              <div style={{ flex: '0 0 auto', display: 'flex', flexDirection: 'column', gap: '0.4rem', alignItems: 'stretch' }}>
                <div style={{ fontSize: '0.75rem', color: 'var(--danger)' }}>Pending approval</div>
                <button
                  type="button"
                  className="btn primary"
                  style={{ padding: '0.35rem 0.75rem', fontSize: '0.85rem' }}
                  onClick={() => onApprove(row)}
                  disabled={busy || !canApprove}
                  title={!canApprove ? 'You do not have permission to approve LPOs' : undefined}
                >
                  {busy ? 'Approving…' : 'Approve LPO'}
                </button>
                {!isStock && row.job_id != null && (
                  <Link to={`/jobs/${row.job_id}`} style={{ fontSize: '0.8rem' }}>
                    Open job
                  </Link>
                )}
                {!isStock && (
                  <Link to={`/invoices/${row.invoice_id}`} style={{ fontSize: '0.8rem' }}>
                    Open invoice
                  </Link>
                )}
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

function LpoStatusSection({ section, rows, expandedId, onToggleExpand, canApprove, busyId, onApprove }) {
  const [open, setOpen] = useState(section.defaultOpen);
  const count = rows.length;

  return (
    <details
      className="card"
      style={{ marginBottom: '1rem', padding: 0, overflow: 'hidden' }}
      open={open}
      onToggle={(e) => setOpen(e.target.open)}
    >
      <summary
        style={{
          cursor: 'pointer',
          fontWeight: 600,
          padding: '0.85rem 1.25rem',
          listStylePosition: 'outside',
          userSelect: 'none',
        }}
      >
        {section.title} ({count})
        {section.hint && (
          <span style={{ display: 'block', fontWeight: 400, fontSize: '0.85rem', color: 'var(--text-muted)', marginTop: '0.2rem' }}>
            {section.hint}
          </span>
        )}
      </summary>
      <div style={{ borderTop: '1px solid var(--border)' }}>
        <div className="table-wrap" style={{ borderRadius: 0, border: 'none', boxShadow: 'none' }}>
          <table>
            <thead>
              <tr>
                <th style={{ width: '2.25rem' }}></th>
                <th>Reference</th>
                <th>Supplier</th>
                <th>Invoice / destination</th>
                <th>Customer</th>
                <th>Document total</th>
                <th>Created</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {count === 0 ? (
                <tr>
                  <td colSpan={8} className="empty">
                    No {section.title.toLowerCase()} LPOs.
                  </td>
                </tr>
              ) : (
                rows.map((row) => (
                  <LpoRow
                    key={`${row.kind}-${row.lpo_id}`}
                    row={row}
                    expanded={expandedId === row.lpo_id}
                    onToggleExpand={onToggleExpand}
                    canApprove={canApprove}
                    busy={busyId === row.lpo_id}
                    onApprove={onApprove}
                  />
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </details>
  );
}

export default function LpoIpr() {
  const { admin } = useAdmin();
  const canApproveLpoIpr = Boolean(admin?.permissions?.can_approve_lpo_ipr);
  const [lpos, setLpos] = useState([]);
  const [stockLpos, setStockLpos] = useState([]);
  const [iprs, setIprs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState(null);
  const [busyId, setBusyId] = useState(null);

  const loadSummary = useCallback(() => {
    setLoading(true);
    return api.lpoIpr
      .summary()
      .then((data) => {
        setLpos(data.lpos || []);
        setStockLpos(data.stock_lpos || []);
        setIprs(data.iprs || []);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    loadSummary();
  }, [loadSummary]);

  const allLpos = useMemo(() => {
    const invoice = (lpos || []).map((r) => ({ ...r, kind: r.kind || 'invoice' }));
    const stock = (stockLpos || []).map((r) => ({ ...r, kind: r.kind || 'stock' }));
    return [...invoice, ...stock].sort((a, b) => Number(b.lpo_id) - Number(a.lpo_id));
  }, [lpos, stockLpos]);

  const grouped = useMemo(() => {
    const groups = { open: [], approved: [], finalised: [] };
    for (const row of allLpos) {
      groups[lpoStatusGroup(row)].push(row);
    }
    return groups;
  }, [allLpos]);

  const toggleExpand = (lpoId) => {
    setExpandedId((prev) => (prev === lpoId ? null : lpoId));
  };

  const approveLpo = async (row) => {
    if (!canApproveLpoIpr || busyId != null) return;
    setBusyId(row.lpo_id);
    try {
      if (row.kind === 'stock') {
        await api.stock.approveStockLpo(row.lpo_id);
      } else {
        await api.invoices.approveLpo(row.invoice_id, row.lpo_id);
      }
      setExpandedId(null);
      await loadSummary();
    } catch (err) {
      alert(String(err?.message || 'Could not approve LPO.'));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <>
      <h1 className="page-title">LPO / IPR</h1>
      <p style={{ color: 'var(--text-muted)', marginBottom: '1.5rem' }}>
        All invoice and stock intake LPOs, grouped by status. Expand an <strong>Open</strong> LPO to review parts and
        approve without opening the job. Draft stock intakes are also edited from <Link to="/stores">Stores</Link>.
        Totals include VAT where applicable.
      </p>

      {loading ? (
        <div className="card" style={{ marginBottom: '1.5rem' }}>
          Loading LPOs…
        </div>
      ) : allLpos.length === 0 ? (
        <div className="card" style={{ marginBottom: '1.5rem' }}>
          <p className="empty" style={{ margin: 0 }}>
            No LPO documents yet. Use <strong>Create LPO</strong> on a job or invoice, or{' '}
            <strong>Receive stock (LPO)</strong> on <Link to="/stores">Stores</Link>.
          </p>
        </div>
      ) : (
        STATUS_SECTIONS.map((section) => (
          <LpoStatusSection
            key={section.key}
            section={section}
            rows={grouped[section.key]}
            expandedId={expandedId}
            onToggleExpand={toggleExpand}
            canApprove={canApproveLpoIpr}
            busyId={busyId}
            onApprove={approveLpo}
          />
        ))
      )}

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
                        disabled={Number(row.approved) !== 1}
                        title={Number(row.approved) !== 1 ? 'Approve the IPR before printing' : undefined}
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
