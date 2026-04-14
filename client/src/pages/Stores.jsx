import { Fragment, useEffect, useLayoutEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { api } from '../api';
import { useAdmin } from '../auth/AdminContext';

const RECEIVE_CATALOG_PREVIEW = 120;
const RECEIVE_CATALOG_FILTER_MAX = 300;

/** Filter/sort catalog for LPO “existing item” picker (search + capped list when unfiltered). */
function filteredReceiveCatalog(catalog, search) {
  const t = search.trim().toLowerCase();
  const sorted = [...catalog].sort((a, b) => {
    const ac = `${a.code || ''} ${a.name || ''}`;
    const bc = `${b.code || ''} ${b.name || ''}`;
    return ac.localeCompare(bc, undefined, { sensitivity: 'base' });
  });
  if (!t) return sorted.slice(0, RECEIVE_CATALOG_PREVIEW);
  return sorted
    .filter(
      (s) =>
        String(s.code || '')
          .toLowerCase()
          .includes(t) || String(s.name || '').toLowerCase().includes(t),
    )
    .slice(0, RECEIVE_CATALOG_FILTER_MAX);
}

/** Map GET /stock/lpos/:id line to receive form row */
function lineFromStockLpoDetail(ll) {
  const ve = Number(ll.vat_exempt) === 1;
  const vr = Number(ll.vat_rate) || 0;
  let vat_mode = 'none';
  if (ve) vat_mode = 'exempt';
  else if (vr === 16) vat_mode = 'standard';
  else if (vr > 0) vat_mode = 'custom';
  if (ll.stock_item_id) {
    return {
      lineId: ll.line_id,
      assigned_admin_user_id: ll.assigned_admin_user_id ?? '',
      received_confirmed: Number(ll.received_confirmed) === 1,
      key: `ln-${ll.line_id}-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      itemQuery: '',
      stock_item_id: String(ll.stock_item_id),
      stock_code: ll.stock_code || '',
      name: ll.stock_name || '',
      newPartSealed: true,
      quantity: String(ll.quantity),
      unit_cost: String(ll.unit_cost),
      sell_price: '',
      vat_mode,
      vat_rate_custom: vat_mode === 'custom' ? String(vr) : '',
    };
  }
  return {
    lineId: ll.line_id,
    assigned_admin_user_id: ll.assigned_admin_user_id ?? '',
    received_confirmed: Number(ll.received_confirmed) === 1,
    key: `ln-${ll.line_id}-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    itemQuery: '',
    stock_item_id: '',
    stock_code: ll.stock_code || '',
    name: ll.stock_name || ll.description || '',
    newPartSealed: true,
    quantity: String(ll.quantity),
    unit_cost: String(ll.unit_cost),
    sell_price: '',
    vat_mode,
    vat_rate_custom: vat_mode === 'custom' ? String(vr) : '',
  };
}

function newReceiveLine() {
  return {
    lineId: null,
    assigned_admin_user_id: '',
    received_confirmed: false,
    key: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    itemQuery: '',
    stock_item_id: '',
    stock_code: '',
    name: '',
    newPartSealed: false,
    quantity: '1',
    unit_cost: '',
    sell_price: '',
    vat_mode: 'none',
    vat_rate_custom: '',
  };
}

/** Collapsed item row (existing pick or new part after user finishes the name). */
function lineItemCollapsedForUi(ln) {
  if (ln.stock_item_id != null && String(ln.stock_item_id).trim()) return true;
  return Boolean(ln.stock_code?.trim() && ln.name?.trim() && ln.newPartSealed);
}

/** New part: code chosen from omnibar, user still typing name until Enter/blur seals it. */
function lineInNamingPhase(ln) {
  if (ln.stock_item_id != null && String(ln.stock_item_id).trim()) return false;
  return Boolean(ln.stock_code?.trim() && !ln.newPartSealed);
}

/** Enough data to save the LPO line (new parts don’t require seal — submit can seal implicitly). */
function lineItemReadyForSubmit(ln) {
  if (ln.stock_item_id != null && String(ln.stock_item_id).trim()) return true;
  return Boolean(ln.stock_code?.trim() && ln.name?.trim());
}

/** @returns {{ ok: true, body: object } | { ok: false, message: string }} */
function buildReceiveLpoPayload(receive, receiveCatalog) {
  if (!receive.supplier_id) {
    return { ok: false, message: 'Select a supplier' };
  }
  const lines = [];
  for (const ln of receive.lines) {
    const ready = lineItemReadyForSubmit(ln);
    const existingIdStr = ln.stock_item_id != null ? String(ln.stock_item_id).trim() : '';
    const isExisting = Boolean(existingIdStr);
    const code = ln.stock_code.trim();
    const nam = ln.name.trim();
    const qtyEmpty = !ln.quantity?.toString().trim();
    const costEmpty = !ln.unit_cost?.toString().trim();
    if (!ready && qtyEmpty && costEmpty) continue;
    if (!ready) {
      return {
        ok: false,
        message: 'Each line needs a part — search and pick stock, or create a new code and name',
      };
    }

    const qty = Number(ln.quantity);
    const uc = Number(ln.unit_cost);
    let vat_exempt = false;
    let vat_rate = 0;
    if (ln.vat_mode === 'exempt') vat_exempt = true;
    else if (ln.vat_mode === 'standard') vat_rate = 16;
    else if (ln.vat_mode === 'custom') {
      vat_rate = Number(ln.vat_rate_custom);
      if (!Number.isFinite(vat_rate) || vat_rate < 0 || vat_rate > 100) {
        const ref = isExisting ? 'this line' : code || nam || 'line';
        return { ok: false, message: `Custom VAT % must be 0–100 (${ref})` };
      }
    }
    const lineLabel = () => {
      if (isExisting) {
        const s = receiveCatalog.find((x) => String(x.id) === existingIdStr);
        return s ? `${s.code || '—'} — ${s.name}` : 'selected item';
      }
      return code || nam || 'line';
    };
    if (!qty || qty <= 0) {
      return { ok: false, message: `Enter a valid quantity for ${lineLabel()}` };
    }
    if (!Number.isFinite(uc) || uc < 0) {
      return { ok: false, message: `Enter a valid unit cost (ex VAT) for ${lineLabel()}` };
    }

    if (isExisting) {
      const sid = Number(existingIdStr);
      if (!Number.isFinite(sid) || sid <= 0) {
        return { ok: false, message: 'Invalid stock item selection' };
      }
      lines.push({
        stock_item_id: sid,
        quantity: qty,
        unit_cost: uc,
        vat_rate,
        vat_exempt,
      });
    } else {
      if (!code) return { ok: false, message: 'Each new line needs a stock code' };
      if (!nam) return { ok: false, message: 'Each new line needs a name' };
      const row = {
        stock_code: code,
        name: nam,
        quantity: qty,
        unit_cost: uc,
        vat_rate,
        vat_exempt,
      };
      if (ln.sell_price.trim() !== '') {
        const sp = Number(ln.sell_price);
        if (Number.isFinite(sp) && sp >= 0) row.sell_price = sp;
      }
      lines.push(row);
    }
  }
  if (lines.length === 0) {
    return { ok: false, message: 'Add at least one stock line' };
  }
  return {
    ok: true,
    body: {
      supplier_id: Number(receive.supplier_id),
      notes: receive.notes.trim() || undefined,
      lines,
    },
  };
}

export default function Stores() {
  const [list, setList] = useState([]);
  const [stockLpos, setStockLpos] = useState([]);
  const [q, setQ] = useState('');
  const [loading, setLoading] = useState(true);
  const [lposLoading, setLposLoading] = useState(true);
  const [modal, setModal] = useState(null);
  const [suppliers, setSuppliers] = useState([]);
  const [suppliersLoading, setSuppliersLoading] = useState(false);
  const [receiveCatalog, setReceiveCatalog] = useState([]);
  const [busy, setBusy] = useState(false);
  const [lpoSaveKind, setLpoSaveKind] = useState(null); // 'save' | 'finalize' while busy
  const { admin } = useAdmin();
  const canCreateLpos = admin?.permissions?.can_create_lpos;
  const canFinalizeLpos = admin?.permissions?.can_finalize_lpos;
  const canApproveLpoIpr = admin?.permissions?.can_approve_lpo_ipr;
  const canAssignReceivers = Boolean(admin?.permissions?.can_approve_lpo_ipr || admin?.permissions?.can_manage_team_members);
  const [form, setForm] = useState({ code: '', name: '', quantity: 0, sell_price: '' });
  const [receive, setReceive] = useState({
    editingLpoId: null,
    editingLpoRef: '',
    lpoApproved: false,
    supplier_id: '',
    notes: '',
    lines: [newReceiveLine()],
  });
  /** Which LPO line row has the stock omnibar dropdown open (null = closed) */
  const [lpoOmnibarOpenIdx, setLpoOmnibarOpenIdx] = useState(null);
  /** Viewport position for fixed dropdown (portal — avoids modal overflow clipping) */
  const [lpoOmnibarRect, setLpoOmnibarRect] = useState(null);
  const [teamMembers, setTeamMembers] = useState([]);
  const [stockTake, setStockTake] = useState({
    notes: '',
    query: '',
    lines: [],
  });

  useEffect(() => {
    api.admin.users.assignable().then(setTeamMembers).catch(() => setTeamMembers([]));
  }, []);

  const loadLpos = () =>
    api.stock
      .listStockLpos()
      .then(setStockLpos)
      .catch(console.error)
      .finally(() => setLposLoading(false));

  const load = () =>
    api.stock
      .list(q.trim() ? { q: q.trim() } : {})
      .then(setList)
      .catch(console.error)
      .finally(() => setLoading(false));

  useEffect(() => {
    setLoading(true);
    const t = setTimeout(load, 280);
    return () => clearTimeout(t);
  }, [q]);

  useEffect(() => {
    loadLpos();
  }, []);

  const openReceive = () => {
    setReceive({
      editingLpoId: null,
      editingLpoRef: '',
      lpoApproved: false,
      supplier_id: '',
      notes: '',
      lines: [newReceiveLine()],
    });
    setModal('receive');
    setSuppliersLoading(true);
    Promise.all([api.suppliers.list(), api.stock.list()])
      .then(([sup, cat]) => {
        setSuppliers(sup);
        setReceiveCatalog(Array.isArray(cat) ? cat : []);
      })
      .catch((e) => alert(e.message))
      .finally(() => setSuppliersLoading(false));
  };

  const openStockTake = async () => {
    setBusy(true);
    try {
      const rows = await api.stock.list();
      setStockTake({
        notes: '',
        query: '',
        lines: (rows || []).map((r) => {
          const qty = Number(r.quantity) || 0;
          return {
            stock_item_id: Number(r.id),
            code: r.code || '',
            name: r.name || '',
            system_quantity: qty,
            counted_quantity: String(qty),
          };
        }),
      });
      setModal('stock-take');
    } catch (e) {
      alert(e.message);
    } finally {
      setBusy(false);
    }
  };

  const openEditStockLpo = (lpoId) => {
    setSuppliersLoading(true);
    Promise.all([api.stock.getStockLpo(lpoId), api.suppliers.list(), api.stock.list()])
      .then(([detail, sup, cat]) => {
        if (Number(detail.lpo.finalized) === 1) {
          alert('This LPO is finalised and cannot be edited.');
          return;
        }
        setSuppliers(sup);
        setReceiveCatalog(Array.isArray(cat) ? cat : []);
        setReceive({
          editingLpoId: Number(lpoId),
          editingLpoRef: detail.lpo.ref || '',
          lpoApproved: Number(detail.lpo.approved) === 1,
          supplier_id: String(detail.lpo.supplier_id),
          notes: detail.lpo.notes || '',
          lines: detail.lines.length ? detail.lines.map(lineFromStockLpoDetail) : [newReceiveLine()],
        });
        setModal('receive');
      })
      .catch((e) => alert(e.message))
      .finally(() => setSuppliersLoading(false));
  };

  const closeReceiveModal = () => {
    if (busy) return;
    setLpoOmnibarOpenIdx(null);
    setLpoOmnibarRect(null);
    setModal(null);
    setReceive({
      editingLpoId: null,
      editingLpoRef: '',
      lpoApproved: false,
      supplier_id: '',
      notes: '',
      lines: [newReceiveLine()],
    });
  };

  const updateStockLineReceipt = async (lineId, patch) => {
    if (!receive.editingLpoId || !lineId) return;
    setBusy(true);
    try {
      await api.stock.updateStockLpoLineReceipt(receive.editingLpoId, lineId, patch);
      const detail = await api.stock.getStockLpo(receive.editingLpoId);
      setReceive((r) => ({
        ...r,
        lpoApproved: Number(detail.lpo.approved) === 1,
        lines: detail.lines.length ? detail.lines.map(lineFromStockLpoDetail) : [newReceiveLine()],
      }));
      load();
      loadLpos();
    } catch (err) {
      alert(err.message);
    } finally {
      setBusy(false);
    }
  };

  const approveStockLpoRow = async (lpoId) => {
    setBusy(true);
    try {
      await api.stock.approveStockLpo(lpoId);
      await loadLpos();
    } catch (err) {
      alert(err.message);
    } finally {
      setBusy(false);
    }
  };

  const approveStockLpoInModal = async () => {
    if (!receive.editingLpoId) return;
    setBusy(true);
    try {
      await api.stock.approveStockLpo(receive.editingLpoId);
      setReceive((r) => ({ ...r, lpoApproved: true }));
      await loadLpos();
    } catch (err) {
      alert(err.message);
    } finally {
      setBusy(false);
    }
  };

  useLayoutEffect(() => {
    if (modal !== 'receive' || lpoOmnibarOpenIdx == null) {
      setLpoOmnibarRect(null);
      return;
    }
    const el = document.querySelector(`[data-lpo-omnibar-input="${lpoOmnibarOpenIdx}"]`);
    if (!el) {
      setLpoOmnibarRect(null);
      return;
    }
    const sync = () => {
      const r = el.getBoundingClientRect();
      setLpoOmnibarRect({ top: r.top, left: r.left, width: r.width, bottom: r.bottom });
    };
    sync();
    window.addEventListener('resize', sync);
    window.addEventListener('scroll', sync, true);
    return () => {
      window.removeEventListener('resize', sync);
      window.removeEventListener('scroll', sync, true);
    };
  }, [modal, lpoOmnibarOpenIdx, receive.lines, suppliersLoading]);

  useEffect(() => {
    if (modal !== 'receive' || lpoOmnibarOpenIdx == null) return;
    const close = (e) => {
      if (
        e.target.closest('[data-lpo-omnibar-root]') ||
        e.target.closest('[data-lpo-omnibar-panel]')
      )
        return;
      setLpoOmnibarOpenIdx(null);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [modal, lpoOmnibarOpenIdx]);

  const openEdit = (row) => {
    const sp = row.sell_price;
    setForm({
      code: row.code || '',
      name: row.name || '',
      quantity: row.quantity ?? 0,
      sell_price:
        sp != null && Number.isFinite(Number(sp)) ? String(sp) : sp != null ? String(sp) : '',
    });
    setModal({ type: 'edit', id: row.id });
  };

  const submitEdit = async (e) => {
    e.preventDefault();
    if (!form.name?.trim()) return alert('Name is required');
    try {
      const qty = Number(form.quantity);
      const payload = {
        code: form.code.trim() || null,
        name: form.name.trim(),
        quantity: Number.isFinite(qty) ? qty : 0,
      };
      if (form.sell_price.trim() !== '') {
        const sp = Number(form.sell_price);
        if (!Number.isFinite(sp) || sp < 0) return alert('Sell price must be a valid non-negative number');
        payload.sell_price = sp;
      } else {
        payload.sell_price = 0;
      }
      await api.stock.update(modal.id, payload);
      setModal(null);
      load();
    } catch (err) {
      alert(err.message);
    }
  };

  const submitReceive = async (e) => {
    e.preventDefault();
    const parsed = buildReceiveLpoPayload(receive, receiveCatalog);
    if (!parsed.ok) return alert(parsed.message);
    const { body } = parsed;
    setBusy(true);
    setLpoSaveKind('save');
    try {
      if (receive.editingLpoId != null) {
        await api.stock.updateStockLpo(receive.editingLpoId, body);
      } else {
        await api.stock.receiveLpo(body);
      }
      setLpoOmnibarOpenIdx(null);
      setLpoOmnibarRect(null);
      setModal(null);
      setReceive({
        editingLpoId: null,
        editingLpoRef: '',
        lpoApproved: false,
        supplier_id: '',
        notes: '',
        lines: [newReceiveLine()],
      });
      load();
      loadLpos();
    } catch (err) {
      alert(err.message);
    } finally {
      setBusy(false);
      setLpoSaveKind(null);
    }
  };

  const finalizeLpoFromEditor = async () => {
    if (receive.editingLpoId == null) return;
    const parsed = buildReceiveLpoPayload(receive, receiveCatalog);
    if (!parsed.ok) return alert(parsed.message);
    if (
      !confirm(
        'Finalise this LPO? Use Save changes first if you edited lines (saving clears approval until you approve again). The LPO must be approved and every line marked received. The document will then be locked.',
      )
    )
      return;
    setBusy(true);
    setLpoSaveKind('finalize');
    try {
      await api.stock.finalizeStockLpo(receive.editingLpoId);
      setLpoOmnibarOpenIdx(null);
      setLpoOmnibarRect(null);
      setModal(null);
      setReceive({
        editingLpoId: null,
        editingLpoRef: '',
        lpoApproved: false,
        supplier_id: '',
        notes: '',
        lines: [newReceiveLine()],
      });
      load();
      loadLpos();
    } catch (err) {
      alert(err.message);
    } finally {
      setBusy(false);
      setLpoSaveKind(null);
    }
  };

  const remove = async (id) => {
    if (!confirm('Delete this stock item?')) return;
    try {
      await api.stock.delete(id);
      setModal(null);
      load();
    } catch (err) {
      alert(err.message);
    }
  };

  const deleteStockLpo = async (lpoId) => {
    if (
      !confirm(
        'Delete this stock intake LPO? Received quantity will be removed from stock (only if enough quantity remains).',
      )
    )
      return;
    try {
      await api.stock.deleteStockLpo(lpoId);
      load();
      loadLpos();
    } catch (err) {
      alert(err.message);
    }
  };

  const submitStockTake = async (e) => {
    e.preventDefault();
    const lines = stockTake.lines
      .map((ln) => ({
        ...ln,
        counted_num: Number(ln.counted_quantity),
      }))
      .filter((ln) => Number.isFinite(ln.counted_num) && ln.counted_num >= 0)
      .filter((ln) => Math.abs(ln.counted_num - Number(ln.system_quantity || 0)) > 0.000001)
      .map((ln) => ({
        stock_item_id: ln.stock_item_id,
        counted_quantity: ln.counted_num,
      }));
    if (!lines.length) {
      alert('No quantity changes detected. Edit counted quantities first.');
      return;
    }
    if (!confirm(`Apply stock take for ${lines.length} changed item(s)?`)) return;
    setBusy(true);
    try {
      const out = await api.stock.stockTake({
        notes: stockTake.notes.trim() || undefined,
        lines,
      });
      setModal(null);
      load();
      alert(`Stock take applied. ${Number(out?.adjusted_count || 0)} item(s) reconciled.`);
    } catch (err) {
      alert(err.message);
    } finally {
      setBusy(false);
    }
  };

  function kes(n) {
    const x = Number(n);
    if (Number.isNaN(x)) return '—';
    return `KES ${x.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
  }

  return (
    <>
      <h1 className="page-title">Stores</h1>
      <p style={{ color: 'var(--text-muted)', marginBottom: '1rem' }}>
        Record a <strong>supplier LPO</strong> to order stock: after <strong>approval</strong>, print the LPO, then assign
        receivers and mark each line <strong>received</strong> when goods arrive (quantities increase then).{' '}
        <strong>New</strong> parts get code, name, and optional sell price; change sell price later via <strong>Edit</strong>{' '}
        on the table. Use IPR on an invoice line to deduct from stock.
      </p>
      <div className="search-bar">
        <input
          type="search"
          placeholder="Search by code or name…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <button type="button" className="btn primary" onClick={openReceive}>
          Receive stock (LPO)
        </button>
        <button type="button" className="btn" onClick={openStockTake} disabled={!canCreateLpos || busy}>
          Stock take
        </button>
      </div>

      <div className="card" style={{ marginBottom: '1.25rem' }}>
        <h2 style={{ marginTop: 0, fontSize: '1.05rem' }}>Stock intake LPOs</h2>
        <p style={{ fontSize: '0.9rem', color: 'var(--text-muted)', marginTop: 0 }}>
          Only <strong>draft</strong> intake LPOs appear here. <strong>Approve</strong> then print; mark lines received
          when stock arrives; then <strong>finalise</strong>. Finalised documents are listed on <strong>LPO / IPR</strong>.
          Totals include VAT where set.
        </p>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Ref</th>
                <th>Supplier</th>
                <th>Total</th>
                <th>Date</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {lposLoading && (
                <tr>
                  <td colSpan={5}>Loading…</td>
                </tr>
              )}
              {!lposLoading && stockLpos.length === 0 && (
                <tr>
                  <td colSpan={5} className="empty">
                    No draft stock intake LPOs. Use Receive stock (LPO) to create one, or see finalised documents on
                    LPO / IPR.
                  </td>
                </tr>
              )}
              {!lposLoading &&
                stockLpos.map((row) => (
                  <tr key={row.lpo_id}>
                    <td>
                      <strong>{row.ref}</strong>
                    </td>
                    <td>{row.supplier_name || '—'}</td>
                    <td>{kes(row.document_total)}</td>
                    <td style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>
                      {row.created_at ? new Date(row.created_at).toLocaleString() : '—'}
                    </td>
                    <td>
                      <button
                        type="button"
                        className="btn"
                        style={{ fontSize: '0.8rem', padding: '0.2rem 0.45rem' }}
                        onClick={() => openEditStockLpo(row.lpo_id)}
                        disabled={!canCreateLpos}
                      >
                        Edit
                      </button>
                      {Number(row.approved) !== 1 && (
                        <button
                          type="button"
                          className="btn"
                          style={{ fontSize: '0.8rem', padding: '0.2rem 0.45rem' }}
                          onClick={() => approveStockLpoRow(row.lpo_id)}
                          disabled={busy || !canApproveLpoIpr}
                        >
                          Approve
                        </button>
                      )}
                      <button
                        type="button"
                        className="btn primary"
                        style={{ fontSize: '0.8rem', padding: '0.2rem 0.45rem' }}
                        onClick={() => api.stock.downloadStockLpoPdf(row.lpo_id)}
                        disabled={Number(row.approved) !== 1}
                        title={Number(row.approved) !== 1 ? 'Approve the LPO before printing' : undefined}
                      >
                        Print PDF
                      </button>
                      <button
                        type="button"
                        className="btn danger"
                        style={{ fontSize: '0.8rem', padding: '0.2rem 0.45rem' }}
                        onClick={() => deleteStockLpo(row.lpo_id)}
                        disabled={!canCreateLpos}
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

      <div className="card">
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Code</th>
                <th>Name</th>
                <th>Quantity</th>
                <th>Sell</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr>
                  <td colSpan={5}>Loading…</td>
                </tr>
              )}
              {!loading && list.length === 0 && (
                <tr>
                  <td colSpan={5} className="empty">
                    No store items yet. Receive stock with an LPO to add items.
                  </td>
                </tr>
              )}
              {!loading &&
                list.map((row) => (
                  <tr key={row.id}>
                    <td>{row.code || '—'}</td>
                    <td>
                      <strong>{row.name}</strong>
                    </td>
                    <td>{row.quantity}</td>
                    <td>{kes(row.sell_price)}</td>
                    <td>
                      <button type="button" className="btn" onClick={() => openEdit(row)}>
                        Edit
                      </button>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </div>

      {modal === 'receive' && (
        <div className="modal-overlay" onClick={() => closeReceiveModal()}>
          <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '960px' }}>
            <header>
              {receive.editingLpoId != null
                ? `Edit stock LPO ${receive.editingLpoRef || ''}`.trim()
                : 'Receive stock (supplier LPO)'}
            </header>
            <form className="body" onSubmit={submitReceive}>
              <p style={{ margin: '0 0 1rem', fontSize: '0.9rem', color: 'var(--text-muted)' }}>
                {receive.editingLpoId != null ? (
                  <>
                    Review lines below. <strong>Approve</strong> the LPO, then assign receivers and tick{' '}
                    <strong>Received</strong> when goods arrive (store quantity increases per line). Use{' '}
                    <strong>Save changes</strong> to update the draft, then <strong>Finalise LPO</strong> when every line
                    is received — that locks the document.
                  </>
                ) : (
                  <>
                    One draft LPO per supplier delivery. After saving from this screen, <strong>approve</strong> it,
                    print, mark lines received, then finalise. Use the <strong>item</strong> field to search stock or type
                    a new code. Cost is ex VAT; optional sell price applies only when creating a new part.
                  </>
                )}
              </p>
              <div className="form-group">
                <label>Supplier *</label>
                {suppliersLoading ? (
                  <p style={{ margin: 0 }}>Loading…</p>
                ) : (
                  <select
                    value={receive.supplier_id}
                    onChange={(e) => setReceive({ ...receive, supplier_id: e.target.value })}
                    required
                    style={{ width: '100%' }}
                  >
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
                <label>LPO notes</label>
                <input
                  value={receive.notes}
                  onChange={(e) => setReceive({ ...receive, notes: e.target.value })}
                  placeholder="Optional — applies to whole LPO"
                />
              </div>
              <div style={{ marginTop: '1rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                  <strong>Lines</strong>
                  <button type="button" className="btn" onClick={() => setReceive((r) => ({ ...r, lines: [...r.lines, newReceiveLine()] }))}>
                    + Add line
                  </button>
                </div>
                <div className="table-wrap">
                  <table style={{ fontSize: '0.85rem' }}>
                    <thead>
                      <tr>
                        <th style={{ minWidth: '12rem' }}>Item *</th>
                        <th>Qty *</th>
                        <th>Cost ex *</th>
                        <th>Sell</th>
                        <th>VAT</th>
                        <th></th>
                      </tr>
                    </thead>
                    <tbody>
                      {receive.lines.map((ln, idx) => {
                        const selId =
                          ln.stock_item_id != null && String(ln.stock_item_id).trim()
                            ? String(ln.stock_item_id).trim()
                            : '';
                        const isExisting = Boolean(selId);
                        const itemCollapsed = lineItemCollapsedForUi(ln);
                        const inNaming = lineInNamingPhase(ln);
                        const picked =
                          selId && receiveCatalog.length
                            ? receiveCatalog.find((s) => String(s.id) === selId)
                            : null;
                        const ucNum = Number(ln.unit_cost);
                        const listedSell = picked != null ? Number(picked.sell_price) : NaN;
                        const costExceedsSell =
                          isExisting &&
                          picked &&
                          Number.isFinite(ucNum) &&
                          Number.isFinite(listedSell) &&
                          listedSell > 0 &&
                          ucNum > listedSell;
                        const collapsedLabel = picked
                          ? `${(picked.code || '—').trim()} — ${picked.name}`
                          : `${(ln.stock_code || '').trim()} — ${(ln.name || '').trim()}`;
                        return (
                        <Fragment key={ln.key}>
                        <tr>
                          <td style={{ minWidth: '13rem', maxWidth: '22rem', verticalAlign: 'top' }}>
                            {itemCollapsed ? (
                              <div
                                style={{
                                  display: 'flex',
                                  alignItems: 'flex-start',
                                  justifyContent: 'space-between',
                                  gap: '0.5rem',
                                  padding: '0.25rem 0',
                                }}
                              >
                                <div style={{ fontSize: '0.82rem', lineHeight: 1.35, minWidth: 0 }}>
                                  <strong>{collapsedLabel}</strong>
                                  {isExisting && picked && (
                                    <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '0.15rem' }}>
                                      On hand {picked.quantity ?? 0} · sell {kes(picked.sell_price)}
                                    </div>
                                  )}
                                </div>
                                <button
                                  type="button"
                                  className="btn"
                                  style={{ padding: '0.12rem 0.4rem', fontSize: '0.72rem', flexShrink: 0 }}
                                  onClick={() => {
                                    setLpoOmnibarOpenIdx(null);
                                    setLpoOmnibarRect(null);
                                    setReceive((r) => ({
                                      ...r,
                                      lines: r.lines.map((x, i) =>
                                        i === idx
                                          ? {
                                              ...x,
                                              lineId: null,
                                              assigned_admin_user_id: '',
                                              received_confirmed: false,
                                              stock_item_id: '',
                                              stock_code: '',
                                              name: '',
                                              itemQuery: '',
                                              newPartSealed: false,
                                            }
                                          : x,
                                      ),
                                    }));
                                  }}
                                >
                                  Change
                                </button>
                              </div>
                            ) : inNaming ? (
                              <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', flexWrap: 'wrap' }}>
                                <span
                                  style={{
                                    fontSize: '0.78rem',
                                    fontWeight: 600,
                                    color: 'var(--text-muted)',
                                    maxWidth: '6rem',
                                    overflow: 'hidden',
                                    textOverflow: 'ellipsis',
                                  }}
                                  title={ln.stock_code}
                                >
                                  {ln.stock_code}
                                </span>
                                <input
                                  value={ln.name}
                                  onChange={(e) =>
                                    setReceive((r) => ({
                                      ...r,
                                      lines: r.lines.map((x, i) =>
                                        i === idx ? { ...x, name: e.target.value } : x,
                                      ),
                                    }))
                                  }
                                  onBlur={() => {
                                    if (!ln.name?.trim()) return;
                                    setReceive((r) => ({
                                      ...r,
                                      lines: r.lines.map((x, i) =>
                                        i === idx ? { ...x, newPartSealed: true } : x,
                                      ),
                                    }));
                                  }}
                                  onKeyDown={(e) => {
                                    if (e.key === 'Enter') {
                                      e.preventDefault();
                                      if (!ln.name?.trim()) return;
                                      setReceive((r) => ({
                                        ...r,
                                        lines: r.lines.map((x, i) =>
                                          i === idx ? { ...x, newPartSealed: true } : x,
                                        ),
                                      }));
                                    }
                                  }}
                                  placeholder="Part name * — Enter or click away when done"
                                  autoComplete="off"
                                  style={{ flex: '1 1 8rem', minWidth: '6rem', fontSize: '0.85rem' }}
                                />
                              </div>
                            ) : (
                              <div
                                data-lpo-omnibar-root={idx}
                                style={{ position: 'relative' }}
                              >
                                <input
                                  type="search"
                                  data-lpo-omnibar-input={idx}
                                  value={ln.itemQuery || ''}
                                  disabled={suppliersLoading}
                                  onChange={(e) => {
                                    const v = e.target.value;
                                    setReceive((r) => ({
                                      ...r,
                                      lines: r.lines.map((x, i) =>
                                        i === idx ? { ...x, itemQuery: v } : x,
                                      ),
                                    }));
                                    setLpoOmnibarOpenIdx(idx);
                                  }}
                                  onFocus={() => setLpoOmnibarOpenIdx(idx)}
                                  onKeyDown={(e) => {
                                    if (e.key === 'Escape') {
                                      setLpoOmnibarOpenIdx(null);
                                      setLpoOmnibarRect(null);
                                    }
                                  }}
                                  placeholder={
                                    suppliersLoading
                                      ? 'Loading stock…'
                                      : 'Search stock or type new code…'
                                  }
                                  autoComplete="off"
                                  style={{ width: '100%', fontSize: '0.85rem', boxSizing: 'border-box' }}
                                />
                              </div>
                            )}
                          </td>
                          <td>
                            <input
                              type="number"
                              min="0.01"
                              step="0.01"
                              value={ln.quantity}
                              onChange={(e) =>
                                setReceive((r) => ({
                                  ...r,
                                  lines: r.lines.map((x, i) => (i === idx ? { ...x, quantity: e.target.value } : x)),
                                }))
                              }
                              style={{ width: '3.5rem' }}
                            />
                          </td>
                          <td>
                            <div>
                              <input
                                type="number"
                                min="0"
                                step="0.01"
                                value={ln.unit_cost}
                                onChange={(e) =>
                                  setReceive((r) => ({
                                    ...r,
                                    lines: r.lines.map((x, i) =>
                                      i === idx ? { ...x, unit_cost: e.target.value } : x,
                                    ),
                                  }))
                                }
                                style={{ width: '4.5rem' }}
                              />
                              {costExceedsSell && (
                                <div
                                  style={{
                                    fontSize: '0.68rem',
                                    color: '#b91c1c',
                                    marginTop: '0.2rem',
                                    maxWidth: '7.5rem',
                                    lineHeight: 1.25,
                                  }}
                                >
                                  Unit cost is above listed sell — check margin.
                                </div>
                              )}
                            </div>
                          </td>
                          <td>
                            {isExisting ? (
                              picked ? (
                                <div
                                  style={{ fontSize: '0.78rem' }}
                                  title="Not updated on this LPO — change via Edit on the stock table"
                                >
                                  <strong>{kes(picked.sell_price)}</strong>
                                  <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', marginTop: '0.15rem' }}>
                                    listed sell
                                  </div>
                                </div>
                              ) : (
                                <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>—</span>
                              )
                            ) : (
                              <input
                                type="number"
                                min="0"
                                step="0.01"
                                value={ln.sell_price}
                                onChange={(e) =>
                                  setReceive((r) => ({
                                    ...r,
                                    lines: r.lines.map((x, i) =>
                                      i === idx ? { ...x, sell_price: e.target.value } : x,
                                    ),
                                  }))
                                }
                                placeholder="Optional"
                                style={{ width: '4rem' }}
                              />
                            )}
                          </td>
                          <td>
                            <select
                              value={ln.vat_mode}
                              onChange={(e) =>
                                setReceive((r) => ({
                                  ...r,
                                  lines: r.lines.map((x, i) => (i === idx ? { ...x, vat_mode: e.target.value } : x)),
                                }))
                              }
                              style={{ maxWidth: '5.5rem', fontSize: '0.8rem' }}
                            >
                              <option value="none">No VAT</option>
                              <option value="standard">16%</option>
                              <option value="exempt">Exempt</option>
                              <option value="custom">%…</option>
                            </select>
                            {ln.vat_mode === 'custom' && (
                              <input
                                type="number"
                                min="0"
                                max="100"
                                step="0.01"
                                value={ln.vat_rate_custom}
                                onChange={(e) =>
                                  setReceive((r) => ({
                                    ...r,
                                    lines: r.lines.map((x, i) =>
                                      i === idx ? { ...x, vat_rate_custom: e.target.value } : x,
                                    ),
                                  }))
                                }
                                placeholder="%"
                                style={{ width: '2.75rem', marginLeft: '0.15rem' }}
                              />
                            )}
                          </td>
                          <td>
                            {receive.lines.length > 1 && (
                              <button
                                type="button"
                                className="btn danger"
                                style={{ padding: '0.15rem 0.35rem', fontSize: '0.75rem' }}
                                onClick={() =>
                                  setReceive((r) => ({ ...r, lines: r.lines.filter((_, i) => i !== idx) }))
                                }
                              >
                                ×
                              </button>
                            )}
                          </td>
                        </tr>
                        {receive.editingLpoId != null && ln.lineId != null && ln.lineId !== '' && (
                          <tr style={{ background: 'rgba(0,0,0,0.02)' }}>
                            <td colSpan={6} style={{ paddingTop: '0.25rem', paddingBottom: '0.5rem' }}>
                              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', alignItems: 'center' }}>
                                <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>Receipt:</span>
                                <select
                                  value={ln.assigned_admin_user_id !== '' && ln.assigned_admin_user_id != null ? String(ln.assigned_admin_user_id) : ''}
                                  onChange={(e) =>
                                    updateStockLineReceipt(ln.lineId, {
                                      assigned_admin_user_id: e.target.value ? Number(e.target.value) : null,
                                    })
                                  }
                                  disabled={busy || !receive.lpoApproved || !canAssignReceivers}
                                  style={{ maxWidth: '11rem', fontSize: '0.78rem' }}
                                >
                                  <option value="">Assign member…</option>
                                  {teamMembers.map((tm) => (
                                    <option key={tm.id} value={tm.id}>
                                      {tm.display_name || tm.username}
                                    </option>
                                  ))}
                                </select>
                                <label style={{ fontSize: '0.78rem', display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                                  <input
                                    type="checkbox"
                                    checked={Boolean(ln.received_confirmed)}
                                    onChange={(e) =>
                                      updateStockLineReceipt(ln.lineId, { received_confirmed: e.target.checked })
                                    }
                                    disabled={
                                      busy ||
                                      !receive.lpoApproved ||
                                      Number(ln.assigned_admin_user_id || 0) !== Number(admin?.id || 0)
                                    }
                                  />
                                  Received
                                </label>
                              </div>
                            </td>
                          </tr>
                        )}
                        </Fragment>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            </form>
            <footer style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', justifyContent: 'flex-end' }}>
              <button type="button" className="btn" onClick={() => closeReceiveModal()} disabled={busy}>
                Cancel
              </button>
              {receive.editingLpoId != null && !receive.lpoApproved && (
                <button
                  type="button"
                  className="btn"
                  onClick={() => approveStockLpoInModal()}
                  disabled={busy || suppliersLoading || !canApproveLpoIpr}
                >
                  Approve LPO
                </button>
              )}
              {receive.editingLpoId != null && (
                <button
                  type="button"
                  className="btn"
                  onClick={() => finalizeLpoFromEditor()}
                  disabled={
                    busy ||
                    suppliersLoading ||
                    !canFinalizeLpos ||
                    !receive.lpoApproved ||
                    !receive.lines.length ||
                    !receive.lines.every((ln) => Number(ln.received_confirmed) === 1)
                  }
                  title={
                    !receive.lpoApproved
                      ? 'Approve the LPO first'
                      : !receive.lines.every((ln) => Number(ln.received_confirmed) === 1)
                        ? 'Mark every line as received before finalising'
                        : undefined
                  }
                >
                  {busy && lpoSaveKind === 'finalize' ? 'Finalising…' : 'Finalise LPO'}
                </button>
              )}
              <button
                type="button"
                className="btn primary"
                onClick={submitReceive}
                disabled={busy || suppliersLoading || !canCreateLpos}
              >
                {busy && lpoSaveKind === 'finalize'
                  ? 'Save changes'
                  : busy && lpoSaveKind === 'save'
                    ? receive.editingLpoId != null
                      ? 'Saving…'
                      : 'Creating…'
                    : receive.editingLpoId != null
                      ? 'Save changes'
                      : 'Create draft LPO'}
              </button>
            </footer>
          </div>
        </div>
      )}

      {modal?.type === 'edit' && (
        <div className="modal-overlay" onClick={() => setModal(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <header>Edit store item</header>
            <form className="body" onSubmit={submitEdit}>
              <div className="form-group">
                <label>Code</label>
                <input
                  value={form.code}
                  onChange={(e) => setForm({ ...form, code: e.target.value })}
                  placeholder="SKU / part no."
                />
              </div>
              <div className="form-group">
                <label>Name *</label>
                <input
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  required
                  placeholder="e.g. Oil filter 1.6"
                />
              </div>
              <div className="form-group">
                <label>Quantity on hand</label>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={form.quantity}
                  onChange={(e) => setForm({ ...form, quantity: e.target.value })}
                />
              </div>
              <div className="form-group">
                <label>Sell price (KES)</label>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={form.sell_price}
                  onChange={(e) => setForm({ ...form, sell_price: e.target.value })}
                  placeholder="0"
                />
                <p style={{ margin: '0.35rem 0 0', fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                  This is the usual place to set or change sell price after the item exists.
                </p>
              </div>
            </form>
            <footer>
              <button type="button" className="btn danger" onClick={() => remove(modal.id)}>
                Delete
              </button>
              <button type="button" className="btn" onClick={() => setModal(null)}>
                Cancel
              </button>
              <button type="button" className="btn primary" onClick={submitEdit}>
                Save
              </button>
            </footer>
          </div>
        </div>
      )}

      {modal === 'stock-take' && (
        <div className="modal-overlay" onClick={() => (busy ? null : setModal(null))}>
          <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '980px' }}>
            <header>Stock take</header>
            <form className="body" onSubmit={submitStockTake}>
              <p style={{ margin: '0 0 1rem', fontSize: '0.9rem', color: 'var(--text-muted)' }}>
                Enter physically counted quantities. Only changed lines are applied to reconcile system stock.
              </p>
              <div className="form-group">
                <label>Notes (optional)</label>
                <input
                  value={stockTake.notes}
                  onChange={(e) => setStockTake((s) => ({ ...s, notes: e.target.value }))}
                  placeholder="e.g. Opening balance / monthly cycle count"
                />
              </div>
              <div className="form-group">
                <label>Filter items</label>
                <input
                  value={stockTake.query}
                  onChange={(e) => setStockTake((s) => ({ ...s, query: e.target.value }))}
                  placeholder="Search code or name…"
                />
              </div>
              <div className="table-wrap" style={{ maxHeight: '52vh', overflow: 'auto' }}>
                <table style={{ fontSize: '0.85rem' }}>
                  <thead>
                    <tr>
                      <th>Code</th>
                      <th>Name</th>
                      <th>System qty</th>
                      <th>Counted qty</th>
                    </tr>
                  </thead>
                  <tbody>
                    {stockTake.lines
                      .filter((ln) => {
                        const qx = stockTake.query.trim().toLowerCase();
                        if (!qx) return true;
                        return `${ln.code || ''} ${ln.name || ''}`.toLowerCase().includes(qx);
                      })
                      .map((ln) => (
                        <tr key={ln.stock_item_id}>
                          <td>{ln.code || '—'}</td>
                          <td>
                            <strong>{ln.name}</strong>
                          </td>
                          <td>{Number(ln.system_quantity || 0)}</td>
                          <td>
                            <input
                              type="number"
                              min="0"
                              step="0.01"
                              value={ln.counted_quantity}
                              onChange={(e) =>
                                setStockTake((s) => ({
                                  ...s,
                                  lines: s.lines.map((x) =>
                                    x.stock_item_id === ln.stock_item_id
                                      ? { ...x, counted_quantity: e.target.value }
                                      : x,
                                  ),
                                }))
                              }
                              style={{ width: '6.5rem' }}
                            />
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            </form>
            <footer>
              <button type="button" className="btn" onClick={() => setModal(null)} disabled={busy}>
                Cancel
              </button>
              <button type="button" className="btn primary" onClick={submitStockTake} disabled={busy}>
                {busy ? 'Applying…' : 'Apply stock take'}
              </button>
            </footer>
          </div>
        </div>
      )}

      {modal === 'receive' &&
        lpoOmnibarOpenIdx !== null &&
        lpoOmnibarRect &&
        !suppliersLoading &&
        (() => {
          const idx = lpoOmnibarOpenIdx;
          const ln = receive.lines[idx];
          if (!ln || lineItemCollapsedForUi(ln) || lineInNamingPhase(ln)) return null;
          const q = (ln.itemQuery || '').trim();
          const filtered = filteredReceiveCatalog(receiveCatalog, ln.itemQuery || '');
          const panelMaxH = Math.min(
            320,
            typeof window !== 'undefined' ? window.innerHeight - lpoOmnibarRect.bottom - 16 : 320,
          );
          return createPortal(
            <div
              data-lpo-omnibar-panel
              className="lpo-omnibar-panel"
              style={{
                position: 'fixed',
                top: lpoOmnibarRect.bottom + 2,
                left: lpoOmnibarRect.left,
                width: Math.max(lpoOmnibarRect.width, 220),
                maxHeight: Math.max(120, panelMaxH),
                overflowY: 'auto',
                zIndex: 10050,
                background: 'var(--surface)',
                border: '1px solid var(--border)',
                borderRadius: 'var(--radius, 6px)',
                boxShadow: '0 10px 40px rgba(0,0,0,0.45)',
              }}
            >
              {q ? (
                <button
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => {
                    setReceive((r) => ({
                      ...r,
                      lines: r.lines.map((x, i) =>
                        i === idx
                          ? {
                              ...x,
                              stock_item_id: '',
                              stock_code: q,
                              name: '',
                              itemQuery: '',
                              newPartSealed: false,
                            }
                          : x,
                      ),
                    }));
                    setLpoOmnibarOpenIdx(null);
                    setLpoOmnibarRect(null);
                  }}
                  style={{
                    display: 'block',
                    width: '100%',
                    textAlign: 'left',
                    padding: '0.45rem 0.5rem',
                    fontSize: '0.8rem',
                    border: 'none',
                    borderBottom: '1px solid var(--border)',
                    background: 'rgba(255,255,255,0.04)',
                    color: 'var(--text)',
                    cursor: 'pointer',
                  }}
                >
                  + New part · code <strong>{q}</strong> — then type the full name
                </button>
              ) : null}
              {!q && receiveCatalog.length > RECEIVE_CATALOG_PREVIEW && (
                <div
                  style={{
                    padding: '0.35rem 0.5rem',
                    fontSize: '0.72rem',
                    color: 'var(--text-muted)',
                    borderBottom: '1px solid var(--border)',
                  }}
                >
                  Type to search ({RECEIVE_CATALOG_PREVIEW} shown when empty)
                </div>
              )}
              {filtered.length === 0 ? (
                <div style={{ padding: '0.5rem', fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                  {q ? 'No matches — use “New part” above or refine search' : 'No stock yet'}
                </div>
              ) : (
                filtered.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => {
                      setReceive((r) => ({
                        ...r,
                        lines: r.lines.map((x, i) =>
                          i === idx
                            ? {
                                ...x,
                                stock_item_id: String(s.id),
                                stock_code: '',
                                name: '',
                                itemQuery: '',
                                newPartSealed: true,
                              }
                            : x,
                        ),
                      }));
                      setLpoOmnibarOpenIdx(null);
                      setLpoOmnibarRect(null);
                    }}
                    style={{
                      display: 'block',
                      width: '100%',
                      textAlign: 'left',
                      padding: '0.4rem 0.5rem',
                      fontSize: '0.78rem',
                      border: 'none',
                      borderBottom: '1px solid var(--border)',
                      background: 'transparent',
                      color: 'var(--text)',
                      cursor: 'pointer',
                    }}
                  >
                    {(s.code || '—').trim()} — {s.name}{' '}
                    <span style={{ color: 'var(--text-muted)' }}>
                      · {s.quantity ?? 0} · {kes(s.sell_price)}
                    </span>
                  </button>
                ))
              )}
            </div>,
            document.body,
          );
        })()}
    </>
  );
}
