import { Router } from 'express';
import { db } from '../db.js';
import { SQL_LPO_LINE_GROSS, lpoLineNet, lpoLineVat, lpoLineGross } from '../lpoLineTotals.js';

const SQL_IPR_LINE_GROSS = SQL_LPO_LINE_GROSS.replace(/ll\./g, 'ilg.');

export const lpoIprRouter = Router();

function withLineTotals(ln) {
  return {
    ...ln,
    line_net: lpoLineNet(ln),
    line_vat: lpoLineVat(ln),
    line_gross: lpoLineGross(ln),
  };
}

function getSummaryLpoLines(lpoId, { stockIntake }) {
  if (stockIntake) {
    return db
      .prepare(
        `
      SELECT ll.id AS line_id, ll.stock_item_id, ll.quantity, ll.unit_cost, ll.vat_rate, ll.vat_exempt, ll.description,
        si.code AS stock_code, si.name AS stock_name
      FROM lpo_lines ll
      LEFT JOIN stock_items si ON si.id = ll.stock_item_id
      WHERE ll.lpo_id = ?
      ORDER BY ll.id
    `,
      )
      .all(lpoId)
      .map(withLineTotals);
  }

  return db
    .prepare(
      `
    SELECT ll.id AS line_id, ll.quantity, ll.unit_cost, ll.vat_rate, ll.vat_exempt, ll.description,
      ii.description AS invoice_line_description,
      si.code AS stock_code, si.name AS stock_name
    FROM lpo_lines ll
    LEFT JOIN invoice_items ii ON ii.id = ll.invoice_item_id
    LEFT JOIN stock_items si ON si.id = ll.stock_item_id
    WHERE ll.lpo_id = ?
    ORDER BY ll.id
  `,
    )
    .all(lpoId)
    .map(withLineTotals);
}

function getSummaryIprLines(iprId) {
  return db
    .prepare(
      `
    SELECT il.id AS line_id, il.quantity, il.unit_cost, il.vat_rate, il.vat_exempt, il.description,
      ii.description AS invoice_line_description,
      si.code AS stock_code, si.name AS stock_name
    FROM ipr_lines il
    LEFT JOIN invoice_items ii ON ii.id = il.invoice_item_id
    LEFT JOIN stock_items si ON si.id = il.stock_item_id
    WHERE il.ipr_id = ?
    ORDER BY il.id
  `,
    )
    .all(iprId)
    .map(withLineTotals);
}

/** Summary of issued LPO documents and IPRs. */
lpoIprRouter.get('/summary', (req, res) => {
  const lpoRows = db
    .prepare(
      `
    SELECT
      l.id AS lpo_id,
      l.ref,
      l.notes,
      l.created_at,
      l.supplier_id,
      COALESCE(l.approved, 0) AS approved,
      COALESCE(l.finalized, 0) AS finalized,
      sup.name AS supplier_name,
      l.invoice_id,
      i.invoice_number,
      i.job_id,
      j.job_number AS job_number,
      c.name AS customer_name,
      (SELECT COALESCE(SUM(${SQL_LPO_LINE_GROSS}), 0) FROM lpo_lines ll WHERE ll.lpo_id = l.id) AS document_total
    FROM lpos l
    JOIN invoices i ON i.id = l.invoice_id AND i.type = 'invoice'
    LEFT JOIN suppliers sup ON sup.id = l.supplier_id
    LEFT JOIN customers c ON c.id = i.customer_id
    LEFT JOIN jobs j ON j.id = i.job_id
    ORDER BY l.id DESC
  `,
    )
    .all()
    .map((row) => {
      const pending = Number(row.approved) !== 1 && Number(row.finalized) !== 1;
      return {
        ...row,
        kind: 'invoice',
        lines: pending ? getSummaryLpoLines(row.lpo_id, { stockIntake: false }) : undefined,
      };
    });

  const stockLpos = db
    .prepare(
      `
    SELECT
      l.id AS lpo_id,
      l.ref,
      l.notes,
      l.created_at,
      l.supplier_id,
      COALESCE(l.approved, 0) AS approved,
      COALESCE(l.finalized, 0) AS finalized,
      sup.name AS supplier_name,
      (SELECT COALESCE(SUM(${SQL_LPO_LINE_GROSS}), 0) FROM lpo_lines ll WHERE ll.lpo_id = l.id) AS document_total
    FROM lpos l
    JOIN suppliers sup ON sup.id = l.supplier_id
    WHERE l.invoice_id IS NULL
    ORDER BY l.id DESC
  `,
    )
    .all()
    .map((row) => {
      const pending = Number(row.approved) !== 1 && Number(row.finalized) !== 1;
      return {
        ...row,
        kind: 'stock',
        lines: pending ? getSummaryLpoLines(row.lpo_id, { stockIntake: true }) : undefined,
      };
    });

  const iprs = db
    .prepare(
      `
    SELECT
      ip.id AS ipr_id,
      ip.ref,
      ip.notes,
      COALESCE(ip.approved, 0) AS approved,
      COALESCE(ip.finalized, 0) AS finalized,
      ip.created_at,
      i.id AS invoice_id,
      i.invoice_number,
      i.job_id,
      j.job_number AS job_number,
      c.name AS customer_name,
      (SELECT COUNT(*) FROM ipr_lines ilc WHERE ilc.ipr_id = ip.id) AS line_count,
      (SELECT COALESCE(SUM(${SQL_IPR_LINE_GROSS}), 0) FROM ipr_lines ilg WHERE ilg.ipr_id = ip.id) AS document_total
    FROM iprs ip
    JOIN invoices i ON i.id = ip.invoice_id AND i.type = 'invoice'
    LEFT JOIN customers c ON c.id = i.customer_id
    LEFT JOIN jobs j ON j.id = i.job_id
    ORDER BY ip.id DESC
  `,
    )
    .all()
    .map((row) => {
      const pending = Number(row.approved) !== 1 && Number(row.finalized) !== 1;
      return {
        ...row,
        lines: pending ? getSummaryIprLines(row.ipr_id) : undefined,
      };
    });

  res.json({ lpos: lpoRows, stock_lpos: stockLpos, iprs });
});
