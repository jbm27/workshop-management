import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import { lpoLineGross, lpoVatLabel } from '../utils/lpoLine';
import { useAdmin } from '../auth/AdminContext';

function kes(n) {
  const x = Number(n);
  if (Number.isNaN(x)) return '—';
  return `KES ${x.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}

function newFormLine() {
  return {
    key: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    invoice_item_id: '',
    description: '',
    quantity: '1',
    unit_cost: '',
    vat_mode: 'none',
    vat_rate_custom: '',
  };
}

function formLineFromSaved(ln) {
  const ex = Number(ln.vat_exempt) === 1;
  const rate = Number(ln.vat_rate) || 0;
  let vat_mode = 'none';
  let vat_rate_custom = '';
  if (ex) vat_mode = 'exempt';
  else if (rate === 16) vat_mode = 'standard';
  else if (rate > 0) {
    vat_mode = 'custom';
    vat_rate_custom = String(rate);
  }
  return {
    key: `ln-${ln.id}`,
    invoice_item_id: String(ln.invoice_item_id),
    description: ln.description,
    quantity: String(ln.quantity),
    unit_cost: String(ln.unit_cost),
    vat_mode,
    vat_rate_custom,
  };
}

function newIprLine() {
  return {
    key: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    invoice_item_id: '',
    stock_item_id: '',
    description: '',
    quantity: '1',
    unit_cost: '',
    vat_mode: 'none',
    vat_rate_custom: '',
  };
}

function iprFormLineFromSaved(ln) {
  const ex = Number(ln.vat_exempt) === 1;
  const rate = Number(ln.vat_rate) || 0;
  let vat_mode = 'none';
  let vat_rate_custom = '';
  if (ex) vat_mode = 'exempt';
  else if (rate === 16) vat_mode = 'standard';
  else if (rate > 0) {
    vat_mode = 'custom';
    vat_rate_custom = String(rate);
  }
  return {
    key: `ln-${ln.id}`,
    invoice_item_id: String(ln.invoice_item_id),
    stock_item_id: String(ln.stock_item_id || ''),
    description: ln.description || '',
    quantity: String(ln.quantity),
    unit_cost: String(ln.unit_cost),
    vat_mode,
    vat_rate_custom,
  };
}

export default function JobInvoiceLpoIprPanel({ invoice, onInvoiceUpdated }) {
  const [lpos, setLpos] = useState([]);
  const [lpoModal, setLpoModal] = useState(false);
  const [editingLpo, setEditingLpo] = useState(null);
  const [iprs, setIprs] = useState([]);
  const [iprModal, setIprModal] = useState(false);
  const [editingIpr, setEditingIpr] = useState(null);
  const [busy, setBusy] = useState(false);

  const [lpoSupplierId, setLpoSupplierId] = useState('');
  const [lpoNotes, setLpoNotes] = useState('');
  const [lpoLines, setLpoLines] = useState([newFormLine()]);
  const [suppliers, setSuppliers] = useState([]);
  const [suppliersLoading, setSuppliersLoading] = useState(false);

  const [iprNotes, setIprNotes] = useState('');
  const [iprLines, setIprLines] = useState([newIprLine()]);
  const [iprStockQ, setIprStockQ] = useState('');
  const [iprStockList, setIprStockList] = useState([]);
  const [iprStockLoading, setIprStockLoading] = useState(false);
  const [teamMembers, setTeamMembers] = useState([]);

  const { admin } = useAdmin();
  const canCreateLpos = admin?.permissions?.can_create_lpos;
  const canCreateIprs = admin?.permissions?.can_create_iprs;
  const canFinalizeIprs = admin?.permissions?.can_finalize_iprs;
  const canFinalizeLpos = admin?.permissions?.can_finalize_lpos;
  const canApproveLpoIpr = admin?.permissions?.can_approve_lpo_ipr;
  const canAssignReceivers = Boolean(admin?.permissions?.can_approve_lpo_ipr || admin?.permissions?.can_manage_team_members);

  const loadLpos = useCallback(() => {
    if (!invoice?.id) return Promise.resolve();
    return api.invoices.listLpos(invoice.id).then(setLpos);
  }, [invoice?.id]);

  const loadIprs = useCallback(() => {
    if (!invoice?.id) return Promise.resolve();
    return api.invoices.listIprs(invoice.id).then(setIprs);
  }, [invoice?.id]);

  useEffect(() => {
    loadLpos().catch(console.error);
  }, [loadLpos]);

  useEffect(() => {
    loadIprs().catch(console.error);
  }, [loadIprs]);

  useEffect(() => {
    api.admin.users.assignable().then(setTeamMembers).catch(() => setTeamMembers([]));
  }, []);

  const refreshInvoiceAndLpos = async () => {
    const inv = await api.invoices.get(invoice.id);
    onInvoiceUpdated(inv);
    await Promise.all([loadLpos(), loadIprs()]);
  };

  const openCreateLpo = () => {
    setEditingLpo(null);
    setLpoSupplierId('');
    setLpoNotes('');
    setLpoLines([newFormLine()]);
    setLpoModal(true);
    setSuppliersLoading(true);
    api.suppliers
      .list()
      .then(setSuppliers)
      .catch((e) => alert(e.message))
      .finally(() => setSuppliersLoading(false));
  };

  const openEditLpo = (doc) => {
    setEditingLpo(doc);
    setLpoSupplierId(String(doc.supplier_id));
    setLpoNotes(doc.notes || '');
    setLpoLines((doc.lines || []).map(formLineFromSaved));
    setLpoModal(true);
    setSuppliersLoading(true);
    api.suppliers
      .list()
      .then(setSuppliers)
      .catch((e) => alert(e.message))
      .finally(() => setSuppliersLoading(false));
  };

  const submitLpo = async (e) => {
    e?.preventDefault?.();
    if (!lpoSupplierId) return alert('Select a supplier');
    const lines = [];
    for (const ln of lpoLines) {
      const invoice_item_id = Number(ln.invoice_item_id);
      const description = (ln.description || '').trim();
      const quantity = Number(ln.quantity);
      const unit_cost = Number(ln.unit_cost);
      if (!invoice_item_id && !description && !ln.quantity?.toString().trim() && !ln.unit_cost?.toString().trim()) continue;
      if (!invoice_item_id) return alert('Each line must be linked to an invoice line');
      if (!description) return alert('Each line needs a purchase description');
      if (!quantity || quantity <= 0) return alert('Each line needs a positive quantity');
      if (!Number.isFinite(unit_cost) || unit_cost < 0) return alert('Each line needs a valid unit cost');
      let vat_exempt = false;
      let vat_rate = 0;
      if (ln.vat_mode === 'exempt') vat_exempt = true;
      else if (ln.vat_mode === 'standard') vat_rate = 16;
      else if (ln.vat_mode === 'custom') {
        vat_rate = Number(ln.vat_rate_custom);
        if (!Number.isFinite(vat_rate) || vat_rate < 0 || vat_rate > 100)
          return alert('Custom VAT % must be between 0 and 100');
      }
      lines.push({ invoice_item_id, description, quantity, unit_cost, vat_rate, vat_exempt });
    }
    if (lines.length === 0) return alert('Add at least one LPO line');
    setBusy(true);
    try {
      const body = { supplier_id: Number(lpoSupplierId), notes: lpoNotes.trim() || undefined, lines };
      if (editingLpo) {
        await api.invoices.updateLpo(invoice.id, editingLpo.id, body);
      } else {
        await api.invoices.createLpo(invoice.id, body);
      }
      setLpoModal(false);
      setEditingLpo(null);
      await refreshInvoiceAndLpos();
    } catch (err) {
      alert(err.message);
    } finally {
      setBusy(false);
    }
  };

  const deleteLpo = async (lpoId) => {
    if (!confirm('Delete this LPO? Allocated costs will be removed from invoice line purchase prices.')) return;
    setBusy(true);
    try {
      await api.invoices.deleteLpo(invoice.id, lpoId);
      await refreshInvoiceAndLpos();
    } catch (err) {
      alert(err.message);
    } finally {
      setBusy(false);
    }
  };

  const approveLpo = async (lpoId) => {
    setBusy(true);
    try {
      await api.invoices.approveLpo(invoice.id, lpoId);
      await refreshInvoiceAndLpos();
    } catch (err) {
      alert(err.message);
    } finally {
      setBusy(false);
    }
  };

  const finalizeLpo = async (lpoId) => {
    if (!confirm('Finalise this LPO? It can only be finalised when all lines are confirmed received.')) return;
    setBusy(true);
    try {
      await api.invoices.finalizeLpo(invoice.id, lpoId);
      await refreshInvoiceAndLpos();
    } catch (err) {
      alert(err.message);
    } finally {
      setBusy(false);
    }
  };

  const updateLpoLineReceipt = async (lpoId, lineId, patch) => {
    setBusy(true);
    try {
      await api.invoices.updateLpoLineReceipt(invoice.id, lpoId, lineId, patch);
      await refreshInvoiceAndLpos();
    } catch (err) {
      alert(err.message);
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (!iprModal) return;
    setIprStockLoading(true);
    const t = setTimeout(() => {
      api.stock
        .list(iprStockQ.trim() ? { q: iprStockQ.trim() } : {})
        .then(setIprStockList)
        .catch((e) => alert(e.message))
        .finally(() => setIprStockLoading(false));
    }, 280);
    return () => clearTimeout(t);
  }, [iprModal, iprStockQ]);

  const openCreateIpr = () => {
    setEditingIpr(null);
    setIprNotes('');
    setIprLines([newIprLine()]);
    setIprStockQ('');
    setIprStockList([]);
    setIprModal(true);
  };

  const openEditIpr = (doc) => {
    setEditingIpr(doc);
    setIprNotes(doc.notes || '');
    setIprLines((doc.lines || []).map(iprFormLineFromSaved));
    setIprStockQ('');
    setIprStockList([]);
    setIprModal(true);
  };

  const buildIprApiLines = () => {
    const lines = [];
    for (const ln of iprLines) {
      const invoice_item_id = Number(ln.invoice_item_id);
      const stock_item_id = Number(ln.stock_item_id);
      const description = (ln.description || '').trim();
      const quantity = Number(ln.quantity);
      const unit_cost = Number(ln.unit_cost);
      if (!invoice_item_id && !ln.stock_item_id && !ln.quantity?.toString().trim() && !ln.unit_cost?.toString().trim())
        continue;
      if (!invoice_item_id) throw new Error('Each line must be linked to an invoice line');
      if (!stock_item_id) throw new Error('Each line must select a stock item');
      if (!description) throw new Error('Each line needs a description (set automatically when you pick stock)');
      if (!quantity || quantity <= 0) throw new Error('Each line needs a positive quantity');
      if (!Number.isFinite(unit_cost) || unit_cost < 0) throw new Error('Each line needs a valid unit cost (ex VAT)');
      let vat_exempt = false;
      let vat_rate = 0;
      if (ln.vat_mode === 'exempt') vat_exempt = true;
      else if (ln.vat_mode === 'standard') vat_rate = 16;
      else if (ln.vat_mode === 'custom') {
        vat_rate = Number(ln.vat_rate_custom);
        if (!Number.isFinite(vat_rate) || vat_rate < 0 || vat_rate > 100)
          throw new Error('Custom VAT % must be between 0 and 100');
      }
      lines.push({ invoice_item_id, stock_item_id, description, quantity, unit_cost, vat_rate, vat_exempt });
    }
    return lines;
  };

  const submitIprDraft = async (e) => {
    e?.preventDefault?.();
    let lines;
    try {
      lines = buildIprApiLines();
    } catch (err) {
      alert(err.message);
      return;
    }
    if (lines.length === 0) return alert('Add at least one IPR line');
    setBusy(true);
    try {
      const body = { notes: iprNotes.trim() || undefined, lines };
      let res;
      if (editingIpr) {
        res = await api.invoices.updateIpr(invoice.id, editingIpr.id, body);
      } else {
        res = await api.invoices.createIpr(invoice.id, body);
      }
      onInvoiceUpdated(res.invoice);
      setIprModal(false);
      setEditingIpr(null);
      await loadIprs();
    } catch (err) {
      alert(err.message);
    } finally {
      setBusy(false);
    }
  };

  const finalizeIprFromModal = async () => {
    let lines;
    try {
      lines = buildIprApiLines();
    } catch (err) {
      alert(err.message);
      return;
    }
    if (lines.length === 0) return alert('Add at least one IPR line');
    setBusy(true);
    try {
      let iprId = editingIpr?.id;
      const body = { notes: iprNotes.trim() || undefined, lines };
      if (!iprId) {
        const res = await api.invoices.createIpr(invoice.id, body);
        onInvoiceUpdated(res.invoice);
        iprId = res.ipr?.id;
        if (!iprId) throw new Error('Could not create IPR');
      } else {
        const res = await api.invoices.updateIpr(invoice.id, iprId, body);
        onInvoiceUpdated(res.invoice);
      }
      const fin = await api.invoices.finalizeIpr(invoice.id, iprId);
      onInvoiceUpdated(fin.invoice);
      setIprModal(false);
      setEditingIpr(null);
      await loadIprs();
    } catch (err) {
      alert(err.message);
    } finally {
      setBusy(false);
    }
  };

  const deleteIpr = async (iprId) => {
    if (!confirm('Delete this draft IPR?')) return;
    setBusy(true);
    try {
      await api.invoices.deleteIpr(invoice.id, iprId);
      await refreshInvoiceAndLpos();
    } catch (err) {
      alert(err.message);
    } finally {
      setBusy(false);
    }
  };

  const finalizeIprFromRow = async (iprId) => {
    if (!confirm('Finalise this IPR? Stock quantities will be reduced now.')) return;
    setBusy(true);
    try {
      const fin = await api.invoices.finalizeIpr(invoice.id, iprId);
      onInvoiceUpdated(fin.invoice);
      await loadIprs();
    } catch (err) {
      alert(err.message);
    } finally {
      setBusy(false);
    }
  };

  const approveIpr = async (iprId) => {
    setBusy(true);
    try {
      await api.invoices.approveIpr(invoice.id, iprId);
      await refreshInvoiceAndLpos();
    } catch (err) {
      alert(err.message);
    } finally {
      setBusy(false);
    }
  };

  const updateIprLineReceipt = async (iprId, lineId, patch) => {
    setBusy(true);
    try {
      await api.invoices.updateIprLineReceipt(invoice.id, iprId, lineId, patch);
      await refreshInvoiceAndLpos();
    } catch (err) {
      alert(err.message);
    } finally {
      setBusy(false);
    }
  };

  const items = invoice.items || [];

  return (
    <>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', alignItems: 'center', marginBottom: '1rem' }}>
        <button type="button" className="btn primary" onClick={openCreateLpo} disabled={busy || items.length === 0 || !canCreateLpos}>
          Create LPO
        </button>
        <button type="button" className="btn primary" onClick={openCreateIpr} disabled={busy || items.length === 0 || !canCreateIprs}>
          Create IPR
        </button>
        {items.length === 0 && (
          <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>Add invoice lines first.</span>
        )}
      </div>

      {lpos.length > 0 && (
        <div style={{ marginBottom: '1rem' }}>
          <h4 style={{ margin: '0 0 0.5rem', fontSize: '0.95rem' }}>LPOs for this invoice</h4>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Ref</th>
                  <th>Supplier</th>
                  <th>Total</th>
                  <th>Lines</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {lpos.map((doc) => (
                  <tr key={doc.id}>
                    <td>
                      <strong>{doc.ref}</strong>
                    </td>
                    <td>{doc.supplier_name || '—'}</td>
                    <td>
                      <strong>{kes(doc.document_total)}</strong>
                      {Number(doc.document_vat) > 0 && (
                        <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 400 }}>
                          {kes(doc.document_subtotal)} ex VAT + {kes(doc.document_vat)} VAT
                        </div>
                      )}
                    </td>
                    <td style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                      {(doc.lines || []).map((ln) => (
                        <div key={ln.id}>
                          {ln.description} → {ln.invoice_line_description} (
                          {kes(ln.line_gross ?? lpoLineGross(ln))}
                          {lpoVatLabel(ln) !== 'No VAT' ? ` · ${lpoVatLabel(ln)}` : ''}
                          )
                          <div style={{ marginTop: '0.2rem', display: 'flex', gap: '0.35rem', alignItems: 'center' }}>
                            <select
                              value={ln.assigned_admin_user_id || ''}
                              onChange={(e) => updateLpoLineReceipt(doc.id, ln.id, { assigned_admin_user_id: Number(e.target.value) || null })}
                              disabled={busy || Number(doc.finalized) === 1 || !canAssignReceivers}
                              style={{ maxWidth: '160px', fontSize: '0.75rem' }}
                            >
                              <option value="">Assign member…</option>
                              {teamMembers.map((tm) => (
                                <option key={tm.id} value={tm.id}>{tm.display_name || tm.username}</option>
                              ))}
                            </select>
                            <label style={{ fontSize: '0.75rem', display: 'flex', alignItems: 'center', gap: '0.2rem' }}>
                              <input
                                type="checkbox"
                                checked={Number(ln.received_confirmed) === 1}
                                onChange={(e) => updateLpoLineReceipt(doc.id, ln.id, { received_confirmed: e.target.checked })}
                                disabled={
                                  busy ||
                                  Number(doc.finalized) === 1 ||
                                  Number(ln.assigned_admin_user_id || 0) !== Number(admin?.id || 0)
                                }
                              />
                              Received
                            </label>
                          </div>
                        </div>
                      ))}
                    </td>
                    <td>
                      {Number(doc.approved) === 1 ? (
                        <div style={{ fontSize: '0.75rem', color: 'var(--success)' }}>Approved</div>
                      ) : (
                        <div style={{ fontSize: '0.75rem', color: 'var(--danger)' }}>Pending approval</div>
                      )}
                      <button
                        type="button"
                        className="btn primary"
                        style={{ fontSize: '0.8rem', padding: '0.2rem 0.45rem' }}
                        onClick={() => api.invoices.downloadLpoPDF(invoice.id, doc.id)}
                        disabled={Number(doc.approved) !== 1}
                      >
                        Print PDF
                      </button>
                      {Number(doc.approved) !== 1 && (
                        <button
                          type="button"
                          className="btn"
                          style={{ fontSize: '0.8rem', padding: '0.2rem 0.45rem' }}
                          onClick={() => approveLpo(doc.id)}
                          disabled={busy || !canApproveLpoIpr}
                        >
                          Approve
                        </button>
                      )}
                      {Number(doc.finalized) !== 1 && (
                        <button
                          type="button"
                          className="btn primary"
                          style={{ fontSize: '0.8rem', padding: '0.2rem 0.45rem' }}
                          onClick={() => finalizeLpo(doc.id)}
                          disabled={busy || !canFinalizeLpos}
                        >
                          Finalise
                        </button>
                      )}
                      <button type="button" className="btn" style={{ fontSize: '0.8rem', padding: '0.2rem 0.45rem' }} onClick={() => openEditLpo(doc)} disabled={busy || !canCreateLpos}>
                        Edit
                      </button>
                      <button
                        type="button"
                        className="btn danger"
                        style={{ fontSize: '0.8rem', padding: '0.2rem 0.45rem' }}
                        onClick={() => deleteLpo(doc.id)}
                        disabled={busy || !canCreateLpos}
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {iprs.length > 0 && (
        <div style={{ marginBottom: '1rem' }}>
          <h4 style={{ margin: '0 0 0.5rem', fontSize: '0.95rem' }}>IPRs on this invoice</h4>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Ref</th>
                  <th>Status</th>
                  <th>Total</th>
                  <th>Lines</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {iprs.map((doc) => {
                  const isFinal = Number(doc.finalized) === 1;
                  return (
                    <tr key={doc.id}>
                      <td>
                        <strong>{doc.ref}</strong>
                      </td>
                      <td style={{ fontSize: '0.85rem' }}>{isFinal ? 'Finalised' : 'Draft'}</td>
                      <td>
                        <strong>{kes(doc.document_total)}</strong>
                        {Number(doc.document_vat) > 0 && (
                          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 400 }}>
                            {kes(doc.document_subtotal)} ex VAT + {kes(doc.document_vat)} VAT
                          </div>
                        )}
                      </td>
                      <td style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                        {(doc.lines || []).map((ln) => (
                          <div key={ln.id}>
                            {ln.description} → {ln.invoice_line_description} ({kes(ln.line_gross ?? lpoLineGross(ln))}
                            {lpoVatLabel(ln) !== 'No VAT' ? ` · ${lpoVatLabel(ln)}` : ''}
                            )
                            <div style={{ marginTop: '0.2rem', display: 'flex', gap: '0.35rem', alignItems: 'center' }}>
                              <select
                                value={ln.assigned_admin_user_id || ''}
                                onChange={(e) => updateIprLineReceipt(doc.id, ln.id, { assigned_admin_user_id: Number(e.target.value) || null })}
                                disabled={busy || isFinal || !canAssignReceivers}
                                style={{ maxWidth: '160px', fontSize: '0.75rem' }}
                              >
                                <option value="">Assign member…</option>
                                {teamMembers.map((tm) => (
                                  <option key={tm.id} value={tm.id}>{tm.display_name || tm.username}</option>
                                ))}
                              </select>
                              <label style={{ fontSize: '0.75rem', display: 'flex', alignItems: 'center', gap: '0.2rem' }}>
                                <input
                                  type="checkbox"
                                  checked={Number(ln.received_confirmed) === 1}
                                  onChange={(e) => updateIprLineReceipt(doc.id, ln.id, { received_confirmed: e.target.checked })}
                                  disabled={
                                    busy ||
                                    isFinal ||
                                    Number(ln.assigned_admin_user_id || 0) !== Number(admin?.id || 0)
                                  }
                                />
                                Received
                              </label>
                            </div>
                          </div>
                        ))}
                      </td>
                      <td>
                        {Number(doc.approved) === 1 ? (
                          <div style={{ fontSize: '0.75rem', color: 'var(--success)' }}>Approved</div>
                        ) : (
                          <div style={{ fontSize: '0.75rem', color: 'var(--danger)' }}>Pending approval</div>
                        )}
                        <button
                          type="button"
                          className="btn primary"
                          style={{ fontSize: '0.8rem', padding: '0.2rem 0.45rem' }}
                          onClick={() => api.invoices.downloadIprPDF(invoice.id, doc.id)}
                          disabled={Number(doc.approved) !== 1}
                        >
                          Print PDF
                        </button>
                        {Number(doc.approved) !== 1 && (
                          <button
                            type="button"
                            className="btn"
                            style={{ fontSize: '0.8rem', padding: '0.2rem 0.45rem' }}
                            onClick={() => approveIpr(doc.id)}
                            disabled={busy || !canApproveLpoIpr}
                          >
                            Approve
                          </button>
                        )}
                        {!isFinal && (
                          <>
                            <button
                              type="button"
                              className="btn"
                              style={{ fontSize: '0.8rem', padding: '0.2rem 0.45rem' }}
                              onClick={() => openEditIpr(doc)}
                              disabled={busy || !canCreateIprs}
                            >
                              Edit
                            </button>
                            <button
                              type="button"
                              className="btn primary"
                              style={{ fontSize: '0.8rem', padding: '0.2rem 0.45rem' }}
                              onClick={() => finalizeIprFromRow(doc.id)}
                              disabled={busy || !canFinalizeIprs}
                            >
                              Finalise
                            </button>
                            <button
                              type="button"
                              className="btn danger"
                              style={{ fontSize: '0.8rem', padding: '0.2rem 0.45rem' }}
                              onClick={() => deleteIpr(doc.id)}
                              disabled={busy || !canCreateIprs}
                            >
                              Delete
                            </button>
                          </>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {lpoModal && (
        <div className="modal-overlay" onClick={() => !busy && setLpoModal(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '920px' }}>
            <header>{editingLpo ? `Edit ${editingLpo.ref}` : 'Create LPO'}</header>
            <div className="body">
              <p style={{ margin: '0 0 1rem', fontSize: '0.9rem', color: 'var(--text-muted)' }}>
                <strong>Unit cost</strong> is <strong>exclusive of VAT</strong>. Choose per line: no VAT, standard VAT
                (16%), VAT exempt, or a custom rate. Amounts allocated to the invoice line use the <strong>net</strong>{' '}
                total only; VAT affects LPO totals, supplier balance, and PDFs.
              </p>
              <div className="form-group">
                <label>Supplier *</label>
                {suppliersLoading ? (
                  <p style={{ margin: 0 }}>Loading…</p>
                ) : (
                  <select value={lpoSupplierId} onChange={(e) => setLpoSupplierId(e.target.value)} style={{ width: '100%' }}>
                    <option value="">— Choose —</option>
                    {suppliers.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                )}
              </div>
              <div className="form-group">
                <label>Notes</label>
                <input value={lpoNotes} onChange={(e) => setLpoNotes(e.target.value)} placeholder="Optional" />
              </div>
              <div style={{ marginTop: '1rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                  <strong>LPO lines</strong>
                  <button type="button" className="btn" onClick={() => setLpoLines((rows) => [...rows, newFormLine()])}>
                    + Add line
                  </button>
                </div>
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Invoice line *</th>
                        <th>Purchase description *</th>
                        <th>Qty</th>
                        <th>Unit (ex VAT)</th>
                        <th>VAT</th>
                        <th></th>
                      </tr>
                    </thead>
                    <tbody>
                      {lpoLines.map((ln, idx) => (
                        <tr key={ln.key}>
                          <td>
                            <select
                              value={ln.invoice_item_id}
                              onChange={(e) => {
                                const v = e.target.value;
                                setLpoLines((rows) =>
                                  rows.map((r, i) => (i === idx ? { ...r, invoice_item_id: v } : r)),
                                );
                              }}
                              style={{ maxWidth: '200px' }}
                            >
                              <option value="">—</option>
                              {items.map((it) => (
                                <option key={it.id} value={it.id}>
                                  {(it.description || '').slice(0, 60)}
                                  {(it.description || '').length > 60 ? '…' : ''}
                                </option>
                              ))}
                            </select>
                          </td>
                          <td>
                            <input
                              value={ln.description}
                              onChange={(e) =>
                                setLpoLines((rows) => rows.map((r, i) => (i === idx ? { ...r, description: e.target.value } : r)))
                              }
                              placeholder="e.g. Paint 5L"
                              style={{ width: '100%', minWidth: '120px' }}
                            />
                          </td>
                          <td>
                            <input
                              type="number"
                              min="0.01"
                              step="0.01"
                              value={ln.quantity}
                              onChange={(e) =>
                                setLpoLines((rows) => rows.map((r, i) => (i === idx ? { ...r, quantity: e.target.value } : r)))
                              }
                              style={{ width: '4rem' }}
                            />
                          </td>
                          <td>
                            <input
                              type="number"
                              min="0"
                              step="0.01"
                              value={ln.unit_cost}
                              onChange={(e) =>
                                setLpoLines((rows) => rows.map((r, i) => (i === idx ? { ...r, unit_cost: e.target.value } : r)))
                              }
                              style={{ width: '5.5rem' }}
                            />
                          </td>
                          <td>
                            <select
                              value={ln.vat_mode}
                              onChange={(e) =>
                                setLpoLines((rows) =>
                                  rows.map((r, i) => (i === idx ? { ...r, vat_mode: e.target.value } : r)),
                                )
                              }
                              style={{ maxWidth: '9rem', fontSize: '0.85rem' }}
                            >
                              <option value="none">No VAT</option>
                              <option value="standard">VAT 16%</option>
                              <option value="exempt">VAT exempt</option>
                              <option value="custom">Custom %…</option>
                            </select>
                            {ln.vat_mode === 'custom' && (
                              <input
                                type="number"
                                min="0"
                                max="100"
                                step="0.01"
                                value={ln.vat_rate_custom}
                                onChange={(e) =>
                                  setLpoLines((rows) =>
                                    rows.map((r, i) => (i === idx ? { ...r, vat_rate_custom: e.target.value } : r)),
                                  )
                                }
                                placeholder="%"
                                title="VAT %"
                                style={{ width: '3.5rem', marginLeft: '0.25rem' }}
                              />
                            )}
                          </td>
                          <td>
                            {lpoLines.length > 1 && (
                              <button
                                type="button"
                                className="btn danger"
                                style={{ padding: '0.15rem 0.35rem', fontSize: '0.75rem' }}
                                onClick={() => setLpoLines((rows) => rows.filter((_, i) => i !== idx))}
                              >
                                ×
                              </button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
            <footer>
              <button type="button" className="btn" onClick={() => setLpoModal(false)} disabled={busy}>
                Cancel
              </button>
              <button type="button" className="btn primary" onClick={submitLpo} disabled={busy || suppliersLoading || !canCreateLpos}>
                {busy ? 'Saving…' : editingLpo ? 'Save LPO' : 'Create LPO'}
              </button>
            </footer>
          </div>
        </div>
      )}

      {iprModal && (
        <div className="modal-overlay" onClick={() => !busy && setIprModal(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '960px' }}>
            <header>{editingIpr ? `Edit ${editingIpr.ref}` : 'Create IPR'}</header>
            <div className="body">
              <p style={{ margin: '0 0 1rem', fontSize: '0.9rem', color: 'var(--text-muted)' }}>
                Same layout as an LPO: link each row to an <strong>invoice line</strong>, but the part must be a{' '}
                <strong>stock item</strong>. <strong>Unit cost</strong> is ex VAT (typically from the item&apos;s cost
                price). Save as <strong>draft</strong> or <strong>finalise</strong> to deduct stock.
              </p>
              <div className="form-group">
                <label>Search stock (filters row dropdowns)</label>
                <input
                  type="search"
                  value={iprStockQ}
                  onChange={(e) => setIprStockQ(e.target.value)}
                  placeholder="Code or name…"
                />
              </div>
              <div className="form-group">
                <label>Notes</label>
                <input value={iprNotes} onChange={(e) => setIprNotes(e.target.value)} placeholder="Optional" />
              </div>
              <div style={{ marginTop: '1rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                  <strong>IPR lines</strong>
                  <button type="button" className="btn" onClick={() => setIprLines((rows) => [...rows, newIprLine()])}>
                    + Add line
                  </button>
                </div>
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Invoice line *</th>
                        <th>Stock item *</th>
                        <th>Description *</th>
                        <th>Qty</th>
                        <th>Unit (ex VAT)</th>
                        <th>VAT</th>
                        <th></th>
                      </tr>
                    </thead>
                    <tbody>
                      {iprLines.map((ln, idx) => (
                        <tr key={ln.key}>
                          <td>
                            <select
                              value={ln.invoice_item_id}
                              onChange={(e) => {
                                const v = e.target.value;
                                setIprLines((rows) => rows.map((r, i) => (i === idx ? { ...r, invoice_item_id: v } : r)));
                              }}
                              style={{ maxWidth: '200px' }}
                            >
                              <option value="">—</option>
                              {items.map((it) => (
                                <option key={it.id} value={it.id}>
                                  {(it.description || '').slice(0, 60)}
                                  {(it.description || '').length > 60 ? '…' : ''}
                                </option>
                              ))}
                            </select>
                          </td>
                          <td>
                            {iprStockLoading ? (
                              <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>Loading…</span>
                            ) : (
                              <select
                                value={ln.stock_item_id}
                                onChange={(e) => {
                                  const v = e.target.value;
                                  const stock = iprStockList.find((s) => String(s.id) === v);
                                  setIprLines((rows) =>
                                    rows.map((r, i) => {
                                      if (i !== idx) return r;
                                      const next = { ...r, stock_item_id: v };
                                      if (stock) {
                                        next.unit_cost =
                                          stock.cost_price != null ? String(stock.cost_price) : String(r.unit_cost || '');
                                        const c = (stock.code || '').trim();
                                        const n = (stock.name || '').trim();
                                        next.description = c ? `${c} — ${n}` : n || r.description;
                                      }
                                      return next;
                                    }),
                                  );
                                }}
                                style={{ maxWidth: '220px', fontSize: '0.85rem' }}
                              >
                                <option value="">—</option>
                                {iprStockList.map((s) => (
                                  <option key={s.id} value={s.id}>
                                    {(s.code ? `${s.code} — ` : '') + s.name} (qty {s.quantity})
                                  </option>
                                ))}
                              </select>
                            )}
                          </td>
                          <td>
                            <input
                              value={ln.description}
                              onChange={(e) =>
                                setIprLines((rows) => rows.map((r, i) => (i === idx ? { ...r, description: e.target.value } : r)))
                              }
                              placeholder="From stock when selected"
                              style={{ width: '100%', minWidth: '120px' }}
                            />
                          </td>
                          <td>
                            <input
                              type="number"
                              min="0.01"
                              step="0.01"
                              value={ln.quantity}
                              onChange={(e) =>
                                setIprLines((rows) => rows.map((r, i) => (i === idx ? { ...r, quantity: e.target.value } : r)))
                              }
                              style={{ width: '4rem' }}
                            />
                          </td>
                          <td>
                            <input
                              type="number"
                              min="0"
                              step="0.01"
                              value={ln.unit_cost}
                              onChange={(e) =>
                                setIprLines((rows) => rows.map((r, i) => (i === idx ? { ...r, unit_cost: e.target.value } : r)))
                              }
                              style={{ width: '5.5rem' }}
                            />
                          </td>
                          <td>
                            <select
                              value={ln.vat_mode}
                              onChange={(e) =>
                                setIprLines((rows) =>
                                  rows.map((r, i) => (i === idx ? { ...r, vat_mode: e.target.value } : r)),
                                )
                              }
                              style={{ maxWidth: '9rem', fontSize: '0.85rem' }}
                            >
                              <option value="none">No VAT</option>
                              <option value="standard">VAT 16%</option>
                              <option value="exempt">VAT exempt</option>
                              <option value="custom">Custom %…</option>
                            </select>
                            {ln.vat_mode === 'custom' && (
                              <input
                                type="number"
                                min="0"
                                max="100"
                                step="0.01"
                                value={ln.vat_rate_custom}
                                onChange={(e) =>
                                  setIprLines((rows) =>
                                    rows.map((r, i) => (i === idx ? { ...r, vat_rate_custom: e.target.value } : r)),
                                  )
                                }
                                placeholder="%"
                                title="VAT %"
                                style={{ width: '3.5rem', marginLeft: '0.25rem' }}
                              />
                            )}
                          </td>
                          <td>
                            {iprLines.length > 1 && (
                              <button
                                type="button"
                                className="btn danger"
                                style={{ padding: '0.15rem 0.35rem', fontSize: '0.75rem' }}
                                onClick={() => setIprLines((rows) => rows.filter((_, i) => i !== idx))}
                              >
                                ×
                              </button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
            <footer>
              <button type="button" className="btn" onClick={() => setIprModal(false)} disabled={busy}>
                Cancel
              </button>
              <button type="button" className="btn" onClick={submitIprDraft} disabled={busy || iprStockLoading || !canCreateIprs}>
                {busy ? 'Saving…' : 'Save draft'}
              </button>
              <button
                type="button"
                className="btn primary"
                onClick={finalizeIprFromModal}
                disabled={busy || iprStockLoading || !canFinalizeIprs}
              >
                {busy ? 'Working…' : 'Save & finalise'}
              </button>
            </footer>
          </div>
        </div>
      )}
    </>
  );
}
