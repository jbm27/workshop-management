import { Router } from 'express';
import PDFDocument from 'pdfkit';
import { db, transactionSync } from '../db.js';
import { config } from '../config.js';
import { nextSequenceRef } from '../sequences.js';
import { normalizeLpoLineVat, lpoLineNet, lpoLineVat, lpoLineGross, SQL_LPO_LINE_GROSS } from '../lpoLineTotals.js';
import { drawStockStoreLpoHeader, kshFormat } from '../workshopPdf.js';
import { requireAdminAuth, requireAdminPermission } from '../auth.js';

export const stockRouter = Router();

function stockLpoReceiptProgress(lpoId) {
  const row = db
    .prepare(
      `SELECT COUNT(*) AS total, COALESCE(SUM(CASE WHEN COALESCE(received_confirmed,0)=1 THEN 1 ELSE 0 END), 0) AS done
       FROM lpo_lines WHERE lpo_id = ?`,
    )
    .get(lpoId);
  const total = Number(row?.total || 0);
  const done = Number(row?.done || 0);
  return { total, done, allReceived: total > 0 && done >= total };
}

const dupCheckStmt = db.prepare(
  `SELECT id FROM stock_items WHERE TRIM(LOWER(IFNULL(code,''))) = TRIM(LOWER(?)) AND IFNULL(TRIM(code),'') != ''`,
);

/**
 * @param {unknown[]} rawLines
 * @param {Set<number>|null} relaxDupStockIds — when re-saving an LPO, duplicate codes map to this stock row
 * @returns {{ normalized: object[] } | { error: string }}
 */
function normalizeStockIntakeLines(rawLines, relaxDupStockIds) {
  if (!Array.isArray(rawLines) || rawLines.length === 0) {
    return { error: 'At least one line is required (send a non-empty lines array)' };
  }
  const normalized = [];
  const seenCodes = new Set();
  for (let i = 0; i < rawLines.length; i++) {
    const ln = rawLines[i] || {};
    const qty = Number(ln.quantity);
    const uc = Number(ln.unit_cost);
    if (!Number.isFinite(qty) || qty <= 0) {
      return { error: `Line ${i + 1}: quantity must be positive` };
    }
    if (!Number.isFinite(uc) || uc < 0) {
      return { error: `Line ${i + 1}: unit_cost must be a valid non-negative number` };
    }
    const { vat_rate: vr, vat_exempt: ve } = normalizeLpoLineVat(ln);
    if (ve !== 1 && vr > 100) {
      return { error: `Line ${i + 1}: vat_rate cannot exceed 100` };
    }
    const sp =
      ln.sell_price != null && ln.sell_price !== '' && Number.isFinite(Number(ln.sell_price))
        ? Number(ln.sell_price)
        : null;

    const existingId =
      ln.stock_item_id != null && ln.stock_item_id !== '' ? Number(ln.stock_item_id) : Number.NaN;
    if (Number.isFinite(existingId) && existingId > 0) {
      const row = db.prepare('SELECT id, name FROM stock_items WHERE id = ?').get(existingId);
      if (!row) {
        return { error: `Line ${i + 1}: stock item not found` };
      }
      normalized.push({
        existing: true,
        stock_id: existingId,
        lineName: row.name,
        quantity: qty,
        unit_cost: uc,
        vat_rate: vr,
        vat_exempt: ve,
      });
      continue;
    }

    const code = String(ln.stock_code || '').trim();
    const nam = String(ln.name || '').trim();
    if (!code) {
      return { error: `Line ${i + 1}: stock_code is required (or select an existing item)` };
    }
    if (!nam) {
      return { error: `Line ${i + 1}: name is required` };
    }
    const key = code.toLowerCase();
    if (seenCodes.has(key)) {
      return { error: `Duplicate stock code in this LPO: ${code}` };
    }
    seenCodes.add(key);

    const dupRow = dupCheckStmt.get(code);
    if (dupRow) {
      if (relaxDupStockIds && relaxDupStockIds.has(dupRow.id)) {
        const row = db.prepare('SELECT id, name FROM stock_items WHERE id = ?').get(dupRow.id);
        normalized.push({
          existing: true,
          stock_id: row.id,
          lineName: row.name,
          quantity: qty,
          unit_cost: uc,
          vat_rate: vr,
          vat_exempt: ve,
        });
        continue;
      }
      return {
        error: `A store item with code "${code}" already exists — add more quantity via "Existing item"`,
      };
    }
    normalized.push({
      existing: false,
      code,
      name: nam,
      description: null,
      quantity: qty,
      unit: 'each',
      unit_cost: uc,
      sell_price: sp,
      vat_rate: vr,
      vat_exempt: ve,
    });
  }
  return { normalized };
}

function applyStockIntakeLines(lpoId, supplierId, normalized) {
  const insStock = db.prepare(`
    INSERT INTO stock_items (code, name, description, quantity, unit, supplier_id, cost_price, sell_price)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insLine = db.prepare(
    `INSERT INTO lpo_lines (lpo_id, invoice_item_id, stock_item_id, description, quantity, unit_cost, vat_rate, vat_exempt) VALUES (?, NULL, ?, ?, ?, ?, ?, ?)`,
  );

  const created = [];
  for (const row of normalized) {
    if (row.existing) {
      insLine.run(lpoId, row.stock_id, row.lineName, row.quantity, row.unit_cost, row.vat_rate, row.vat_exempt);
      created.push(db.prepare('SELECT id, code, name, quantity FROM stock_items WHERE id = ?').get(row.stock_id));
    } else {
      const stockR = insStock.run(
        row.code,
        row.name,
        row.description,
        0,
        row.unit,
        supplierId,
        row.unit_cost,
        row.sell_price != null ? row.sell_price : 0,
      );
      const stockId = stockR.lastInsertRowid;
      insLine.run(lpoId, stockId, row.name, row.quantity, row.unit_cost, row.vat_rate, row.vat_exempt);
      created.push(db.prepare('SELECT id, code, name, quantity FROM stock_items WHERE id = ?').get(stockId));
    }
  }
  return created;
}

function applyStockIntakeLinesTx(tx, lpoId, supplierId, normalized) {
  for (const row of normalized) {
    if (row.existing) {
      tx.run(
        `INSERT INTO lpo_lines (lpo_id, invoice_item_id, stock_item_id, description, quantity, unit_cost, vat_rate, vat_exempt) VALUES (?, NULL, ?, ?, ?, ?, ?, ?)`,
        [lpoId, row.stock_id, row.lineName, row.quantity, row.unit_cost, row.vat_rate, row.vat_exempt],
      );
    } else {
      tx.run(
        `INSERT INTO stock_items (code, name, description, quantity, unit, supplier_id, cost_price, sell_price) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          row.code,
          row.name,
          row.description,
          0,
          row.unit,
          supplierId,
          row.unit_cost,
          row.sell_price != null ? row.sell_price : 0,
        ],
      );
      const stockId = tx.lastInsertRowid();
      tx.run(
        `INSERT INTO lpo_lines (lpo_id, invoice_item_id, stock_item_id, description, quantity, unit_cost, vat_rate, vat_exempt) VALUES (?, NULL, ?, ?, ?, ?, ?, ?)`,
        [lpoId, stockId, row.name, row.quantity, row.unit_cost, row.vat_rate, row.vat_exempt],
      );
    }
  }
}

function getStockIntakeLpoDetail(lpoId) {
  const lpo = db
    .prepare(
      `
    SELECT l.*, s.name AS supplier_name,
      appr.display_name AS approved_by_display_name
    FROM lpos l
    JOIN suppliers s ON s.id = l.supplier_id
    LEFT JOIN admin_users appr ON appr.id = l.approved_by_admin_user_id
    WHERE l.id = ? AND l.invoice_id IS NULL
  `,
    )
    .get(lpoId);
  if (!lpo) return null;
  const lines = db
    .prepare(
      `
    SELECT ll.id AS line_id, ll.stock_item_id, ll.quantity, ll.unit_cost, ll.vat_rate, ll.vat_exempt, ll.description,
      ll.assigned_admin_user_id, ll.received_confirmed, ll.received_confirmed_at,
      si.code AS stock_code, si.name AS stock_name,
      au.display_name AS assigned_admin_name,
      ru.display_name AS received_by_admin_name
    FROM lpo_lines ll
    LEFT JOIN stock_items si ON si.id = ll.stock_item_id
    LEFT JOIN admin_users au ON au.id = ll.assigned_admin_user_id
    LEFT JOIN admin_users ru ON ru.id = ll.received_confirmed_by_admin_user_id
    WHERE ll.lpo_id = ?
    ORDER BY ll.id
  `,
    )
    .all(lpoId);
  return { lpo, lines };
}

function listStockIntakeLpos() {
  return db
    .prepare(
      `
    SELECT l.id AS lpo_id, l.ref, l.created_at, l.supplier_id, s.name AS supplier_name,
      COALESCE(l.approved, 0) AS approved,
      (SELECT COALESCE(SUM(${SQL_LPO_LINE_GROSS}), 0) FROM lpo_lines ll WHERE ll.lpo_id = l.id) AS document_total
    FROM lpos l
    JOIN suppliers s ON s.id = l.supplier_id
    WHERE l.invoice_id IS NULL AND COALESCE(l.finalized, 0) = 0
    ORDER BY l.id DESC
  `,
    )
    .all();
}

stockRouter.post('/receive-lpo', requireAdminPermission('can_create_lpos'), (req, res) => {
  const { supplier_id, notes } = req.body;
  let rawLines = req.body.lines;

  if (!Array.isArray(rawLines) || rawLines.length === 0) {
    const { stock_item_id, stock_code, name, quantity, unit_cost, sell_price } = req.body;
    if (stock_item_id != null && stock_item_id !== '') {
      rawLines = [
        {
          stock_item_id,
          quantity,
          unit_cost,
          sell_price,
          vat_rate: req.body.vat_rate,
          vat_exempt: req.body.vat_exempt,
        },
      ];
    } else if (stock_code != null && String(stock_code).trim() && name != null && String(name).trim()) {
      rawLines = [
        {
          stock_code,
          name,
          quantity,
          unit_cost,
          sell_price,
          vat_rate: req.body.vat_rate,
          vat_exempt: req.body.vat_exempt,
        },
      ];
    } else {
      return res.status(400).json({ error: 'At least one line is required (send a non-empty lines array)' });
    }
  }

  const sup = db.prepare('SELECT id FROM suppliers WHERE id = ?').get(supplier_id);
  if (!sup) return res.status(404).json({ error: 'Supplier not found' });

  const norm = normalizeStockIntakeLines(rawLines, null);
  if (norm.error) return res.status(400).json({ error: norm.error });

  const ref = nextSequenceRef('lpo', 'LPO');
  const insLpo = db.prepare(`INSERT INTO lpos (invoice_id, supplier_id, ref, notes) VALUES (NULL, ?, ?, ?)`);
  const lpoR = insLpo.run(supplier_id, ref, notes != null ? String(notes).trim() || null : null);
  const lpoId = lpoR.lastInsertRowid;

  const created = applyStockIntakeLines(lpoId, supplier_id, norm.normalized);

  res.status(201).json({
    lpo_id: lpoId,
    ref,
    line_count: created.length,
    items: created,
  });
});

stockRouter.get('/lpos', (req, res) => {
  res.json(listStockIntakeLpos());
});

stockRouter.get('/lpos/:lpoId', (req, res) => {
  const detail = getStockIntakeLpoDetail(req.params.lpoId);
  if (!detail) return res.status(404).json({ error: 'Stock intake LPO not found' });
  res.json(detail);
});

stockRouter.patch('/lpos/:lpoId', requireAdminPermission('can_create_lpos'), (req, res) => {
  const lpo = db.prepare('SELECT * FROM lpos WHERE id = ? AND invoice_id IS NULL').get(req.params.lpoId);
  if (!lpo) return res.status(404).json({ error: 'Stock intake LPO not found' });
  if (Number(lpo.finalized) === 1) {
    return res.status(403).json({ error: 'This LPO is finalised and cannot be edited.' });
  }

  const { supplier_id, notes, lines: rawLines } = req.body;

  if (rawLines !== undefined) {
    if (!Array.isArray(rawLines) || rawLines.length === 0) {
      return res.status(400).json({ error: 'When updating lines, send a non-empty lines array' });
    }
    const oldLines = db.prepare('SELECT * FROM lpo_lines WHERE lpo_id = ?').all(lpo.id);
    const relaxIds = new Set(oldLines.map((l) => l.stock_item_id).filter(Boolean));
    const norm = normalizeStockIntakeLines(rawLines, relaxIds);
    if (norm.error) return res.status(400).json({ error: norm.error });

    const newSupplier = supplier_id != null ? Number(supplier_id) : lpo.supplier_id;
    const sup = db.prepare('SELECT id FROM suppliers WHERE id = ?').get(newSupplier);
    if (!sup) return res.status(404).json({ error: 'Supplier not found' });
    const notesVal =
      notes !== undefined ? (notes != null ? String(notes).trim() || null : null) : lpo.notes;

    try {
      transactionSync((tx) => {
        for (const ln of oldLines) {
          if (!ln.stock_item_id) continue;
          const q = Number(ln.quantity) || 0;
          if (Number(ln.received_confirmed) === 1) {
            const u = tx.run(
              'UPDATE stock_items SET quantity = quantity - ? WHERE id = ? AND quantity >= ?',
              [q, ln.stock_item_id, q],
            );
            if (!u.changes) {
              throw new Error('REVERSE_STOCK');
            }
          } else {
            const cnt = tx.get('SELECT COUNT(*) AS c FROM lpo_lines WHERE stock_item_id = ?', [ln.stock_item_id]);
            const st = tx.get('SELECT quantity FROM stock_items WHERE id = ?', [ln.stock_item_id]);
            if (Number(st?.quantity) === 0 && Number(cnt?.c) <= 1) {
              tx.run('DELETE FROM stock_items WHERE id = ?', [ln.stock_item_id]);
            }
          }
        }
        tx.run('DELETE FROM lpo_lines WHERE lpo_id = ?', [lpo.id]);
        tx.run('UPDATE lpos SET supplier_id = ?, notes = ?, approved = 0, approved_at = NULL, approved_by_admin_user_id = NULL, updated_at = datetime(\'now\') WHERE id = ?', [
          newSupplier,
          notesVal,
          lpo.id,
        ]);
        applyStockIntakeLinesTx(tx, lpo.id, newSupplier, norm.normalized);
      });
    } catch (e) {
      if (e.message === 'REVERSE_STOCK') {
        return res.status(400).json({
          error:
            'Not enough stock on hand to apply changes (items may have been issued via IPR).',
        });
      }
      throw e;
    }
    const detail = getStockIntakeLpoDetail(lpo.id);
    return res.json(detail);
  }

  if (supplier_id == null && notes === undefined) {
    return res.status(400).json({ error: 'Nothing to update' });
  }
  if (supplier_id != null) {
    const sup = db.prepare('SELECT id FROM suppliers WHERE id = ?').get(supplier_id);
    if (!sup) return res.status(404).json({ error: 'Supplier not found' });
    db.prepare(`UPDATE lpos SET supplier_id = ?, updated_at = datetime('now') WHERE id = ?`).run(
      supplier_id,
      lpo.id,
    );
  }
  if (notes !== undefined) {
    db.prepare(`UPDATE lpos SET notes = ?, updated_at = datetime('now') WHERE id = ?`).run(
      notes != null ? String(notes).trim() || null : null,
      lpo.id,
    );
  }
  const detail = getStockIntakeLpoDetail(lpo.id);
  res.json(detail);
});

stockRouter.post('/lpos/:lpoId/approve', requireAdminPermission('can_approve_lpo_ipr'), (req, res) => {
  const lpo = db.prepare('SELECT * FROM lpos WHERE id = ? AND invoice_id IS NULL').get(req.params.lpoId);
  if (!lpo) return res.status(404).json({ error: 'Stock intake LPO not found' });
  if (Number(lpo.finalized) === 1) return res.status(400).json({ error: 'Already finalised' });
  db.prepare(
    `UPDATE lpos SET approved = 1, approved_at = datetime('now'), approved_by_admin_user_id = ?, updated_at = datetime('now') WHERE id = ?`,
  ).run(req.admin.id, lpo.id);
  const detail = getStockIntakeLpoDetail(lpo.id);
  res.json(detail);
});

stockRouter.patch('/lpos/:lpoId/lines/:lineId/receipt', requireAdminAuth, (req, res) => {
  const lpo = db.prepare('SELECT * FROM lpos WHERE id = ? AND invoice_id IS NULL').get(req.params.lpoId);
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

  const wasRecv = Number(line.received_confirmed) === 1;
  if (received === 1 && !wasRecv) {
    const q = Number(line.quantity) || 0;
    if (!line.stock_item_id) return res.status(400).json({ error: 'Line has no stock item' });
    db.prepare(
      `UPDATE stock_items SET quantity = quantity + ?, cost_price = ?, supplier_id = ?, updated_at = datetime('now') WHERE id = ?`,
    ).run(q, Number(line.unit_cost) || 0, lpo.supplier_id, line.stock_item_id);
  }
  if (received === 0 && wasRecv) {
    const q = Number(line.quantity) || 0;
    const u = db
      .prepare('UPDATE stock_items SET quantity = quantity - ? WHERE id = ? AND quantity >= ?')
      .run(q, line.stock_item_id, q);
    if (!u.changes) return res.status(400).json({ error: 'Cannot undo receipt: insufficient stock on hand' });
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
  res.json(getStockIntakeLpoDetail(lpo.id));
});

stockRouter.post('/lpos/:lpoId/finalize', requireAdminPermission('can_finalize_lpos'), (req, res) => {
  const lpo = db.prepare('SELECT * FROM lpos WHERE id = ? AND invoice_id IS NULL').get(req.params.lpoId);
  if (!lpo) return res.status(404).json({ error: 'Stock intake LPO not found' });
  if (Number(lpo.finalized) === 1) {
    return res.status(400).json({ error: 'LPO is already finalised' });
  }
  if (Number(lpo.approved) !== 1) {
    return res.status(400).json({ error: 'LPO must be approved before finalisation' });
  }
  const progress = stockLpoReceiptProgress(lpo.id);
  if (!progress.allReceived) {
    return res.status(400).json({ error: 'All LPO lines must be marked received before finalisation' });
  }
  const cnt = db.prepare('SELECT COUNT(*) AS c FROM lpo_lines WHERE lpo_id = ?').get(lpo.id);
  if (!cnt || !Number(cnt.c)) {
    return res.status(400).json({ error: 'Cannot finalise an LPO with no lines' });
  }
  db.prepare(`UPDATE lpos SET finalized = 1, updated_at = datetime('now') WHERE id = ?`).run(lpo.id);
  const detail = getStockIntakeLpoDetail(lpo.id);
  res.json(detail);
});

stockRouter.get('/lpos/:lpoId/pdf', (req, res) => {
  const lpo = db
    .prepare(
      `
    SELECT l.*, s.name AS supplier_name, s.address AS supplier_address, s.phone AS supplier_phone, s.email AS supplier_email, s.pin AS supplier_pin,
      appr.display_name AS approved_by_display_name
    FROM lpos l
    JOIN suppliers s ON s.id = l.supplier_id
    LEFT JOIN admin_users appr ON appr.id = l.approved_by_admin_user_id
    WHERE l.id = ? AND l.invoice_id IS NULL
  `,
    )
    .get(req.params.lpoId);
  if (!lpo) return res.status(404).json({ error: 'Stock intake LPO not found' });
  if (Number(lpo.approved) !== 1) return res.status(400).json({ error: 'LPO must be approved before printing' });

  const lines = db
    .prepare(
      `
    SELECT ll.*, si.code AS stock_code, si.name AS stock_name,
      rbu.display_name AS received_by_display_name,
      CASE
        WHEN IFNULL(si.code, '') != '' THEN TRIM(si.code || ' — ' || COALESCE(si.name, ''))
        ELSE COALESCE(si.name, ll.description)
      END AS invoice_line_description
    FROM lpo_lines ll
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
  const { margin, contentWidth, yContent } = drawStockStoreLpoHeader(doc, company, {
    docBoxTitle: 'LOCAL PURCHASE ORDER',
    docBoxNumber: lpo.ref,
    dateLabel: 'LPO date',
    dateValue: dateStr,
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
  doc.fontSize(8).font('Helvetica-Bold');
  doc.text('Purchase item', margin, tableTop, { width: colDesc });
  doc.text('Stock item', xInv, tableTop, { width: colInvLine });
  doc.text('Qty', xQty, tableTop, { width: colQty, align: 'right' });
  doc.text('Unit (ex VAT)', xUnit, tableTop, { width: colUnit, align: 'right' });
  doc.text('VAT', xVatP, tableTop, { width: colVatP, align: 'right' });
  doc.text('VAT amt', xVatAmt, tableTop, { width: colVatAmt, align: 'right' });
  doc.text('Line total', xGross, tableTop, { width: colGross, align: 'right' });
  doc.moveTo(margin, tableTop + 14).lineTo(margin + contentWidth, tableTop + 14).stroke();

  y = tableTop + 20;
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
    const rowH = Math.max(
      18,
      Math.max(doc.heightOfString(desc, { width: colDesc }), doc.heightOfString(invLine, { width: colInvLine })) + 4,
    );
    doc.text(desc, margin, y, { width: colDesc });
    doc.text(invLine, xInv, y, { width: colInvLine });
    doc.text(qty.toFixed(2), xQty, y, { width: colQty, align: 'right' });
    doc.text(kshFormat(uc), xUnit, y, { width: colUnit, align: 'right' });
    doc.text(vatLabel, xVatP, y, { width: colVatP, align: 'right' });
    doc.text(vatAmt > 0 ? kshFormat(vatAmt) : '—', xVatAmt, y, { width: colVatAmt, align: 'right' });
    doc.text(kshFormat(gross), xGross, y, { width: colGross, align: 'right' });
    y += rowH;
  }

  const totGross = Math.round((sumNet + sumVat) * 100) / 100;
  y += 10;
  const sumX = xUnit;
  const sumW = colUnit + colVatP + colVatAmt + colGross;
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
  doc.fillColor('#555555');
  doc.text(
    Number(lpo.finalized) === 1
      ? 'Unit costs and subtotal exclude VAT. Finalised: store quantities were increased when each line was marked received.'
      : 'Unit costs and subtotal exclude VAT. Draft: quantities increase when each line is marked received after approval.',
    margin,
    y,
    { width: contentWidth },
  );
  doc.end();
});

stockRouter.delete('/lpos/:lpoId', requireAdminPermission('can_create_lpos'), (req, res) => {
  const lpo = db.prepare('SELECT id, finalized FROM lpos WHERE id = ? AND invoice_id IS NULL').get(req.params.lpoId);
  if (!lpo) return res.status(404).json({ error: 'Stock intake LPO not found' });
  if (Number(lpo.finalized) === 1) {
    return res.status(403).json({ error: 'Cannot delete a finalised LPO.' });
  }
  const lines = db.prepare('SELECT * FROM lpo_lines WHERE lpo_id = ?').all(req.params.lpoId);
  for (const ln of lines) {
    if (!ln.stock_item_id) continue;
    const q = Number(ln.quantity) || 0;
    if (Number(ln.received_confirmed) === 1) {
      const u = db
        .prepare('UPDATE stock_items SET quantity = quantity - ? WHERE id = ? AND quantity >= ?')
        .run(q, ln.stock_item_id, q);
      if (!u.changes) {
        return res.status(400).json({
          error:
            'Cannot delete: not enough stock on hand to reverse this receipt (items may have been issued via IPR).',
        });
      }
    } else {
      const cnt = db.prepare('SELECT COUNT(*) AS c FROM lpo_lines WHERE stock_item_id = ?').get(ln.stock_item_id);
      const st = db.prepare('SELECT quantity FROM stock_items WHERE id = ?').get(ln.stock_item_id);
      if (Number(st?.quantity) === 0 && Number(cnt?.c) <= 1) {
        db.prepare('DELETE FROM stock_items WHERE id = ?').run(ln.stock_item_id);
      }
    }
  }
  db.prepare('DELETE FROM lpos WHERE id = ?').run(req.params.lpoId);
  res.status(204).send();
});

stockRouter.get('/', (req, res) => {
  const q = (req.query.q || '').trim();
  const safe = q.replace(/[%_\\]/g, '').trim();
  let rows;
  if (safe) {
    const like = `%${safe}%`;
    rows = db
      .prepare(
        `
      SELECT id, code, name, quantity, unit, cost_price, sell_price
      FROM stock_items
      WHERE name LIKE ? OR IFNULL(code, '') LIKE ?
      ORDER BY name
    `,
      )
      .all(like, like);
  } else {
    rows = db
      .prepare('SELECT id, code, name, quantity, unit, cost_price, sell_price FROM stock_items ORDER BY name')
      .all();
  }
  res.json(rows);
});

stockRouter.get('/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM stock_items WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Stock item not found' });
  res.json(row);
});

stockRouter.post('/', (req, res) => {
  return res.status(400).json({
    error: 'Use POST /api/stock/receive-lpo to add store items with a supplier LPO and stock code.',
  });
});

stockRouter.patch('/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM stock_items WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Stock item not found' });
  const { code, name, description, quantity, unit, sell_price } = req.body;
  let sellOut = row.sell_price;
  if (sell_price !== undefined) {
    const n = Number(sell_price);
    if (!Number.isFinite(n) || n < 0) {
      return res.status(400).json({ error: 'sell_price must be a valid non-negative number' });
    }
    sellOut = n;
  }
  db.prepare(
    `
    UPDATE stock_items SET code = ?, name = ?, description = ?, quantity = ?, unit = ?, sell_price = ?, updated_at = datetime('now')
    WHERE id = ?
  `,
  ).run(
    code !== undefined ? code : row.code,
    name !== undefined ? name : row.name,
    description !== undefined ? description : row.description,
    quantity !== undefined ? quantity : row.quantity,
    unit !== undefined ? unit : row.unit,
    sellOut,
    req.params.id,
  );
  res.json(db.prepare('SELECT * FROM stock_items WHERE id = ?').get(req.params.id));
});

stockRouter.delete('/:id', (req, res) => {
  const ref = db.prepare('SELECT 1 FROM lpo_lines WHERE stock_item_id = ? LIMIT 1').get(req.params.id);
  if (ref) {
    return res.status(400).json({
      error: 'Cannot delete: this item is linked to a stock intake LPO. Delete that LPO from Stores first if appropriate.',
    });
  }
  const r = db.prepare('DELETE FROM stock_items WHERE id = ?').run(req.params.id);
  if (!r.changes) return res.status(404).json({ error: 'Stock item not found' });
  res.status(204).send();
});
