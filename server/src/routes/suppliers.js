import { Router } from 'express';
import { db } from '../db.js';
import { SQL_LPO_LINE_GROSS, lpoLineGross } from '../lpoLineTotals.js';
import { requireAdminPermission } from '../auth.js';

export const suppliersRouter = Router();

function supplierBalancesSubquery() {
  return `
    SELECT s.*,
      COALESCE(lpo.t, 0) AS lpo_total_cost,
      COALESCE(pay.t, 0) AS payments_total,
      (COALESCE(lpo.t, 0) - COALESCE(pay.t, 0)) AS balance_owed
    FROM suppliers s
    LEFT JOIN (
      SELECT l.supplier_id, SUM(${SQL_LPO_LINE_GROSS}) AS t
      FROM lpo_lines ll
      JOIN lpos l ON l.id = ll.lpo_id
      GROUP BY l.supplier_id
    ) lpo ON lpo.supplier_id = s.id
    LEFT JOIN (
      SELECT supplier_id, SUM(amount) AS t
      FROM supplier_payments
      GROUP BY supplier_id
    ) pay ON pay.supplier_id = s.id
  `;
}

function getSupplierDetailPayload(id) {
  const supplier = db.prepare('SELECT * FROM suppliers WHERE id = ?').get(id);
  if (!supplier) return null;

  const lpo_total_cost =
    Number(
      db
        .prepare(
          `
      SELECT COALESCE(SUM(${SQL_LPO_LINE_GROSS}), 0) AS t
      FROM lpo_lines ll
      JOIN lpos l ON l.id = ll.lpo_id
      WHERE l.supplier_id = ?
    `,
        )
        .get(id).t,
    ) || 0;

  const payments_total =
    Number(
      db.prepare('SELECT COALESCE(SUM(amount), 0) AS t FROM supplier_payments WHERE supplier_id = ?').get(id).t,
    ) || 0;

  const lpoDocs = db
    .prepare(
      `
    SELECT l.id AS lpo_id, l.ref, l.notes, l.created_at, l.invoice_id, i.invoice_number, i.job_id, j.job_number AS job_number, c.name AS customer_name
    FROM lpos l
    LEFT JOIN invoices i ON i.id = l.invoice_id AND i.type = 'invoice'
    LEFT JOIN jobs j ON j.id = i.job_id
    LEFT JOIN customers c ON c.id = i.customer_id
    WHERE l.supplier_id = ?
    ORDER BY l.id DESC
  `,
    )
    .all(id);

  const lpos = lpoDocs.map((doc) => {
    const lines = db
      .prepare(
        `
      SELECT ll.id AS lpo_line_id, ll.description AS purchase_description, ll.quantity, ll.unit_cost,
        ll.vat_rate, ll.vat_exempt,
        (ll.quantity * ll.unit_cost) AS line_cost,
        ll.invoice_item_id, ll.stock_item_id,
        COALESCE(
          ii.description,
          CASE
            WHEN IFNULL(si.code, '') != '' THEN TRIM(si.code || ' — ' || COALESCE(si.name, ''))
            ELSE si.name
          END,
          ll.description
        ) AS invoice_line_description
      FROM lpo_lines ll
      LEFT JOIN invoice_items ii ON ii.id = ll.invoice_item_id
      LEFT JOIN stock_items si ON si.id = ll.stock_item_id
      WHERE ll.lpo_id = ?
      ORDER BY ll.id
    `,
      )
      .all(doc.lpo_id);
    const document_total = lines.reduce((s, ln) => s + lpoLineGross(ln), 0);
    return { ...doc, lines, document_total };
  });

  const payments = db
    .prepare('SELECT * FROM supplier_payments WHERE supplier_id = ? ORDER BY paid_at DESC, id DESC')
    .all(id);

  return {
    ...supplier,
    lpo_total_cost,
    payments_total,
    balance_owed: Math.round((lpo_total_cost - payments_total) * 100) / 100,
    lpos,
    payments,
  };
}

suppliersRouter.get('/', (req, res) => {
  const q = (req.query.q || '').trim();
  const safe = q.replace(/[%_\\]/g, '').trim();
  let rows;
  if (safe) {
    const like = `%${safe}%`;
    rows = db
      .prepare(
        `
      ${supplierBalancesSubquery()}
      WHERE s.name LIKE ? OR IFNULL(s.email, '') LIKE ? OR IFNULL(s.phone, '') LIKE ? OR IFNULL(s.pin, '') LIKE ?
      ORDER BY s.name
    `,
      )
      .all(like, like, like, like);
  } else {
    rows = db.prepare(`${supplierBalancesSubquery()} ORDER BY s.name`).all();
  }
  res.json(rows);
});

suppliersRouter.post('/', (req, res) => {
  const { name, email, phone, address, pin, notes } = req.body;
  if (!name || !String(name).trim()) return res.status(400).json({ error: 'name is required' });
  const pinVal = pin != null && String(pin).trim() ? String(pin).trim() : null;
  const result = db
    .prepare(
      `
    INSERT INTO suppliers (name, email, phone, address, pin, notes)
    VALUES (?, ?, ?, ?, ?, ?)
  `,
    )
    .run(String(name).trim(), email || null, phone || null, address || null, pinVal, notes || null);
  const row = db.prepare('SELECT * FROM suppliers WHERE id = ?').get(result.lastInsertRowid);
  res.status(201).json({ ...row, lpo_total_cost: 0, payments_total: 0, balance_owed: 0 });
});

suppliersRouter.post('/:id/payments', requireAdminPermission('can_record_supplier_payments'), (req, res) => {
  const sup = db.prepare('SELECT id FROM suppliers WHERE id = ?').get(req.params.id);
  if (!sup) return res.status(404).json({ error: 'Supplier not found' });
  const { amount, paid_at, notes } = req.body;
  const num = Number(amount);
  if (!num || num <= 0) return res.status(400).json({ error: 'amount must be a positive number' });
  const when = paid_at && String(paid_at).trim() ? String(paid_at).trim() : null;
  db.prepare(
    `
    INSERT INTO supplier_payments (supplier_id, amount, paid_at, notes)
    VALUES (?, ?, COALESCE(?, datetime('now')), ?)
  `,
  ).run(req.params.id, num, when, notes || null);
  const payload = getSupplierDetailPayload(req.params.id);
  res.status(201).json(payload);
});

suppliersRouter.delete('/:id/payments/:paymentId', requireAdminPermission('can_record_supplier_payments'), (req, res) => {
  const sup = db.prepare('SELECT id FROM suppliers WHERE id = ?').get(req.params.id);
  if (!sup) return res.status(404).json({ error: 'Supplier not found' });
  const r = db
    .prepare('DELETE FROM supplier_payments WHERE id = ? AND supplier_id = ?')
    .run(req.params.paymentId, req.params.id);
  if (!r.changes) return res.status(404).json({ error: 'Payment not found' });
  res.status(204).send();
});

suppliersRouter.get('/:id', (req, res) => {
  const payload = getSupplierDetailPayload(req.params.id);
  if (!payload) return res.status(404).json({ error: 'Supplier not found' });
  res.json(payload);
});

suppliersRouter.patch('/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM suppliers WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Supplier not found' });
  const { name, email, phone, address, pin, notes } = req.body;
  const pinNext =
    pin === undefined
      ? row.pin
      : pin != null && String(pin).trim()
        ? String(pin).trim()
        : null;
  db.prepare(
    `
    UPDATE suppliers SET name = ?, email = ?, phone = ?, address = ?, pin = ?, notes = ?, updated_at = datetime('now')
    WHERE id = ?
  `,
  ).run(
    name !== undefined ? name : row.name,
    email !== undefined ? email : row.email,
    phone !== undefined ? phone : row.phone,
    address !== undefined ? address : row.address,
    pinNext,
    notes !== undefined ? notes : row.notes,
    req.params.id,
  );
  const updated = db.prepare('SELECT * FROM suppliers WHERE id = ?').get(req.params.id);
  res.json(updated);
});

suppliersRouter.delete('/:id', (req, res) => {
  const hasLpoDocs = db.prepare('SELECT 1 FROM lpos WHERE supplier_id = ? LIMIT 1').get(req.params.id);
  if (hasLpoDocs) {
    return res.status(400).json({ error: 'Cannot delete supplier with LPO documents. Delete or reassign those LPOs first.' });
  }
  const hasLegacyLpos = db
    .prepare(
      `SELECT 1 FROM invoice_items WHERE supplier_id = ? AND lpo_ref IS NOT NULL AND lpo_ref != '' LIMIT 1`,
    )
    .get(req.params.id);
  if (hasLegacyLpos) {
    return res.status(400).json({ error: 'Cannot delete supplier with legacy LPO-linked invoice lines.' });
  }
  const hasPay = db.prepare('SELECT 1 FROM supplier_payments WHERE supplier_id = ? LIMIT 1').get(req.params.id);
  if (hasPay) {
    return res.status(400).json({ error: 'Cannot delete supplier with payment history.' });
  }
  const hasStock = db.prepare('SELECT 1 FROM stock_items WHERE supplier_id = ? LIMIT 1').get(req.params.id);
  if (hasStock) {
    return res.status(400).json({ error: 'Cannot delete supplier linked to store items. Clear supplier on those items first.' });
  }
  const r = db.prepare('DELETE FROM suppliers WHERE id = ?').run(req.params.id);
  if (!r.changes) return res.status(404).json({ error: 'Supplier not found' });
  res.status(204).send();
});
