import { Router } from 'express';
import { db } from '../db.js';
import { SQL_LPO_LINE_GROSS } from '../lpoLineTotals.js';

const SQL_IPR_LINE_GROSS = SQL_LPO_LINE_GROSS.replace(/ll\./g, 'ilg.');

export const lpoIprRouter = Router();

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
    .all();

  const stockLpos = db
    .prepare(
      `
    SELECT
      l.id AS lpo_id,
      l.ref,
      l.notes,
      l.created_at,
      l.supplier_id,
      sup.name AS supplier_name,
      COALESCE(l.finalized, 0) AS finalized,
      (SELECT COALESCE(SUM(${SQL_LPO_LINE_GROSS}), 0) FROM lpo_lines ll WHERE ll.lpo_id = l.id) AS document_total
    FROM lpos l
    JOIN suppliers sup ON sup.id = l.supplier_id
    WHERE l.invoice_id IS NULL
    ORDER BY l.id DESC
  `,
    )
    .all();

  const iprs = db
    .prepare(
      `
    SELECT
      ip.id AS ipr_id,
      ip.ref,
      ip.notes,
      COALESCE(ip.approved, 0) AS approved,
      ip.finalized,
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
    .all();

  res.json({ lpos: lpoRows, stock_lpos: stockLpos, iprs });
});
