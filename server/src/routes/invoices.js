import { Router } from 'express';
import { db, transactionSync } from '../db.js';
import { config } from '../config.js';
import { nextSequenceRef } from '../sequences.js';
import { drawWorkshopDocumentHeader, kshFormat } from '../workshopPdf.js';
import { lpoLineNet, lpoLineVat, lpoLineGross, normalizeLpoLineVat } from '../lpoLineTotals.js';
import PDFDocument from 'pdfkit';
import { readFileSync, existsSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { requireAdminAuth, requireAdminPermission } from '../auth.js';
import { newLpoPublicVerifyToken } from '../lpoPublicToken.js';
import { embedLpoVerifyQr } from '../lpoVerifyPdf.js';
import {
  applyLabourPurchaseCostToInvoiceItem,
  computeJobLabourHoursAndCostRate,
  ensureStandaloneLabourLineIfMissing,
  refreshInvoiceTotalsFromLineItems,
  syncLabourLinesForJob,
} from '../jobInvoiceLabour.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const invoicesRouter = Router();

function fullInvoicePayload(invoiceId) {
  const inv = db.prepare(`
    SELECT i.*, c.name as customer_name, c.email as customer_email, c.phone as customer_phone, c.address as customer_address,
      v.registration, v.make, v.model
    FROM invoices i
    LEFT JOIN customers c ON i.customer_id = c.id
    LEFT JOIN vehicles v ON i.vehicle_id = v.id
    WHERE i.id = ?
  `).get(invoiceId);
  if (!inv) return null;
  const items = db
    .prepare(
      `
    SELECT ii.*, s.name AS supplier_name,
      st.code AS stock_code, st.name AS stock_name,
      (SELECT COALESCE(SUM(ll.quantity * ll.unit_cost), 0) FROM lpo_lines ll WHERE ll.invoice_item_id = ii.id) AS lpo_allocated_cost,
      (SELECT COUNT(*) FROM lpo_lines ll WHERE ll.invoice_item_id = ii.id) AS lpo_line_count,
      (SELECT COALESCE(SUM(il.quantity * il.unit_cost), 0) FROM ipr_lines il WHERE il.invoice_item_id = ii.id) AS ipr_allocated_cost,
      (SELECT COUNT(*) FROM ipr_lines il WHERE il.invoice_item_id = ii.id) AS ipr_line_count,
      (SELECT GROUP_CONCAT(DISTINCT ip.ref)
       FROM ipr_lines il
       JOIN iprs ip ON ip.id = il.ipr_id AND COALESCE(ip.finalized, 0) = 1
       WHERE il.invoice_item_id = ii.id) AS ipr_refs
    FROM invoice_items ii
    LEFT JOIN suppliers s ON s.id = ii.supplier_id
    LEFT JOIN stock_items st ON st.id = ii.stock_item_id
    WHERE ii.invoice_id = ?
    ORDER BY ii.id
  `,
    )
    .all(invoiceId);
  const quoteItems =
    inv.type === 'quote'
      ? items.map(({ purchase_price, ...rest }) => rest)
      : items;
  const payments = db.prepare('SELECT * FROM invoice_payments WHERE invoice_id = ? ORDER BY paid_at ASC, id ASC').all(invoiceId);
  const amount_paid = payments.reduce((s, p) => s + Number(p.amount || 0), 0);
  const total = Number(inv.total) || 0;
  const balance = inv.type === 'invoice' ? Math.round((total - amount_paid) * 100) / 100 : null;
  return { ...inv, items: quoteItems, payments, amount_paid, balance };
}

function syncInvoicePaymentStatus(invoiceId) {
  const inv = db.prepare('SELECT * FROM invoices WHERE id = ?').get(invoiceId);
  if (!inv || inv.type !== 'invoice' || inv.status === 'cancelled') return;

  const paid =
    Number(db.prepare('SELECT COALESCE(SUM(amount), 0) as s FROM invoice_payments WHERE invoice_id = ?').get(invoiceId).s) || 0;
  const total = Number(inv.total) || 0;

  let status;
  let paid_at = null;
  if (paid <= 0) {
    status = 'draft';
  } else if (total > 0 && paid >= total) {
    status = 'paid';
    paid_at =
      db.prepare('SELECT paid_at FROM invoice_payments WHERE invoice_id = ? ORDER BY paid_at DESC, id DESC LIMIT 1').get(invoiceId)
        ?.paid_at ?? null;
  } else {
    status = 'sent';
  }

  db.prepare('UPDATE invoices SET status = ?, paid_at = ?, updated_at = datetime(\'now\') WHERE id = ?').run(status, paid_at, invoiceId);
}

function nextInvoiceNumber() {
  const row = db.prepare('SELECT value FROM sequences WHERE name = ?').get('invoice_number');
  const next = (row?.value ?? 1000) + 1;
  db.prepare('UPDATE sequences SET value = ? WHERE name = ?').run(next, 'invoice_number');
  return `INV-${next}`;
}

/** Same sequence and format as job-attached quotes (`jobs` route). */
function nextQuoteNumber() {
  const row = db.prepare('SELECT value FROM sequences WHERE name = ?').get('quote_number');
  const next = (row?.value ?? 1000) + 1;
  db.prepare('UPDATE sequences SET value = ? WHERE name = ?').run(next, 'quote_number');
  return `QUO-${next}`;
}

function recalcPurchaseForInvoiceItem(invoiceItemId, options = {}) {
  const { clearIfNoAlloc = false } = options;
  const id = parseInt(invoiceItemId, 10);
  if (!Number.isFinite(id) || id <= 0) return;

  if (applyLabourPurchaseCostToInvoiceItem(id)) return;

  const lpoRow = db
    .prepare(`SELECT COALESCE(SUM(quantity * unit_cost), 0) AS alloc_net FROM lpo_lines WHERE invoice_item_id = ?`)
    .get(id);
  const lpoAlloc = Number(lpoRow?.alloc_net) || 0;

  const iprRow = db
    .prepare(`SELECT COALESCE(SUM(quantity * unit_cost), 0) AS alloc_net FROM ipr_lines WHERE invoice_item_id = ?`)
    .get(id);
  const iprAlloc = Number(iprRow?.alloc_net) || 0;

  const totalAlloc = lpoAlloc + iprAlloc;
  const hasLpo = db.prepare('SELECT 1 FROM lpo_lines WHERE invoice_item_id = ? LIMIT 1').get(id);
  const hasIpr = db.prepare('SELECT 1 FROM ipr_lines WHERE invoice_item_id = ? LIMIT 1').get(id);

  if (!hasLpo && !hasIpr) {
    if (clearIfNoAlloc) {
      db.prepare('UPDATE invoice_items SET purchase_price = 0 WHERE id = ?').run(id);
    }
    return;
  }

  const item = db.prepare('SELECT quantity FROM invoice_items WHERE id = ?').get(id);
  if (!item) return;
  const qty = Number(item.quantity) || 1;
  const unit = qty > 0 ? totalAlloc / qty : totalAlloc;
  db.prepare('UPDATE invoice_items SET purchase_price = ? WHERE id = ?').run(unit, id);
}

function recalcPurchaseForItemIds(itemIds, options = {}) {
  const ids = [
    ...new Set(
      itemIds
        .map((x) => parseInt(x, 10))
        .filter((n) => Number.isFinite(n) && n > 0),
    ),
  ];
  ids.forEach((iid) => recalcPurchaseForInvoiceItem(iid, options));
}

/** Recalc purchase_price for every invoice line on this invoice that has any LPO or IPR allocation. */
function recalcPurchaseForAllAllocatedLinesOnInvoice(invoiceId) {
  const invId = parseInt(invoiceId, 10);
  if (!Number.isFinite(invId)) return;
  const rows = db
    .prepare(
      `
    SELECT DISTINCT iid FROM (
      SELECT ll.invoice_item_id AS iid FROM lpo_lines ll
      INNER JOIN lpos l ON l.id = ll.lpo_id AND l.invoice_id = ?
      WHERE ll.invoice_item_id IS NOT NULL
      UNION
      SELECT il.invoice_item_id AS iid FROM ipr_lines il
      INNER JOIN iprs ip ON ip.id = il.ipr_id AND ip.invoice_id = ?
      WHERE il.invoice_item_id IS NOT NULL
    )
  `,
    )
    .all(invId, invId);
  recalcPurchaseForItemIds(rows.map((r) => r.iid));
}

function getLposForInvoice(invoiceId) {
  const lpos = db
    .prepare(
      `
    SELECT l.*, s.name AS supplier_name, appr.display_name AS approved_by_display_name
    FROM lpos l
    LEFT JOIN suppliers s ON s.id = l.supplier_id
    LEFT JOIN admin_users appr ON appr.id = l.approved_by_admin_user_id
    WHERE l.invoice_id = ?
    ORDER BY l.id DESC
  `,
    )
    .all(invoiceId);
  return lpos.map((l) => {
    const lines = db
      .prepare(
        `
      SELECT ll.*, ii.description AS ii_desc, si.code AS stock_code, si.name AS stock_name,
        au.display_name AS assigned_admin_name,
        ru.display_name AS received_by_admin_name,
        CASE
          WHEN ii.id IS NOT NULL THEN ii.description
          WHEN IFNULL(si.code, '') != '' THEN TRIM(si.code || ' — ' || COALESCE(si.name, ''))
          ELSE COALESCE(si.name, ll.description)
        END AS invoice_line_description
      FROM lpo_lines ll
      LEFT JOIN invoice_items ii ON ii.id = ll.invoice_item_id
      LEFT JOIN stock_items si ON si.id = ll.stock_item_id
      LEFT JOIN admin_users au ON au.id = ll.assigned_admin_user_id
      LEFT JOIN admin_users ru ON ru.id = ll.received_confirmed_by_admin_user_id
      WHERE ll.lpo_id = ?
      ORDER BY ll.id
    `,
      )
      .all(l.id);
    const linesAug = lines.map((x) => ({
      ...x,
      line_net: lpoLineNet(x),
      line_vat: lpoLineVat(x),
      line_gross: lpoLineGross(x),
    }));
    const document_subtotal = linesAug.reduce((s, x) => s + x.line_net, 0);
    const document_vat = linesAug.reduce((s, x) => s + x.line_vat, 0);
    const document_total = linesAug.reduce((s, x) => s + x.line_gross, 0);
    return { ...l, lines: linesAug, document_subtotal, document_vat, document_total };
  });
}

function getIprsForInvoice(invoiceId) {
  const iprs = db
    .prepare(
      `
    SELECT * FROM iprs WHERE invoice_id = ? ORDER BY id DESC
  `,
    )
    .all(invoiceId);
  return iprs.map((ipr) => {
    const lines = db
      .prepare(
        `
      SELECT il.*, ii.description AS ii_desc, si.code AS stock_code, si.name AS stock_name,
        au.display_name AS assigned_admin_name,
        ru.display_name AS received_by_admin_name,
        CASE
          WHEN ii.id IS NOT NULL THEN ii.description
          WHEN IFNULL(si.code, '') != '' THEN TRIM(si.code || ' — ' || COALESCE(si.name, ''))
          ELSE COALESCE(si.name, il.description)
        END AS invoice_line_description
      FROM ipr_lines il
      LEFT JOIN invoice_items ii ON ii.id = il.invoice_item_id
      LEFT JOIN stock_items si ON si.id = il.stock_item_id
      LEFT JOIN admin_users au ON au.id = il.assigned_admin_user_id
      LEFT JOIN admin_users ru ON ru.id = il.received_confirmed_by_admin_user_id
      WHERE il.ipr_id = ?
      ORDER BY il.id
    `,
      )
      .all(ipr.id);
    const linesAug = lines.map((x) => ({
      ...x,
      line_net: lpoLineNet(x),
      line_vat: lpoLineVat(x),
      line_gross: lpoLineGross(x),
    }));
    const document_subtotal = linesAug.reduce((s, x) => s + x.line_net, 0);
    const document_vat = linesAug.reduce((s, x) => s + x.line_vat, 0);
    const document_total = linesAug.reduce((s, x) => s + x.line_gross, 0);
    return { ...ipr, lines: linesAug, document_subtotal, document_vat, document_total };
  });
}

function getIprDocument(invoiceId, iprId) {
  const ipr = db
    .prepare(
      `
    SELECT ip.*, appr.display_name AS approved_by_display_name
    FROM iprs ip
    LEFT JOIN admin_users appr ON appr.id = ip.approved_by_admin_user_id
    WHERE ip.id = ? AND ip.invoice_id = ?
  `,
    )
    .get(iprId, invoiceId);
  if (!ipr) return null;
  const lines = db
    .prepare(
      `
    SELECT il.*, ii.description AS ii_desc, si.code AS stock_code, si.name AS stock_name,
      au.display_name AS assigned_admin_name,
      ru.display_name AS received_by_admin_name,
      CASE
        WHEN ii.id IS NOT NULL THEN ii.description
        WHEN IFNULL(si.code, '') != '' THEN TRIM(si.code || ' — ' || COALESCE(si.name, ''))
        ELSE COALESCE(si.name, il.description)
      END AS invoice_line_description
    FROM ipr_lines il
    LEFT JOIN invoice_items ii ON ii.id = il.invoice_item_id
    LEFT JOIN stock_items si ON si.id = il.stock_item_id
    LEFT JOIN admin_users au ON au.id = il.assigned_admin_user_id
    LEFT JOIN admin_users ru ON ru.id = il.received_confirmed_by_admin_user_id
    WHERE il.ipr_id = ?
    ORDER BY il.id
  `,
    )
    .all(ipr.id);
  const linesAug = lines.map((x) => ({
    ...x,
    line_net: lpoLineNet(x),
    line_vat: lpoLineVat(x),
    line_gross: lpoLineGross(x),
  }));
  const document_subtotal = linesAug.reduce((s, x) => s + x.line_net, 0);
  const document_vat = linesAug.reduce((s, x) => s + x.line_vat, 0);
  const document_total = linesAug.reduce((s, x) => s + x.line_gross, 0);
  return { ...ipr, lines: linesAug, document_subtotal, document_vat, document_total };
}

function receiptProgress(lineTable, docKey, docId) {
  const row = db
    .prepare(
      `SELECT COUNT(*) AS total, COALESCE(SUM(CASE WHEN COALESCE(received_confirmed,0)=1 THEN 1 ELSE 0 END), 0) AS done
       FROM ${lineTable}
       WHERE ${docKey} = ?`,
    )
    .get(docId);
  const total = Number(row?.total || 0);
  const done = Number(row?.done || 0);
  return { total, done, allReceived: total > 0 && done >= total };
}

invoicesRouter.get('/', (req, res) => {
  const type = req.query.type;
  const status = req.query.status;
  const job_id = req.query.job_id;
  const q = (req.query.q || '').trim();
  let stmt = `
    SELECT i.*, c.name as customer_name, v.registration, v.make AS vehicle_make, v.model AS vehicle_model,
      COALESCE(pay.amount_paid, 0) AS amount_paid,
      CASE WHEN i.type = 'invoice' THEN (i.total - COALESCE(pay.amount_paid, 0)) ELSE NULL END AS balance
    FROM invoices i
    LEFT JOIN customers c ON i.customer_id = c.id
    LEFT JOIN vehicles v ON i.vehicle_id = v.id
    LEFT JOIN (
      SELECT invoice_id, SUM(amount) AS amount_paid
      FROM invoice_payments
      GROUP BY invoice_id
    ) pay ON pay.invoice_id = i.id
    WHERE 1=1
  `;
  const params = [];
  if (type) { stmt += ' AND i.type = ?'; params.push(type); }
  if (status) { stmt += ' AND i.status = ?'; params.push(status); }
  if (job_id) { stmt += ' AND i.job_id = ?'; params.push(job_id); }
  if (q) {
    const safe = q.replace(/[%_\\]/g, '').trim();
    if (safe) {
      const like = `%${safe}%`;
      stmt += ` AND (
        i.invoice_number LIKE ? OR IFNULL(i.notes, '') LIKE ?
        OR IFNULL(c.name, '') LIKE ? OR IFNULL(v.registration, '') LIKE ?
        OR IFNULL(v.make, '') LIKE ? OR IFNULL(v.model, '') LIKE ?
      )`;
      params.push(like, like, like, like, like, like);
    }
  }
  stmt += ' ORDER BY i.created_at DESC';
  const rows = db.prepare(stmt).all(...params);
  res.json(rows);
});

// Lines (LPO/IPR) assigned to current team member for receiving.
invoicesRouter.get('/assigned-receipts/mine', requireAdminAuth, (req, res) => {
  const rows = db
    .prepare(
      `
      SELECT
        'lpo' AS doc_type,
        l.id AS doc_id,
        l.ref AS doc_ref,
        l.invoice_id,
        l.finalized AS doc_finalized,
        i.job_id,
        j.job_number,
        v.registration AS vehicle_registration,
        TRIM(COALESCE(v.make, '') || CASE WHEN IFNULL(v.model, '') != '' THEN ' ' || v.model ELSE '' END) AS vehicle_type,
        ll.id AS line_id,
        ll.description AS line_description,
        ll.quantity,
        ll.unit_cost,
        ll.received_confirmed,
        ll.received_confirmed_at,
        ll.created_at AS assigned_at,
        ii.description AS invoice_line_description
      FROM lpo_lines ll
      JOIN lpos l ON l.id = ll.lpo_id
      JOIN invoices i ON i.id = l.invoice_id
      LEFT JOIN jobs j ON j.id = i.job_id
      LEFT JOIN vehicles v ON v.id = i.vehicle_id
      LEFT JOIN invoice_items ii ON ii.id = ll.invoice_item_id
      WHERE ll.assigned_admin_user_id = ?
        AND COALESCE(l.approved, 0) = 1

      UNION ALL

      SELECT
        'ipr' AS doc_type,
        ip.id AS doc_id,
        ip.ref AS doc_ref,
        ip.invoice_id,
        ip.finalized AS doc_finalized,
        i.job_id,
        j.job_number,
        v.registration AS vehicle_registration,
        TRIM(COALESCE(v.make, '') || CASE WHEN IFNULL(v.model, '') != '' THEN ' ' || v.model ELSE '' END) AS vehicle_type,
        il.id AS line_id,
        il.description AS line_description,
        il.quantity,
        il.unit_cost,
        il.received_confirmed,
        il.received_confirmed_at,
        il.created_at AS assigned_at,
        ii.description AS invoice_line_description
      FROM ipr_lines il
      JOIN iprs ip ON ip.id = il.ipr_id
      JOIN invoices i ON i.id = ip.invoice_id
      LEFT JOIN jobs j ON j.id = i.job_id
      LEFT JOIN vehicles v ON v.id = i.vehicle_id
      LEFT JOIN invoice_items ii ON ii.id = il.invoice_item_id
      WHERE il.assigned_admin_user_id = ?
        AND COALESCE(ip.approved, 0) = 1

      ORDER BY received_confirmed ASC, assigned_at DESC, doc_ref DESC, line_id DESC
    `,
    )
    .all(req.admin.id, req.admin.id);
  res.json(rows);
});

invoicesRouter.get('/:id', (req, res) => {
  const payload = fullInvoicePayload(req.params.id);
  if (!payload) return res.status(404).json({ error: 'Invoice not found' });
  res.json(payload);
});

invoicesRouter.post('/', (req, res) => {
  const { job_id, customer_id, vehicle_id, type, due_date, notes, items } = req.body;
  if (!customer_id) return res.status(400).json({ error: 'customer_id is required' });
  const resolvedType = type || 'invoice';
  const invoice_number = resolvedType === 'quote' ? nextQuoteNumber() : nextInvoiceNumber();
  const taxRate = 0.16; // 16% VAT Kenya – make configurable
  const result = db.prepare(`
    INSERT INTO invoices (invoice_number, job_id, customer_id, vehicle_id, type, due_date, notes, tax_rate)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(invoice_number, job_id || null, customer_id, vehicle_id || null, resolvedType, due_date || null, notes || null, taxRate);
  const invId = result.lastInsertRowid;
  if (Array.isArray(items) && items.length) {
    const ins = db.prepare('INSERT INTO invoice_items (invoice_id, description, quantity, unit_price, purchase_price, type, stock_item_id) VALUES (?, ?, ?, ?, ?, ?, ?)');
    for (const it of items) {
      const pp = resolvedType === 'quote' ? 0 : it.purchase_price ?? 0;
      ins.run(invId, it.description, it.quantity ?? 1, it.unit_price ?? 0, pp, it.type || 'other', it.stock_item_id || null);
    }
  }
  const jid = job_id != null && String(job_id).trim() !== '' ? parseInt(job_id, 10) : null;
  if (jid && Number.isFinite(jid) && jid > 0) {
    syncLabourLinesForJob(jid);
  } else {
    ensureStandaloneLabourLineIfMissing(invId);
  }
  refreshInvoiceTotalsFromLineItems(invId);
  const row = db.prepare(`
    SELECT i.*, c.name as customer_name, v.registration
    FROM invoices i JOIN customers c ON i.customer_id = c.id LEFT JOIN vehicles v ON i.vehicle_id = v.id
    WHERE i.id = ?
  `).get(invId);
  let invItems = db.prepare('SELECT * FROM invoice_items WHERE invoice_id = ?').all(invId);
  if (resolvedType === 'quote') {
    invItems = invItems.map(({ purchase_price, ...rest }) => rest);
  }
  const totals = db.prepare('SELECT subtotal, tax_amount, total FROM invoices WHERE id = ?').get(invId);
  res.status(201).json({
    ...row,
    items: invItems,
    subtotal: totals?.subtotal ?? 0,
    tax_amount: totals?.tax_amount ?? 0,
    total: totals?.total ?? 0,
  });
});

invoicesRouter.patch('/:id', (req, res) => {
  const inv = db.prepare('SELECT * FROM invoices WHERE id = ?').get(req.params.id);
  if (!inv) return res.status(404).json({ error: 'Invoice not found' });
  const { status, paid_at, due_date, notes } = req.body;
  db.prepare(`
    UPDATE invoices SET status = ?, paid_at = ?, due_date = ?, notes = ?, updated_at = datetime('now')
    WHERE id = ?
  `).run(status ?? inv.status, paid_at ?? inv.paid_at, due_date ?? inv.due_date, notes ?? inv.notes, req.params.id);
  const payload = fullInvoicePayload(req.params.id);
  res.json(payload);
});

invoicesRouter.post('/:id/payments', requireAdminPermission('can_record_invoice_payments'), (req, res) => {
  const inv = db.prepare('SELECT * FROM invoices WHERE id = ?').get(req.params.id);
  if (!inv) return res.status(404).json({ error: 'Invoice not found' });
  if (inv.type !== 'invoice') return res.status(400).json({ error: 'Payments apply to invoices only, not quotes' });
  const { amount, paid_at, notes } = req.body;
  const numAmount = Number(amount);
  if (!numAmount || numAmount <= 0) return res.status(400).json({ error: 'amount must be a positive number' });
  const when = paid_at && String(paid_at).trim() ? String(paid_at).trim() : null;
  db.prepare(`
    INSERT INTO invoice_payments (invoice_id, amount, paid_at, notes)
    VALUES (?, ?, COALESCE(?, datetime('now')), ?)
  `).run(req.params.id, numAmount, when, notes || null);
  syncInvoicePaymentStatus(req.params.id);
  res.status(201).json(fullInvoicePayload(req.params.id));
});

invoicesRouter.delete('/:id/payments/:paymentId', requireAdminPermission('can_record_invoice_payments'), (req, res) => {
  const inv = db.prepare('SELECT * FROM invoices WHERE id = ?').get(req.params.id);
  if (!inv) return res.status(404).json({ error: 'Invoice not found' });
  const result = db.prepare('DELETE FROM invoice_payments WHERE id = ? AND invoice_id = ?').run(req.params.paymentId, req.params.id);
  if (result.changes === 0) return res.status(404).json({ error: 'Payment not found' });
  if (inv.type === 'invoice') syncInvoicePaymentStatus(req.params.id);
  res.status(204).send();
});

invoicesRouter.post('/:id/items', (req, res) => {
  const { description, quantity, unit_price, purchase_price, type, stock_item_id } = req.body;
  if (!description || unit_price == null) return res.status(400).json({ error: 'description and unit_price required' });
  const inv = db.prepare('SELECT * FROM invoices WHERE id = ?').get(req.params.id);
  if (!inv) return res.status(404).json({ error: 'Invoice not found' });
  const lineType = String(type || 'other');
  if (inv.job_id && lineType === 'labour') {
    const existingLabour = db
      .prepare(`SELECT id FROM invoice_items WHERE invoice_id = ? AND type = 'labour' LIMIT 1`)
      .get(req.params.id);
    if (existingLabour) {
      return res.status(400).json({ error: 'This document already has a labour line; it is updated automatically from the job.' });
    }
  }
  let pp = inv.type === 'quote' ? 0 : purchase_price ?? 0;
  if (inv.type === 'invoice' && inv.job_id && lineType === 'labour') {
    pp = computeJobLabourHoursAndCostRate(inv.job_id).costPerHour;
  }
  db.prepare(`
    INSERT INTO invoice_items (invoice_id, description, quantity, unit_price, purchase_price, type, stock_item_id)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(req.params.id, description, quantity ?? 1, unit_price, pp, type || 'other', stock_item_id || null);
  if (inv.job_id) syncLabourLinesForJob(inv.job_id);
  else refreshInvoiceTotalsFromLineItems(req.params.id);
  const inserted = db.prepare('SELECT * FROM invoice_items WHERE invoice_id = ? ORDER BY id DESC LIMIT 1').get(req.params.id);
  if (inv.type === 'quote') {
    const { purchase_price, ...rest } = inserted;
    return res.json(rest);
  }
  res.json(inserted);
});

invoicesRouter.patch('/:id/items/:itemId', (req, res) => {
  const { description, quantity, unit_price, purchase_price: bodyPurchase } = req.body;
  const inv = db.prepare('SELECT * FROM invoices WHERE id = ?').get(req.params.id);
  if (!inv) return res.status(404).json({ error: 'Invoice not found' });
  const item = db.prepare('SELECT * FROM invoice_items WHERE id = ? AND invoice_id = ?').get(req.params.itemId, req.params.id);
  if (!item) return res.status(404).json({ error: 'Item not found' });
  const lineType = String(item.type || 'other');
  const isJobLabourInvoice = inv.type === 'invoice' && lineType === 'labour' && inv.job_id != null;
  let nextPurchase =
    inv.type === 'quote' ? 0 : bodyPurchase !== undefined ? Number(bodyPurchase) : item.purchase_price ?? 0;
  if (isJobLabourInvoice) {
    nextPurchase = computeJobLabourHoursAndCostRate(inv.job_id).costPerHour;
  }
  db.prepare(`
    UPDATE invoice_items SET description = ?, quantity = ?, unit_price = ?, purchase_price = ?, created_at = created_at
    WHERE id = ? AND invoice_id = ?
  `).run(
    description !== undefined ? description : item.description,
    quantity !== undefined ? quantity : item.quantity,
    unit_price !== undefined ? unit_price : item.unit_price,
    nextPurchase,
    req.params.itemId,
    req.params.id
  );
  if (inv.job_id) syncLabourLinesForJob(inv.job_id);
  else refreshInvoiceTotalsFromLineItems(req.params.id);
  const hasLpo = db.prepare('SELECT 1 FROM lpo_lines WHERE invoice_item_id = ? LIMIT 1').get(req.params.itemId);
  const hasIpr = db.prepare('SELECT 1 FROM ipr_lines WHERE invoice_item_id = ? LIMIT 1').get(req.params.itemId);
  if (inv.type !== 'quote' && (hasLpo || hasIpr)) recalcPurchaseForInvoiceItem(req.params.itemId);
  const updated = db.prepare('SELECT * FROM invoice_items WHERE id = ?').get(req.params.itemId);
  if (inv.type === 'quote') {
    const { purchase_price, ...rest } = updated;
    return res.json(rest);
  }
  res.json(updated);
});

invoicesRouter.delete('/:id/items/:itemId', (req, res) => {
  const inv = db.prepare('SELECT * FROM invoices WHERE id = ?').get(req.params.id);
  if (!inv) return res.status(404).json({ error: 'Invoice not found' });
  const result = db.prepare('DELETE FROM invoice_items WHERE id = ? AND invoice_id = ?').run(req.params.itemId, req.params.id);
  if (result.changes === 0) return res.status(404).json({ error: 'Item not found' });
  if (inv.job_id) syncLabourLinesForJob(inv.job_id);
  else refreshInvoiceTotalsFromLineItems(req.params.id);
  res.status(204).send();
});

invoicesRouter.get('/:id/lpos', (req, res) => {
  const inv = db.prepare('SELECT id, type FROM invoices WHERE id = ?').get(req.params.id);
  if (!inv) return res.status(404).json({ error: 'Invoice not found' });
  if (inv.type !== 'invoice') return res.status(400).json({ error: 'LPOs apply to invoices only' });
  res.json(getLposForInvoice(req.params.id));
});

invoicesRouter.post('/:id/lpos', requireAdminPermission('can_create_lpos'), (req, res) => {
  const inv = db.prepare('SELECT * FROM invoices WHERE id = ?').get(req.params.id);
  if (!inv) return res.status(404).json({ error: 'Invoice not found' });
  if (inv.type !== 'invoice') return res.status(400).json({ error: 'LPOs apply to invoices only' });
  const { supplier_id, notes, lines } = req.body;
  if (supplier_id == null || supplier_id === '') return res.status(400).json({ error: 'supplier_id is required' });
  const sup = db.prepare('SELECT id FROM suppliers WHERE id = ?').get(supplier_id);
  if (!sup) return res.status(404).json({ error: 'Supplier not found' });
  if (!Array.isArray(lines) || lines.length === 0) return res.status(400).json({ error: 'At least one LPO line is required' });
  const ref = nextSequenceRef('lpo', 'LPO');
  const insLpo = db.prepare(
    `INSERT INTO lpos (invoice_id, supplier_id, ref, notes, public_verify_token) VALUES (?, ?, ?, ?, ?)`,
  );
  const r = insLpo.run(req.params.id, supplier_id, ref, notes || null, newLpoPublicVerifyToken());
  const lpoId = r.lastInsertRowid;
  const insLine = db.prepare(
    `INSERT INTO lpo_lines (lpo_id, invoice_item_id, stock_item_id, description, quantity, unit_cost, vat_rate, vat_exempt) VALUES (?, ?, NULL, ?, ?, ?, ?, ?)`,
  );
  const itemIds = [];
  for (const ln of lines) {
    const iid = ln.invoice_item_id;
    const desc = (ln.description || '').trim();
    const qty = Number(ln.quantity);
    const uc = Number(ln.unit_cost);
    if (iid == null || iid === '') return res.status(400).json({ error: 'Each line needs invoice_item_id' });
    if (!desc) return res.status(400).json({ error: 'Each line needs a description' });
    if (!Number.isFinite(qty) || qty <= 0) return res.status(400).json({ error: 'Each line needs a positive quantity' });
    if (!Number.isFinite(uc) || uc < 0) return res.status(400).json({ error: 'Each line needs a valid unit_cost' });
    const item = db.prepare('SELECT id FROM invoice_items WHERE id = ? AND invoice_id = ?').get(iid, req.params.id);
    if (!item) return res.status(400).json({ error: 'Invalid invoice_item_id for this invoice' });
    const { vat_rate, vat_exempt } = normalizeLpoLineVat(ln);
    if (vat_exempt !== 1 && vat_rate > 100) return res.status(400).json({ error: 'vat_rate cannot exceed 100' });
    insLine.run(lpoId, iid, desc, qty, uc, vat_rate, vat_exempt);
    itemIds.push(iid);
  }
  recalcPurchaseForItemIds(itemIds);
  res.status(201).json(fullInvoicePayload(req.params.id));
});

invoicesRouter.patch('/:id/lpos/:lpoId', requireAdminPermission('can_create_lpos'), (req, res) => {
  const inv = db.prepare('SELECT * FROM invoices WHERE id = ?').get(req.params.id);
  if (!inv) return res.status(404).json({ error: 'Invoice not found' });
  if (inv.type !== 'invoice') return res.status(400).json({ error: 'LPOs apply to invoices only' });
  const lpo = db.prepare('SELECT * FROM lpos WHERE id = ? AND invoice_id = ?').get(req.params.lpoId, req.params.id);
  if (!lpo) return res.status(404).json({ error: 'LPO not found' });
  if (Number(lpo.finalized) === 1) return res.status(400).json({ error: 'Cannot edit a finalised LPO' });
  const { supplier_id, notes, lines } = req.body;
  const oldItemIds = db
    .prepare('SELECT DISTINCT invoice_item_id FROM lpo_lines WHERE lpo_id = ?')
    .all(req.params.lpoId)
    .map((row) => row.invoice_item_id)
    .filter(Boolean);
  if (supplier_id !== undefined) {
    if (supplier_id === null || supplier_id === '') return res.status(400).json({ error: 'supplier_id is required when updating supplier' });
    const sup = db.prepare('SELECT id FROM suppliers WHERE id = ?').get(supplier_id);
    if (!sup) return res.status(404).json({ error: 'Supplier not found' });
    db.prepare(`UPDATE lpos SET supplier_id = ?, updated_at = datetime('now') WHERE id = ?`).run(supplier_id, req.params.lpoId);
  }
  if (notes !== undefined) {
    db.prepare(`UPDATE lpos SET notes = ?, updated_at = datetime('now') WHERE id = ?`).run(notes, req.params.lpoId);
  }
  if (Array.isArray(lines)) {
    if (lines.length === 0) return res.status(400).json({ error: 'At least one LPO line is required' });
    db.prepare('DELETE FROM lpo_lines WHERE lpo_id = ?').run(req.params.lpoId);
    const insLine = db.prepare(
      `INSERT INTO lpo_lines (lpo_id, invoice_item_id, stock_item_id, description, quantity, unit_cost, vat_rate, vat_exempt) VALUES (?, ?, NULL, ?, ?, ?, ?, ?)`,
    );
    const newItemIds = [];
    for (const ln of lines) {
      const iid = ln.invoice_item_id;
      const desc = (ln.description || '').trim();
      const qty = Number(ln.quantity);
      const uc = Number(ln.unit_cost);
      if (iid == null || iid === '') return res.status(400).json({ error: 'Each line needs invoice_item_id' });
      if (!desc) return res.status(400).json({ error: 'Each line needs a description' });
      if (!Number.isFinite(qty) || qty <= 0) return res.status(400).json({ error: 'Each line needs a positive quantity' });
      if (!Number.isFinite(uc) || uc < 0) return res.status(400).json({ error: 'Each line needs a valid unit_cost' });
      const item = db.prepare('SELECT id FROM invoice_items WHERE id = ? AND invoice_id = ?').get(iid, req.params.id);
      if (!item) return res.status(400).json({ error: 'Invalid invoice_item_id for this invoice' });
      const { vat_rate, vat_exempt } = normalizeLpoLineVat(ln);
      if (vat_exempt !== 1 && vat_rate > 100) return res.status(400).json({ error: 'vat_rate cannot exceed 100' });
      insLine.run(req.params.lpoId, iid, desc, qty, uc, vat_rate, vat_exempt);
      newItemIds.push(iid);
    }
    recalcPurchaseForItemIds([...oldItemIds, ...newItemIds]);
    db.prepare(`UPDATE lpos SET approved = 0, approved_at = NULL, approved_by_admin_user_id = NULL, updated_at = datetime('now') WHERE id = ?`)
      .run(req.params.lpoId);
  }
  res.json(fullInvoicePayload(req.params.id));
});

invoicesRouter.delete('/:id/lpos/:lpoId', requireAdminPermission('can_create_lpos'), (req, res) => {
  const inv = db.prepare('SELECT * FROM invoices WHERE id = ?').get(req.params.id);
  if (!inv) return res.status(404).json({ error: 'Invoice not found' });
  if (inv.type !== 'invoice') return res.status(400).json({ error: 'LPOs apply to invoices only' });
  const lpo = db.prepare('SELECT id FROM lpos WHERE id = ? AND invoice_id = ?').get(req.params.lpoId, req.params.id);
  if (!lpo) return res.status(404).json({ error: 'LPO not found' });
  if (Number(lpo.finalized) === 1) return res.status(400).json({ error: 'Cannot delete a finalised LPO' });
  const itemIds = db
    .prepare('SELECT DISTINCT invoice_item_id FROM lpo_lines WHERE lpo_id = ?')
    .all(req.params.lpoId)
    .map((row) => row.invoice_item_id)
    .filter(Boolean);
  db.prepare('DELETE FROM lpos WHERE id = ?').run(req.params.lpoId);
  recalcPurchaseForItemIds(itemIds, { clearIfNoAlloc: true });
  res.json(fullInvoicePayload(req.params.id));
});

invoicesRouter.post('/:id/lpos/:lpoId/approve', requireAdminPermission('can_approve_lpo_ipr'), (req, res) => {
  const lpo = db.prepare('SELECT * FROM lpos WHERE id = ? AND invoice_id = ?').get(req.params.lpoId, req.params.id);
  if (!lpo) return res.status(404).json({ error: 'LPO not found' });
  if (Number(lpo.finalized) === 1) return res.status(400).json({ error: 'Already finalised' });
  db.prepare(
    `UPDATE lpos SET approved = 1, approved_at = datetime('now'), approved_by_admin_user_id = ?, updated_at = datetime('now') WHERE id = ?`,
  ).run(req.admin.id, lpo.id);
  res.json(fullInvoicePayload(req.params.id));
});

invoicesRouter.patch('/:id/lpos/:lpoId/lines/:lineId/receipt', requireAdminAuth, (req, res) => {
  const lpo = db.prepare('SELECT * FROM lpos WHERE id = ? AND invoice_id = ?').get(req.params.lpoId, req.params.id);
  if (!lpo) return res.status(404).json({ error: 'LPO not found' });
  if (Number(lpo.finalized) === 1) return res.status(400).json({ error: 'Already finalised' });
  if (Number(lpo.approved) !== 1) {
    return res.status(400).json({ error: 'LPO must be approved before marking parts received' });
  }
  const line = db.prepare('SELECT * FROM lpo_lines WHERE id = ? AND lpo_id = ?').get(req.params.lineId, req.params.lpoId);
  if (!line) return res.status(404).json({ error: 'Line not found' });
  const assigned = req.body?.assigned_admin_user_id != null ? Number(req.body.assigned_admin_user_id) : null;
  const received = req.body?.received_confirmed !== undefined ? (req.body.received_confirmed ? 1 : 0) : null;
  if (assigned !== null && (!Number.isFinite(assigned) || assigned <= 0)) return res.status(400).json({ error: 'Invalid assigned_admin_user_id' });
  const canAssign = Boolean(req.admin.permissions?.can_approve_lpo_ipr || req.admin.permissions?.can_manage_team_members);
  if (assigned !== null && !canAssign) return res.status(403).json({ error: 'Only approver/manager can assign line receivers' });
  if (assigned !== null) {
    const au = db.prepare('SELECT id FROM admin_users WHERE id = ? AND active = 1').get(assigned);
    if (!au) return res.status(400).json({ error: 'Assigned team member not found' });
  }
  const nextAssigned = assigned ?? (line.assigned_admin_user_id || null);
  if (received === 1 && !nextAssigned) return res.status(400).json({ error: 'Assign a team member before marking received' });
  if (received !== null && req.admin.id !== Number(nextAssigned || 0)) {
    return res.status(403).json({ error: 'Only assigned team member can confirm receipt' });
  }
  db.prepare(
    `UPDATE lpo_lines
     SET assigned_admin_user_id = COALESCE(?, assigned_admin_user_id),
         received_confirmed = COALESCE(?, received_confirmed),
         received_confirmed_at = CASE WHEN ? = 1 THEN datetime('now') WHEN ? = 0 THEN NULL ELSE received_confirmed_at END,
         received_confirmed_by_admin_user_id = CASE WHEN ? = 1 THEN ? WHEN ? = 0 THEN NULL ELSE received_confirmed_by_admin_user_id END
     WHERE id = ? AND lpo_id = ?`,
  ).run(
    assigned,
    received,
    received,
    received,
    received,
    req.admin.id,
    received,
    req.params.lineId,
    req.params.lpoId,
  );
  res.json(fullInvoicePayload(req.params.id));
});

invoicesRouter.post('/:id/lpos/:lpoId/finalize', requireAdminPermission('can_finalize_lpos'), (req, res) => {
  const lpo = db.prepare('SELECT * FROM lpos WHERE id = ? AND invoice_id = ?').get(req.params.lpoId, req.params.id);
  if (!lpo) return res.status(404).json({ error: 'LPO not found' });
  if (Number(lpo.finalized) === 1) return res.status(400).json({ error: 'Already finalised' });
  if (Number(lpo.approved) !== 1) return res.status(400).json({ error: 'LPO must be approved before finalisation' });
  const progress = receiptProgress('lpo_lines', 'lpo_id', lpo.id);
  if (!progress.allReceived) return res.status(400).json({ error: 'All LPO lines must be marked received before finalisation' });
  db.prepare(`UPDATE lpos SET finalized = 1, updated_at = datetime('now') WHERE id = ?`).run(lpo.id);
  res.json(fullInvoicePayload(req.params.id));
});

function insertIprLinesFromBody(invoiceId, iprId, lines) {
  const insLine = db.prepare(
    `INSERT INTO ipr_lines (ipr_id, invoice_item_id, stock_item_id, description, quantity, unit_cost, vat_rate, vat_exempt) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const itemIds = [];
  for (const ln of lines) {
    const iid = ln.invoice_item_id;
    const sid = ln.stock_item_id;
    const qty = Number(ln.quantity);
    const uc = Number(ln.unit_cost);
    if (iid == null || iid === '') throw new Error('Each line needs invoice_item_id');
    if (sid == null || sid === '') throw new Error('Each line needs stock_item_id');
    const stock = db.prepare('SELECT * FROM stock_items WHERE id = ?').get(sid);
    if (!stock) throw new Error('Stock item not found');
    const c = String(stock.code || '').trim();
    const n = String(stock.name || '').trim();
    const autoDesc = c ? `${c} — ${n || 'Stock'}` : n || 'Stock';
    const desc = (ln.description || '').trim() || autoDesc;
    if (!desc) throw new Error('Each line needs a description');
    if (!Number.isFinite(qty) || qty <= 0) throw new Error('Each line needs a positive quantity');
    if (!Number.isFinite(uc) || uc < 0) throw new Error('Each line needs a valid unit_cost');
    const item = db.prepare('SELECT id FROM invoice_items WHERE id = ? AND invoice_id = ?').get(iid, invoiceId);
    if (!item) throw new Error('Invalid invoice_item_id for this invoice');
    const { vat_rate, vat_exempt } = normalizeLpoLineVat(ln);
    if (vat_exempt !== 1 && vat_rate > 100) throw new Error('vat_rate cannot exceed 100');
    insLine.run(iprId, iid, sid, desc, qty, uc, vat_rate, vat_exempt);
    itemIds.push(iid);
  }
  return itemIds;
}

invoicesRouter.get('/:id/iprs', (req, res) => {
  const inv = db.prepare('SELECT id, type FROM invoices WHERE id = ?').get(req.params.id);
  if (!inv) return res.status(404).json({ error: 'Invoice not found' });
  if (inv.type !== 'invoice') return res.status(400).json({ error: 'IPRs apply to invoices only' });
  res.json(getIprsForInvoice(req.params.id));
});

invoicesRouter.post('/:id/iprs', requireAdminPermission('can_create_iprs'), (req, res) => {
  const inv = db.prepare('SELECT * FROM invoices WHERE id = ?').get(req.params.id);
  if (!inv) return res.status(404).json({ error: 'Invoice not found' });
  if (inv.type !== 'invoice') return res.status(400).json({ error: 'IPRs apply to invoices only' });
  const { notes, lines } = req.body;
  if (!Array.isArray(lines) || lines.length === 0) return res.status(400).json({ error: 'At least one IPR line is required' });
  const ref = nextSequenceRef('ipr', 'IPR');
  let iprId;
  try {
    const r = db
      .prepare(`INSERT INTO iprs (invoice_id, ref, notes, finalized) VALUES (?, ?, ?, 0)`)
      .run(req.params.id, ref, notes || null);
    iprId = r.lastInsertRowid;
    insertIprLinesFromBody(req.params.id, iprId, lines);
    recalcPurchaseForAllAllocatedLinesOnInvoice(req.params.id);
  } catch (e) {
    if (iprId) db.prepare('DELETE FROM iprs WHERE id = ?').run(iprId);
    return res.status(400).json({ error: e.message || 'Invalid IPR data' });
  }
  res.status(201).json({ invoice: fullInvoicePayload(req.params.id), ipr: getIprDocument(req.params.id, iprId) });
});

invoicesRouter.patch('/:id/iprs/:iprId', requireAdminPermission('can_create_iprs'), (req, res) => {
  const inv = db.prepare('SELECT * FROM invoices WHERE id = ?').get(req.params.id);
  if (!inv) return res.status(404).json({ error: 'Invoice not found' });
  if (inv.type !== 'invoice') return res.status(400).json({ error: 'IPRs apply to invoices only' });
  const ipr = db.prepare('SELECT * FROM iprs WHERE id = ? AND invoice_id = ?').get(req.params.iprId, req.params.id);
  if (!ipr) return res.status(404).json({ error: 'IPR not found' });
  if (Number(ipr.finalized) === 1) return res.status(400).json({ error: 'Cannot edit a finalised IPR' });
  const { notes, lines } = req.body;
  if (notes !== undefined) {
    db.prepare(`UPDATE iprs SET notes = ?, updated_at = datetime('now') WHERE id = ?`).run(notes ?? null, req.params.iprId);
  }
  if (Array.isArray(lines)) {
    if (lines.length === 0) return res.status(400).json({ error: 'At least one IPR line is required' });
    try {
      db.prepare('DELETE FROM ipr_lines WHERE ipr_id = ?').run(req.params.iprId);
      insertIprLinesFromBody(req.params.id, req.params.iprId, lines);
      db.prepare(`UPDATE iprs SET approved = 0, approved_at = NULL, approved_by_admin_user_id = NULL, updated_at = datetime('now') WHERE id = ?`)
        .run(req.params.iprId);
      recalcPurchaseForAllAllocatedLinesOnInvoice(req.params.id);
    } catch (e) {
      return res.status(400).json({ error: e.message || 'Invalid IPR data' });
    }
  }
  res.json({ invoice: fullInvoicePayload(req.params.id), ipr: getIprDocument(req.params.id, req.params.iprId) });
});

invoicesRouter.delete('/:id/iprs/:iprId', requireAdminPermission('can_create_iprs'), (req, res) => {
  const inv = db.prepare('SELECT * FROM invoices WHERE id = ?').get(req.params.id);
  if (!inv) return res.status(404).json({ error: 'Invoice not found' });
  if (inv.type !== 'invoice') return res.status(400).json({ error: 'IPRs apply to invoices only' });
  const ipr = db.prepare('SELECT * FROM iprs WHERE id = ? AND invoice_id = ?').get(req.params.iprId, req.params.id);
  if (!ipr) return res.status(404).json({ error: 'IPR not found' });
  if (Number(ipr.finalized) === 1) return res.status(400).json({ error: 'Cannot delete a finalised IPR' });
  const itemIds = db
    .prepare('SELECT DISTINCT invoice_item_id FROM ipr_lines WHERE ipr_id = ?')
    .all(req.params.iprId)
    .map((row) => row.invoice_item_id)
    .filter(Boolean);
  db.prepare('DELETE FROM iprs WHERE id = ?').run(req.params.iprId);
  recalcPurchaseForItemIds(itemIds, { clearIfNoAlloc: true });
  res.json(fullInvoicePayload(req.params.id));
});

invoicesRouter.post('/:id/iprs/:iprId/approve', requireAdminPermission('can_approve_lpo_ipr'), (req, res) => {
  const ipr = db.prepare('SELECT * FROM iprs WHERE id = ? AND invoice_id = ?').get(req.params.iprId, req.params.id);
  if (!ipr) return res.status(404).json({ error: 'IPR not found' });
  if (Number(ipr.finalized) === 1) return res.status(400).json({ error: 'Already finalised' });
  db.prepare(
    `UPDATE iprs SET approved = 1, approved_at = datetime('now'), approved_by_admin_user_id = ?, updated_at = datetime('now') WHERE id = ?`,
  ).run(req.admin.id, ipr.id);
  res.json({ invoice: fullInvoicePayload(req.params.id), ipr: getIprDocument(req.params.id, ipr.id) });
});

invoicesRouter.patch('/:id/iprs/:iprId/lines/:lineId/receipt', requireAdminAuth, (req, res) => {
  const ipr = db.prepare('SELECT * FROM iprs WHERE id = ? AND invoice_id = ?').get(req.params.iprId, req.params.id);
  if (!ipr) return res.status(404).json({ error: 'IPR not found' });
  if (Number(ipr.finalized) === 1) return res.status(400).json({ error: 'Already finalised' });
  if (Number(ipr.approved) !== 1) {
    return res.status(400).json({ error: 'IPR must be approved before marking parts received' });
  }
  const line = db.prepare('SELECT * FROM ipr_lines WHERE id = ? AND ipr_id = ?').get(req.params.lineId, req.params.iprId);
  if (!line) return res.status(404).json({ error: 'Line not found' });
  const assigned = req.body?.assigned_admin_user_id != null ? Number(req.body.assigned_admin_user_id) : null;
  const received = req.body?.received_confirmed !== undefined ? (req.body.received_confirmed ? 1 : 0) : null;
  if (assigned !== null && (!Number.isFinite(assigned) || assigned <= 0)) return res.status(400).json({ error: 'Invalid assigned_admin_user_id' });
  const canAssign = Boolean(req.admin.permissions?.can_approve_lpo_ipr || req.admin.permissions?.can_manage_team_members);
  if (assigned !== null && !canAssign) return res.status(403).json({ error: 'Only approver/manager can assign line receivers' });
  if (assigned !== null) {
    const au = db.prepare('SELECT id FROM admin_users WHERE id = ? AND active = 1').get(assigned);
    if (!au) return res.status(400).json({ error: 'Assigned team member not found' });
  }
  const nextAssigned = assigned ?? (line.assigned_admin_user_id || null);
  if (received === 1 && !nextAssigned) return res.status(400).json({ error: 'Assign a team member before marking received' });
  if (received !== null && req.admin.id !== Number(nextAssigned || 0)) {
    return res.status(403).json({ error: 'Only assigned team member can confirm receipt' });
  }
  db.prepare(
    `UPDATE ipr_lines
     SET assigned_admin_user_id = COALESCE(?, assigned_admin_user_id),
         received_confirmed = COALESCE(?, received_confirmed),
         received_confirmed_at = CASE WHEN ? = 1 THEN datetime('now') WHEN ? = 0 THEN NULL ELSE received_confirmed_at END,
         received_confirmed_by_admin_user_id = CASE WHEN ? = 1 THEN ? WHEN ? = 0 THEN NULL ELSE received_confirmed_by_admin_user_id END
     WHERE id = ? AND ipr_id = ?`,
  ).run(
    assigned,
    received,
    received,
    received,
    received,
    req.admin.id,
    received,
    req.params.lineId,
    req.params.iprId,
  );
  res.json({ invoice: fullInvoicePayload(req.params.id), ipr: getIprDocument(req.params.id, req.params.iprId) });
});

invoicesRouter.post('/:id/iprs/:iprId/finalize', requireAdminPermission('can_finalize_iprs'), (req, res) => {
  const inv = db.prepare('SELECT * FROM invoices WHERE id = ?').get(req.params.id);
  if (!inv) return res.status(404).json({ error: 'Invoice not found' });
  if (inv.type !== 'invoice') return res.status(400).json({ error: 'IPRs apply to invoices only' });
  const ipr = db.prepare('SELECT * FROM iprs WHERE id = ? AND invoice_id = ?').get(req.params.iprId, req.params.id);
  if (!ipr) return res.status(404).json({ error: 'IPR not found' });
  if (Number(ipr.finalized) === 1) return res.status(400).json({ error: 'Already finalised' });
  if (Number(ipr.approved) !== 1) return res.status(400).json({ error: 'IPR must be approved before finalisation' });
  const progress = receiptProgress('ipr_lines', 'ipr_id', ipr.id);
  if (!progress.allReceived) return res.status(400).json({ error: 'All IPR lines must be marked received before finalisation' });
  const lines = db.prepare('SELECT * FROM ipr_lines WHERE ipr_id = ? ORDER BY id').all(ipr.id);
  if (lines.length === 0) return res.status(400).json({ error: 'No lines to finalise' });
  try {
    transactionSync((tx) => {
      for (const ln of lines) {
        const qty = Number(ln.quantity);
        const out = tx.run(
          `UPDATE stock_items SET quantity = quantity - ?, updated_at = datetime('now') WHERE id = ? AND quantity >= ?`,
          [qty, ln.stock_item_id, qty],
        );
        if (!out.changes) throw new Error(`Insufficient stock for one or more lines`);
      }
      tx.run(`UPDATE iprs SET finalized = 1, updated_at = datetime('now') WHERE id = ?`, [ipr.id]);
    });
  } catch (e) {
    return res.status(400).json({ error: e.message || 'Finalise failed' });
  }
  recalcPurchaseForAllAllocatedLinesOnInvoice(req.params.id);
  res.json({ invoice: fullInvoicePayload(req.params.id), ipr: getIprDocument(req.params.id, ipr.id) });
});

const invoicePdfRowSql = `
  SELECT i.*, c.name as customer_name, c.email as customer_email, c.phone as customer_phone, c.address as customer_address,
    v.registration, v.make, v.model, v.vin, v.year, v.odometer,
    j.job_number, j.notes as job_notes, j.odometer_in, j.odometer_out
  FROM invoices i
  JOIN customers c ON i.customer_id = c.id
  LEFT JOIN vehicles v ON i.vehicle_id = v.id
  LEFT JOIN jobs j ON i.job_id = j.id
  WHERE i.id = ?
`;

invoicesRouter.get('/:id/lpos/:lpoId/pdf', async (req, res) => {
  try {
  const inv = db.prepare(invoicePdfRowSql).get(req.params.id);
  if (!inv) return res.status(404).json({ error: 'Invoice not found' });
  if (inv.type !== 'invoice') return res.status(400).json({ error: 'LPO PDF applies to invoices only' });
  const lpo = db
    .prepare(
      `
    SELECT l.*, s.name AS supplier_name, s.address AS supplier_address, s.phone AS supplier_phone, s.email AS supplier_email, s.pin AS supplier_pin,
      appr.display_name AS approved_by_display_name
    FROM lpos l
    JOIN suppliers s ON s.id = l.supplier_id
    LEFT JOIN admin_users appr ON appr.id = l.approved_by_admin_user_id
    WHERE l.id = ? AND l.invoice_id = ?
  `,
    )
    .get(req.params.lpoId, req.params.id);
  if (!lpo) return res.status(404).json({ error: 'LPO not found' });
  if (Number(lpo.approved) !== 1) return res.status(400).json({ error: 'LPO must be approved before printing' });
  const lines = db
    .prepare(
      `
    SELECT ll.*, ii.description AS ii_desc, si.code AS stock_code, si.name AS stock_name,
      rbu.display_name AS received_by_display_name,
      CASE
        WHEN ii.id IS NOT NULL THEN ii.description
        WHEN IFNULL(si.code, '') != '' THEN TRIM(si.code || ' — ' || COALESCE(si.name, ''))
        ELSE COALESCE(si.name, ll.description)
      END AS invoice_line_description
    FROM lpo_lines ll
    LEFT JOIN invoice_items ii ON ii.id = ll.invoice_item_id
    LEFT JOIN stock_items si ON si.id = ll.stock_item_id
    LEFT JOIN admin_users rbu ON rbu.id = ll.received_confirmed_by_admin_user_id
    WHERE ll.lpo_id = ?
    ORDER BY ll.id
  `,
    )
    .all(lpo.id);

  const doc = new PDFDocument({ size: 'A4', margin: 50 });
  const safeName = String(lpo.ref || 'LPO').replace(/[^a-zA-Z0-9-_]/g, '_');
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${safeName}.pdf"`);
  doc.pipe(res);

  const { company } = config;
  const dateStr = new Date(lpo.created_at || Date.now()).toLocaleDateString('en-GB', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
  const hasStockOnlyLines =
    lines.length > 0 && lines.every((ln) => (ln.invoice_item_id == null || ln.invoice_item_id === '') && ln.stock_item_id != null);
  const secondColHeader = hasStockOnlyLines ? 'Stock item' : 'Invoice line';
  const { margin, contentWidth, yContent } = drawWorkshopDocumentHeader(doc, inv, company, {
    docBoxTitle: 'LOCAL PURCHASE ORDER',
    docBoxNumber: lpo.ref,
    dateLabel: 'LPO date',
    dateValue: dateStr,
    showCustomerAndVehicle: false,
  });

  let y = yContent;
  doc.fontSize(10).font('Helvetica-Bold').text('SUPPLIER (order placed with):', margin, y);
  y = doc.y + 4;
  doc.fontSize(11).font('Helvetica-Bold').text(lpo.supplier_name || '—', margin, y);
  y = doc.y + 6;
  doc.fontSize(9).font('Helvetica');
  if (lpo.supplier_address) {
    doc.text(lpo.supplier_address, margin, y, { width: contentWidth });
    y = doc.y + 4;
  }
  if (lpo.supplier_phone) {
    doc.text(`Tel: ${lpo.supplier_phone}`, margin, y);
    y = doc.y + 4;
  }
  if (lpo.supplier_email) {
    doc.text(`Email: ${lpo.supplier_email}`, margin, y);
    y = doc.y + 4;
  }
  doc.text(`PIN: ${lpo.supplier_pin || '—'}`, margin, y);
  y = doc.y + 4;
  y += 8;
  doc.fillColor('#000000');
  if (lpo.notes) {
    doc.font('Helvetica-Oblique').text(`Notes: ${lpo.notes}`, margin, y, { width: contentWidth });
    y = doc.y + 10;
    doc.font('Helvetica');
  }

  /** Extra space between right-aligned VAT amt and Received by (pt); avoids glyph overflow touching the next column. */
  const gutterVatRecv = 10;
  const colDesc = contentWidth * 0.15;
  const colInvLine = contentWidth * 0.17;
  const colQty = contentWidth * 0.055;
  const colUnit = contentWidth * 0.12;
  const colVatP = contentWidth * 0.06;
  const colVatAmt = contentWidth * 0.16;
  const colRecv = contentWidth * 0.145 - gutterVatRecv;
  const colGross = contentWidth * 0.14;
  const xInv = margin + colDesc;
  const xQty = xInv + colInvLine;
  const xUnit = xQty + colQty;
  const xVatP = xUnit + colUnit;
  const xVatAmt = xVatP + colVatP;
  const xRecv = xVatAmt + colVatAmt + gutterVatRecv;
  const xGross = xRecv + colRecv;
  const tableTop = y;
  doc.fontSize(8).font('Helvetica-Bold');
  const hdrH = Math.max(
    doc.heightOfString('Purchase item', { width: colDesc }),
    doc.heightOfString(secondColHeader, { width: colInvLine }),
    doc.heightOfString('Qty', { width: colQty, align: 'right' }),
    doc.heightOfString('Unit ex VAT', { width: colUnit, align: 'right' }),
    doc.heightOfString('VAT', { width: colVatP, align: 'right' }),
    doc.heightOfString('VAT amt', { width: colVatAmt, align: 'right' }),
    doc.heightOfString('Received by', { width: colRecv }),
    doc.heightOfString('Line total', { width: colGross, align: 'right' }),
    10,
  );
  doc.text('Purchase item', margin, tableTop, { width: colDesc });
  doc.text(secondColHeader, xInv, tableTop, { width: colInvLine });
  doc.text('Qty', xQty, tableTop, { width: colQty, align: 'right' });
  doc.text('Unit ex VAT', xUnit, tableTop, { width: colUnit, align: 'right' });
  doc.text('VAT', xVatP, tableTop, { width: colVatP, align: 'right' });
  doc.text('VAT amt', xVatAmt, tableTop, { width: colVatAmt, align: 'right' });
  doc.text('Received by', xRecv, tableTop, { width: colRecv });
  doc.text('Line total', xGross, tableTop, { width: colGross, align: 'right' });
  const ruleY = tableTop + hdrH + 4;
  doc.moveTo(margin, ruleY).lineTo(margin + contentWidth, ruleY).stroke();

  y = ruleY + 8;
  doc.font('Helvetica');
  let sumNet = 0;
  let sumVat = 0;
  for (const ln of lines) {
    const desc = ln.description || '';
    const invLine = ln.invoice_line_description || '';
    const qty = Number(ln.quantity) || 0;
    const uc = Number(ln.unit_cost) || 0;
    const net = lpoLineNet(ln);
    const vatAmt = lpoLineVat(ln);
    const gross = lpoLineGross(ln);
    sumNet += net;
    sumVat += vatAmt;
    const vatLabel =
      Number(ln.vat_exempt) === 1 ? 'Exempt' : Number(ln.vat_rate) > 0 ? `${Number(ln.vat_rate)}%` : '—';
    const recvBy =
      Number(ln.received_confirmed) === 1 && ln.received_by_display_name
        ? String(ln.received_by_display_name).trim()
        : '—';
    const ucStr = kshFormat(uc);
    const vatStr = vatAmt > 0 ? kshFormat(vatAmt) : '—';
    const grossStr = kshFormat(gross);
    const rowH = Math.max(
      20,
      doc.heightOfString(desc, { width: colDesc }),
      doc.heightOfString(invLine, { width: colInvLine }),
      doc.heightOfString(ucStr, { width: colUnit, align: 'right' }),
      doc.heightOfString(vatStr, { width: colVatAmt, align: 'right' }),
      doc.heightOfString(recvBy, { width: colRecv }),
      doc.heightOfString(grossStr, { width: colGross, align: 'right' }),
    ) + 4;
    doc.text(desc, margin, y, { width: colDesc });
    doc.text(invLine, xInv, y, { width: colInvLine });
    doc.text(qty.toFixed(2), xQty, y, { width: colQty, align: 'right' });
    doc.text(ucStr, xUnit, y, { width: colUnit, align: 'right' });
    doc.text(vatLabel, xVatP, y, { width: colVatP, align: 'right' });
    doc.text(vatStr, xVatAmt, y, { width: colVatAmt, align: 'right' });
    doc.text(recvBy, xRecv, y, { width: colRecv });
    doc.text(grossStr, xGross, y, { width: colGross, align: 'right' });
    y += rowH;
  }

  const totGross = Math.round((sumNet + sumVat) * 100) / 100;
  y += 10;
  const sumX = xUnit;
  const sumW = colUnit + colVatP + colVatAmt + gutterVatRecv + colRecv + colGross;
  doc.fontSize(9).font('Helvetica');
  doc.text(`Subtotal (ex VAT)  ${kshFormat(sumNet)}`, sumX, y, { width: sumW, align: 'right' });
  y = doc.y + 4;
  doc.text(`VAT  ${kshFormat(sumVat)}`, sumX, y, { width: sumW, align: 'right' });
  y = doc.y + 6;
  doc.fontSize(10).font('Helvetica-Bold').text(`Total (inc VAT)  ${kshFormat(totGross)}`, sumX, y, { width: sumW, align: 'right' });
  y = doc.y + 16;
  doc.fontSize(8).font('Helvetica').fillColor('#333333');
  const apprName = lpo.approved_by_display_name || '—';
  const apprAt = lpo.approved_at
    ? new Date(lpo.approved_at).toLocaleString('en-GB', { dateStyle: 'short', timeStyle: 'short' })
    : '—';
  doc.text(`Approved by: ${apprName} · ${apprAt}`, margin, y, { width: contentWidth });
  y = doc.y + 6;
  if (Number(lpo.finalized) === 1) {
    const recvNames = [
      ...new Set(
        lines
          .filter((ln) => Number(ln.received_confirmed) === 1 && ln.received_by_display_name)
          .map((ln) => String(ln.received_by_display_name).trim()),
      ),
    ].filter(Boolean);
    doc.text(
      `Goods received by: ${recvNames.length ? recvNames.join(' · ') : '—'}`,
      margin,
      y,
      { width: contentWidth },
    );
    y = doc.y + 6;
  }
  y = await embedLpoVerifyQr(doc, lpo, { margin, contentWidth, y: y + 4 }, req);
  doc.fillColor('#555555');
  doc.text(
    'Unit costs and subtotal exclude VAT. VAT is shown per line where applicable; exempt lines carry no VAT. Line total includes VAT when charged.',
    margin,
    y,
    { width: contentWidth },
  );
  doc.end();
  } catch (e) {
    console.error('[LPO PDF]', e);
    if (!res.headersSent) res.status(500).json({ error: e.message || 'PDF failed' });
  }
});

invoicesRouter.get('/:id/iprs/:iprId/pdf', (req, res) => {
  const inv = db.prepare(invoicePdfRowSql).get(req.params.id);
  if (!inv) return res.status(404).json({ error: 'Invoice not found' });
  if (inv.type !== 'invoice') return res.status(400).json({ error: 'IPR PDF applies to invoices only' });
  const docRow = getIprDocument(req.params.id, req.params.iprId);
  if (!docRow) return res.status(404).json({ error: 'IPR not found' });
  if (Number(docRow.approved) !== 1) return res.status(400).json({ error: 'IPR must be approved before printing' });
  const lines = docRow.lines || [];

  const pdfDoc = new PDFDocument({ size: 'A4', margin: 50 });
  const safeName = String(docRow.ref || 'IPR').replace(/[^a-zA-Z0-9-_]/g, '_');
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${safeName}.pdf"`);
  pdfDoc.pipe(res);

  const { company } = config;
  const dateStr = new Date(docRow.created_at || Date.now()).toLocaleDateString('en-GB', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
  const { margin, contentWidth, yContent } = drawWorkshopDocumentHeader(pdfDoc, inv, company, {
    docBoxTitle: 'INTERNAL REQUISITION',
    docBoxNumber: docRow.ref,
    dateLabel: Number(docRow.finalized) === 1 ? 'Issue date' : 'Draft date',
    dateValue: dateStr,
  });

  let y = yContent;
  pdfDoc.fontSize(10).font('Helvetica-Bold').text('Stock issue (from store)', margin, y);
  y = pdfDoc.y + 6;
  pdfDoc.fontSize(9).font('Helvetica');
  pdfDoc.text(`Related invoice: ${inv.invoice_number}${inv.job_number ? ` · Job ${inv.job_number}` : ''}`, margin, y, { width: contentWidth });
  y = pdfDoc.y + 10;
  if (Number(docRow.finalized) !== 1) {
    pdfDoc.fillColor('#8b4513').font('Helvetica-Bold').text('DRAFT — quantities are not deducted until finalised.', margin, y, { width: contentWidth });
    pdfDoc.fillColor('#000000');
    y = pdfDoc.y + 10;
  }
  if (docRow.notes) {
    pdfDoc.font('Helvetica-Oblique').text(`Notes: ${docRow.notes}`, margin, y, { width: contentWidth });
    y = pdfDoc.y + 10;
    pdfDoc.font('Helvetica');
  }

  const colDesc = contentWidth * 0.21;
  const colInvLine = contentWidth * 0.23;
  const colQty = contentWidth * 0.07;
  const colUnit = contentWidth * 0.11;
  const colVatP = contentWidth * 0.09;
  const colVatAmt = contentWidth * 0.11;
  const colGross = contentWidth * 0.18;
  const xInv = margin + colDesc;
  const xQty = xInv + colInvLine;
  const xUnit = xQty + colQty;
  const xVatP = xUnit + colUnit;
  const xVatAmt = xVatP + colVatP;
  const xGross = xVatAmt + colVatAmt;
  const tableTop = y;
  pdfDoc.fontSize(8).font('Helvetica-Bold');
  const iprHdrH = Math.max(
    pdfDoc.heightOfString('Stock item', { width: colDesc }),
    pdfDoc.heightOfString('Invoice line', { width: colInvLine }),
    pdfDoc.heightOfString('Qty', { width: colQty, align: 'right' }),
    pdfDoc.heightOfString('Unit ex VAT', { width: colUnit, align: 'right' }),
    pdfDoc.heightOfString('VAT', { width: colVatP, align: 'right' }),
    pdfDoc.heightOfString('VAT amt', { width: colVatAmt, align: 'right' }),
    pdfDoc.heightOfString('Line total', { width: colGross, align: 'right' }),
    10,
  );
  pdfDoc.text('Stock item', margin, tableTop, { width: colDesc });
  pdfDoc.text('Invoice line', xInv, tableTop, { width: colInvLine });
  pdfDoc.text('Qty', xQty, tableTop, { width: colQty, align: 'right' });
  pdfDoc.text('Unit ex VAT', xUnit, tableTop, { width: colUnit, align: 'right' });
  pdfDoc.text('VAT', xVatP, tableTop, { width: colVatP, align: 'right' });
  pdfDoc.text('VAT amt', xVatAmt, tableTop, { width: colVatAmt, align: 'right' });
  pdfDoc.text('Line total', xGross, tableTop, { width: colGross, align: 'right' });
  const iprRuleY = tableTop + iprHdrH + 4;
  pdfDoc.moveTo(margin, iprRuleY).lineTo(margin + contentWidth, iprRuleY).stroke();

  y = iprRuleY + 8;
  pdfDoc.font('Helvetica');
  let sumNet = 0;
  let sumVat = 0;
  for (const ln of lines) {
    const desc = ln.description || '';
    const invLine = ln.invoice_line_description || '';
    const qty = Number(ln.quantity) || 0;
    const uc = Number(ln.unit_cost) || 0;
    const net = lpoLineNet(ln);
    const vatAmt = lpoLineVat(ln);
    const gross = lpoLineGross(ln);
    sumNet += net;
    sumVat += vatAmt;
    const vatLabel =
      Number(ln.vat_exempt) === 1 ? 'Exempt' : Number(ln.vat_rate) > 0 ? `${Number(ln.vat_rate)}%` : '—';
    const ucStr = kshFormat(uc);
    const vatStr = vatAmt > 0 ? kshFormat(vatAmt) : '—';
    const grossStr = kshFormat(gross);
    const rowH = Math.max(
      20,
      pdfDoc.heightOfString(desc, { width: colDesc }),
      pdfDoc.heightOfString(invLine, { width: colInvLine }),
      pdfDoc.heightOfString(ucStr, { width: colUnit, align: 'right' }),
      pdfDoc.heightOfString(vatStr, { width: colVatAmt, align: 'right' }),
      pdfDoc.heightOfString(grossStr, { width: colGross, align: 'right' }),
    ) + 4;
    pdfDoc.text(desc, margin, y, { width: colDesc });
    pdfDoc.text(invLine, xInv, y, { width: colInvLine });
    pdfDoc.text(qty.toFixed(2), xQty, y, { width: colQty, align: 'right' });
    pdfDoc.text(ucStr, xUnit, y, { width: colUnit, align: 'right' });
    pdfDoc.text(vatLabel, xVatP, y, { width: colVatP, align: 'right' });
    pdfDoc.text(vatStr, xVatAmt, y, { width: colVatAmt, align: 'right' });
    pdfDoc.text(grossStr, xGross, y, { width: colGross, align: 'right' });
    y += rowH;
  }

  const totGross = Math.round((sumNet + sumVat) * 100) / 100;
  y += 10;
  const sumX = xUnit;
  const sumW = colUnit + colVatP + colVatAmt + colGross;
  pdfDoc.fontSize(9).font('Helvetica');
  pdfDoc.text(`Subtotal (ex VAT)  ${kshFormat(sumNet)}`, sumX, y, { width: sumW, align: 'right' });
  y = pdfDoc.y + 4;
  pdfDoc.text(`VAT  ${kshFormat(sumVat)}`, sumX, y, { width: sumW, align: 'right' });
  y = pdfDoc.y + 6;
  pdfDoc.fontSize(10).font('Helvetica-Bold').text(`Total (inc VAT)  ${kshFormat(totGross)}`, sumX, y, { width: sumW, align: 'right' });
  y = pdfDoc.y + 16;
  pdfDoc.fontSize(8).font('Helvetica').fillColor('#333333');
  const iprApprName = docRow.approved_by_display_name || '—';
  const iprApprAt = docRow.approved_at
    ? new Date(docRow.approved_at).toLocaleString('en-GB', { dateStyle: 'short', timeStyle: 'short' })
    : '—';
  pdfDoc.text(`Approved by: ${iprApprName} · ${iprApprAt}`, margin, y, { width: contentWidth });
  y = pdfDoc.y + 6;
  if (Number(docRow.finalized) === 1) {
    const recvNames = [
      ...new Set(
        lines
          .filter((ln) => Number(ln.received_confirmed) === 1 && ln.received_by_admin_name)
          .map((ln) => String(ln.received_by_admin_name).trim()),
      ),
    ].filter(Boolean);
    pdfDoc.text(
      `Goods received by: ${recvNames.length ? recvNames.join(' · ') : '—'}`,
      margin,
      y,
      { width: contentWidth },
    );
    y = pdfDoc.y + 6;
  }
  pdfDoc.fillColor('#555555');
  pdfDoc.text(
    Number(docRow.finalized) === 1
      ? 'This document records internal issue of store stock. Quantities were deducted from inventory when the IPR was finalised.'
      : 'Draft IPR: edit or finalise from the job / invoice screen. Stock is not adjusted until finalisation.',
    margin,
    y,
    { width: contentWidth },
  );
  pdfDoc.end();
});

invoicesRouter.get('/:id/pdf', (req, res) => {
  const inv = db.prepare(`
    SELECT i.*, c.name as customer_name, c.email as customer_email, c.phone as customer_phone, c.address as customer_address,
      v.registration, v.make, v.model, v.vin, v.year, v.odometer, v.notes as vehicle_notes,
      j.job_number, j.notes as job_notes, j.odometer_in, j.odometer_out
    FROM invoices i
    JOIN customers c ON i.customer_id = c.id
    LEFT JOIN vehicles v ON i.vehicle_id = v.id
    LEFT JOIN jobs j ON i.job_id = j.id
    WHERE i.id = ?
  `).get(req.params.id);
  if (!inv) return res.status(404).json({ error: 'Invoice not found' });
  
  const items = db.prepare('SELECT * FROM invoice_items WHERE invoice_id = ? ORDER BY id').all(req.params.id);
  const tasks = inv.job_id ? db.prepare('SELECT description FROM job_tasks WHERE job_id = ? ORDER BY sort_order, id').all(inv.job_id) : [];
  const workDescription = tasks.length > 0 ? tasks.map(t => t.description).join(', ') : (inv.job_notes || '');
  
  // Check for star markers in descriptions
  const hasSecondHand = items.some(it => it.description?.includes('*') && !it.description?.includes('**'));
  const hasNonGenuine = items.some(it => it.description?.includes('**'));
  
  const doc = new PDFDocument({ size: 'A4', margin: 50 });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${inv.invoice_number}.pdf"`);
  doc.pipe(res);
  
  const { company } = config;
  const pageWidth = doc.page.width;
  const margin = 50;
  const contentWidth = pageWidth - (margin * 2);
  
  // Try to load logo - prefer logo1.png, then fall back to logo.png (absolute paths)
  let logoPath = null;
  const possibleLogoPaths = [
    // logo1.png (new combined logo+text)
    path.resolve(__dirname, '..', 'logo1.png'), // server/logo1.png
    path.resolve(__dirname, '..', '..', 'logo1.png'), // project-root/logo1.png
    path.resolve(process.cwd(), 'server', 'logo1.png'),
    path.resolve(process.cwd(), 'logo1.png'),
    // fallback to old logo.png if logo1.png not found
    path.resolve(__dirname, '..', 'logo.png'),
    path.resolve(__dirname, '..', '..', 'logo.png'),
    path.resolve(process.cwd(), 'server', 'logo.png'),
    path.resolve(process.cwd(), 'logo.png'),
  ];
  
  for (const logoLoc of possibleLogoPaths) {
    try {
      const absPath = path.resolve(logoLoc);
      if (existsSync(absPath)) {
        logoPath = absPath;
        console.log('Found logo at:', absPath);
        break;
      }
    } catch (e) {
      // Continue checking other paths
    }
  }
  
  // Header - Logo on left (logo1.png already includes text)
  let headerY = margin;
  const logoWidth = 260; // Twice as large as before
  const logoHeight = 200;
  const logoX = margin;
  
  if (logoPath) {
    try {
      const logoBuffer = readFileSync(logoPath);
      // Add logo image on left - larger size
      doc.image(logoBuffer, logoX, headerY, { 
        fit: [logoWidth, logoHeight]
      });
      console.log('Logo added successfully to PDF');
    } catch (err) {
      console.error('Failed to add logo to PDF:', err.message);
    }
  }
  
  // Company contact details (top right, aligned with header)
  const contactX = pageWidth - margin - 200;
  let contactY = headerY;
  doc.fontSize(9).font('Helvetica');
  doc.text(company.name, contactX, contactY, { width: 200, align: 'left' });
  contactY += 12;
  doc.text(company.address, contactX, contactY, { width: 200, align: 'left' });
  contactY += 12;
  doc.text(`VAT Registration No.: ${company.vatRegistration}`, contactX, contactY, { width: 200, align: 'left' });
  contactY += 12;
  doc.text(`Licence: PIN: ${company.pin}`, contactX, contactY, { width: 200, align: 'left' });
  contactY += 12;
  // Format phone with space: +254733 514965
  const phoneFormatted = company.phone.replace(/(\+254)(\d{3})(\d{6})/, '$1$2 $3');
  doc.text(`Tel: ${phoneFormatted}`, contactX, contactY, { width: 200, align: 'left' });
  contactY += 12;
  doc.text(`Email: ${company.email}`, contactX, contactY, { width: 200, align: 'left' });
  
  // Document box (quote or invoice) below contact info, right-aligned with contact details
  const docBoxWidth = 200; // Match width of contact details
  const docBoxX = contactX; // Align left edge with contact details
  const docBoxY = contactY + 15;
  doc.rect(docBoxX, docBoxY, docBoxWidth, 50).stroke();
  const numberPart = inv.invoice_number.replace(/^QUO-/, '').replace(/^INV-/, '');
  const title = inv.type === 'invoice' ? 'INVOICE' : 'QUOTE';
  const dateLabel = inv.type === 'invoice' ? 'Invoice Date' : 'Issue Date';
  doc.fontSize(16).font('Helvetica-Bold').text(`${title} #${numberPart}`, docBoxX + 10, docBoxY + 8, { width: docBoxWidth - 20, align: 'left' });
  const issueDate = new Date(inv.created_at).toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' });
  doc.fontSize(9).font('Helvetica').text(`${dateLabel}: ${issueDate}`, docBoxX + 10, docBoxY + 30, { width: docBoxWidth - 20, align: 'left' });
  
  // Customer and vehicle details in two columns below the header
  const headerBottom = headerY + logoHeight;
  const detailsTop = headerBottom + 4; // tight spacing below logo block
  const colWidth = contentWidth * 0.45;
  const rightColX = margin + colWidth + 20; // small gap between columns

  // Left column – "PREPARED FOR" (customer)
  let leftY = detailsTop;
  doc.fontSize(10).font('Helvetica-Bold').text('PREPARED FOR:', margin, leftY);
  leftY = doc.y + 4;
  doc.fontSize(11).font('Helvetica-Bold').text(inv.customer_name, margin, leftY);
  leftY = doc.y + 6;

  doc.fontSize(9).font('Helvetica');
  if (inv.customer_address) {
    doc.text(inv.customer_address, margin, leftY, { width: colWidth });
    leftY = doc.y + 4;
  }
  if (inv.customer_phone) {
    doc.text(`Tel: ${inv.customer_phone}`, margin, leftY, { width: colWidth });
    leftY = doc.y + 4;
  }
  if (inv.customer_email) {
    doc.text(`Email: ${inv.customer_email}`, margin, leftY, { width: colWidth });
    leftY = doc.y + 4;
  }

  // Right column – VEHICLE section
  let rightY = detailsTop;
  doc.fontSize(10).font('Helvetica-Bold').text('VEHICLE:', rightColX, rightY);
  rightY = doc.y + 4;
  doc.fontSize(9).font('Helvetica');
  doc.text(`Vehicle Owner: ${inv.customer_name}`, rightColX, rightY, { width: colWidth });
  rightY = doc.y + 4;
  if (inv.registration) {
    doc.text(`Reg No: ${inv.registration}`, rightColX, rightY, { width: colWidth });
    rightY = doc.y + 4;
  }
  if (inv.vin) {
    doc.text(`VIN: ${inv.vin}`, rightColX, rightY, { width: colWidth });
    rightY = doc.y + 4;
  }
  if (inv.make || inv.model) {
    const modelText = [inv.make, inv.model].filter(Boolean).join(' ');
    doc.text(`Model: ${modelText}`, rightColX, rightY, { width: colWidth });
    rightY = doc.y + 4;
  }
  if (inv.year) {
    doc.text(`Year: ${inv.year}`, rightColX, rightY, { width: colWidth });
    rightY = doc.y + 4;
  }
  const odometer = inv.odometer_out || inv.odometer_in || inv.odometer;
  if (odometer) {
    doc.text(`Odometer: ${Number(odometer).toLocaleString()} Kms`, rightColX, rightY, { width: colWidth });
    rightY = doc.y + 4;
  }

  // Continue below whichever column is taller
  let yPos = Math.max(leftY, rightY) + 16;

  // Items table
  const tableTop = yPos;
  // Better column width distribution: Description gets more space, others are proportional
  const colWidths = { desc: contentWidth * 0.45, qty: contentWidth * 0.12, unit: contentWidth * 0.21, amount: contentWidth * 0.22 };
  const rowHeight = 20;
  
  // Table header
  doc.fontSize(9).font('Helvetica-Bold');
  doc.text('Description', margin, tableTop, { width: colWidths.desc });
  doc.text('Qty.', margin + colWidths.desc, tableTop, { width: colWidths.qty, align: 'right' });
  doc.text('Unit Price', margin + colWidths.desc + colWidths.qty, tableTop, { width: colWidths.unit, align: 'right' });
  doc.text('Amount', margin + colWidths.desc + colWidths.qty + colWidths.unit, tableTop, { width: colWidths.amount, align: 'right' });
  
  doc.moveTo(margin, tableTop + 15).lineTo(margin + contentWidth, tableTop + 15).stroke();
  
  // Table rows
  yPos = tableTop + 20;
  doc.fontSize(9).font('Helvetica');
  items.forEach((item) => {
    const desc = item.description || '';
    const qty = item.quantity || 1;
    const unitPrice = item.unit_price || 0;
    const amount = qty * unitPrice;
    
    // Calculate height needed for description wrapping
    const descHeight = doc.heightOfString(desc, { width: colWidths.desc });
    const actualRowHeight = Math.max(rowHeight, descHeight + 4);
    
    doc.text(desc, margin, yPos, { width: colWidths.desc });
    doc.text(qty.toFixed(1), margin + colWidths.desc, yPos, { width: colWidths.qty, align: 'right' });
    const unitPriceRounded = Math.round(unitPrice || 0);
    const amountRounded = Math.round(amount || 0);
    doc.text(`KSh ${unitPriceRounded.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`, margin + colWidths.desc + colWidths.qty, yPos, { width: colWidths.unit, align: 'right' });
    doc.text(`KSh ${amountRounded.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`, margin + colWidths.desc + colWidths.qty + colWidths.unit, yPos, { width: colWidths.amount, align: 'right' });
    
    yPos += actualRowHeight;
  });
  
  // Totals box (right side)
  const totalsY = Math.max(yPos + 10, tableTop + 80); // Reduce gap to items
  const totalsBoxWidth = 180;
  const totalsBoxX = pageWidth - margin - totalsBoxWidth;
  const totalsBoxHeight = 60;
  
  doc.rect(totalsBoxX, totalsY, totalsBoxWidth, totalsBoxHeight).stroke();
  let totalsYPos = totalsY + 10;
  
  doc.fontSize(9).font('Helvetica');
  // Subtotal - label on left, value on right (no decimals)
  const subtotalRounded = Math.round(inv.subtotal || 0);
  const taxRounded = Math.round(inv.tax_amount || 0);
  const totalRounded = Math.round(inv.total || 0);

  doc.text('Subtotal', totalsBoxX + 10, totalsYPos);
  doc.text(
    `KSh ${subtotalRounded.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`,
    totalsBoxX + 10,
    totalsYPos,
    { width: totalsBoxWidth - 20, align: 'right' }
  );
  totalsYPos += 12;
  
  // VAT
  doc.text('VAT', totalsBoxX + 10, totalsYPos);
  doc.text(
    `KSh ${taxRounded.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`,
    totalsBoxX + 10,
    totalsYPos,
    { width: totalsBoxWidth - 20, align: 'right' }
  );
  totalsYPos += 12;
  
  // Total Incl. VAT
  doc.fontSize(10).font('Helvetica-Bold');
  doc.text('Total Incl. VAT', totalsBoxX + 10, totalsYPos);
  doc.text(
    `KSh ${totalRounded.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`,
    totalsBoxX + 10,
    totalsYPos,
    { width: totalsBoxWidth - 20, align: 'right' }
  );
  
  // Footer - Notes and payment details (kept on a single page, left aligned)
  const footerY = totalsY + totalsBoxHeight + 20;
  doc.fontSize(8).font('Helvetica');
  
  // Disclaimers and notes
  let footerYPos = footerY;
  doc.text(
    'Please note that this is an estimate only and not a final bill. In case of any additional costs, you will be notified for approval.',
    margin,
    footerYPos,
    { width: contentWidth * 0.9 }
  );
  footerYPos = doc.y + 10;
  
  // Limited warranty note for starred parts – always show so meaning is clear
  doc.text(
    '*Non-genuine & **2nd hand parts come with limited warranty',
    margin,
    footerYPos,
    { width: contentWidth * 0.9 }
  );
  footerYPos = doc.y + 10;
  
  // Payment terms
  doc.font('Helvetica-Bold').text('Payment Terms:', margin, footerYPos);
  footerYPos = doc.y + 6;
  doc.font('Helvetica').text(company.paymentTerms, margin, footerYPos);
  footerYPos = doc.y + 4;
  doc.text(`Validity ${company.validityDays} days`, margin, footerYPos);
  footerYPos = doc.y + 4;
  doc.text('Cheque payment to go through before collection', margin, footerYPos);
  footerYPos = doc.y + 10;
  
  // Payment and bank details – all on the left to avoid spilling to a new page
  doc.font('Helvetica-Bold').text('Payment Details:', margin, footerYPos);
  footerYPos = doc.y + 6;
  doc.font('Helvetica').text(`Mpesa Till Number: ${company.mpesa.tillNumber}`, margin, footerYPos);
  footerYPos = doc.y + 10;
  
  doc.fontSize(9).font('Helvetica-Bold').text(company.bank.name, margin, footerYPos);
  footerYPos = doc.y + 6;
  doc.font('Helvetica').text(`Name: ${company.legalName}`, margin, footerYPos);
  footerYPos = doc.y + 4;
  doc.text(`Branch: ${company.bank.branch}`, margin, footerYPos);
  footerYPos = doc.y + 4;
  doc.text(`Acc. No: ${company.bank.accountNumber}`, margin, footerYPos);
  footerYPos = doc.y + 4;
  doc.text(`Swift Code: ${company.bank.swiftCode}`, margin, footerYPos);
  
  doc.end();
});
