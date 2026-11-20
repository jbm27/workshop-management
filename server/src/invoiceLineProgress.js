import { db } from './db.js';

/**
 * Per-line progress for invoice lines: Approved → LPO issued → Received → Fitted.
 * (Vehicle tested is one tick for the whole job: jobs.vehicle_tested_at, shown next to the quote total.)
 *
 * Each stage is done when EITHER staff ticked it on the invoice line (the *_at columns)
 * OR the workshop's existing records already show it:
 *   - Approved:   the customer approved the matching quote line (linked by quote_item_id,
 *                 or the same description on the job's quote), or the line itself is approved.
 *   - LPO issued: an LPO or IPR line is attached to this invoice line.
 *   - Received:   every attached LPO/IPR part is marked received.
 *   - Fitted:     every attached LPO part is marked fitted (IPR stock issues have no fitted step).
 * Stages that come from those records are flagged `auto` so staff know to change them on the LPO/IPR.
 */
export const PROGRESS_STAGES = ['approved', 'lpo_issued', 'received', 'fitted'];
export const MANUAL_STAGES = ['lpo_issued', 'received', 'fitted'];

function norm(s) {
  return String(s || '').trim().toLowerCase();
}

function latest(values) {
  const v = values.filter(Boolean).sort();
  return v.length ? v[v.length - 1] : null;
}

/** Lines that get a tracker: real items, not section headers and not the job's labour line. */
export function isTrackedLine(item) {
  const t = String(item?.type || '').toLowerCase();
  return !!item && t !== 'header' && t !== 'labour';
}

/**
 * Adds `progress` to each tracked item of an invoice (mutates and returns `items`).
 * `includeWho` adds staff names; the customer portal leaves them out.
 */
export function attachInvoiceLineProgress(invoiceId, items, { includeWho = false } = {}) {
  if (!Array.isArray(items) || items.length === 0) return items;
  const inv = db.prepare('SELECT id, job_id, type FROM invoices WHERE id = ?').get(invoiceId);
  if (!inv || inv.type !== 'invoice') return items;

  // Customer approvals on the job's quote(s)
  const quoteLines = inv.job_id
    ? db
        .prepare(`
          SELECT qi.id, qi.description, COALESCE(qi.approved, 0) AS approved, qi.approved_at
          FROM invoice_items qi JOIN invoices q ON q.id = qi.invoice_id
          WHERE q.job_id = ? AND q.type = 'quote'
        `)
        .all(inv.job_id)
    : [];
  const quoteById = new Map(quoteLines.map((q) => [q.id, q]));
  const approvedQuoteByDesc = new Map();
  for (const q of quoteLines) if (Number(q.approved) === 1) approvedQuoteByDesc.set(norm(q.description), q);

  // LPO / IPR parts attached to invoice lines
  const lpoParts = db
    .prepare(`
      SELECT ll.invoice_item_id,
             COALESCE(ll.received_confirmed, 0) AS received, ll.received_confirmed_at AS received_at,
             COALESCE(ll.fitted_confirmed, 0) AS fitted, ll.fitted_confirmed_at AS fitted_at,
             l.created_at AS issued_at
      FROM lpo_lines ll JOIN lpos l ON l.id = ll.lpo_id
      WHERE l.invoice_id = ? AND ll.invoice_item_id IS NOT NULL
    `)
    .all(invoiceId);
  const iprParts = db
    .prepare(`
      SELECT il.invoice_item_id,
             COALESCE(il.received_confirmed, 0) AS received, il.received_confirmed_at AS received_at,
             ip.created_at AS issued_at
      FROM ipr_lines il JOIN iprs ip ON ip.id = il.ipr_id
      WHERE ip.invoice_id = ? AND il.invoice_item_id IS NOT NULL
    `)
    .all(invoiceId);
  const partsByItem = new Map();
  for (const p of lpoParts) {
    const list = partsByItem.get(p.invoice_item_id) || [];
    list.push({ ...p, source: 'lpo' });
    partsByItem.set(p.invoice_item_id, list);
  }
  for (const p of iprParts) {
    const list = partsByItem.get(p.invoice_item_id) || [];
    list.push({ ...p, source: 'ipr' });
    partsByItem.set(p.invoice_item_id, list);
  }

  for (const item of items) {
    if (!isTrackedLine(item)) continue;
    const parts = partsByItem.get(item.id) || [];
    const lpoOnly = parts.filter((p) => p.source === 'lpo');

    const linkedQuote = item.quote_item_id != null ? quoteById.get(Number(item.quote_item_id)) : null;
    const quoteMatch = linkedQuote || approvedQuoteByDesc.get(norm(item.description)) || null;
    const approvedDone = Number(item.approved) === 1 || Number(quoteMatch?.approved) === 1;

    const auto = {
      lpo_issued: parts.length > 0,
      received: parts.length > 0 && parts.every((p) => Number(p.received) === 1),
      fitted: lpoOnly.length > 0 && lpoOnly.every((p) => Number(p.fitted) === 1),
    };
    const autoAt = {
      lpo_issued: latest(parts.map((p) => p.issued_at)),
      received: latest(parts.map((p) => p.received_at)),
      fitted: latest(lpoOnly.map((p) => p.fitted_at)),
    };

    const stages = {
      approved: {
        done: approvedDone,
        at: approvedDone ? item.approved_at || quoteMatch?.approved_at || null : null,
        auto: true, // set by the customer on the quote
      },
    };
    for (const key of MANUAL_STAGES) {
      const manualAt = item[`${key}_at`] || null;
      const isAuto = !!auto[key];
      const stage = {
        done: isAuto || !!manualAt,
        at: isAuto ? autoAt[key] || manualAt : manualAt,
        auto: isAuto,
      };
      if (includeWho && !isAuto && manualAt) stage.by = item[`${key}_by`] || null;
      stages[key] = stage;
    }
    const done = PROGRESS_STAGES.filter((k) => stages[k].done).length;
    item.progress = {
      stages,
      percent: Math.round((done / PROGRESS_STAGES.length) * 100),
      parts: parts.length,
    };
  }
  return items;
}
