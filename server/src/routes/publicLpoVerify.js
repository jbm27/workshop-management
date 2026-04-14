import { Router } from 'express';
import { db } from '../db.js';
import { config } from '../config.js';
import { lpoLineGross, lpoLineNet, lpoLineVat } from '../lpoLineTotals.js';

export const publicLpoVerifyRouter = Router();

function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function kes(n) {
  const x = Math.round(Number(n) || 0);
  return `KES ${x.toLocaleString('en-KE', { maximumFractionDigits: 0 })}`;
}

const lineSql = `
  SELECT ll.*, ii.description AS ii_desc, si.code AS stock_code, si.name AS stock_name,
    CASE
      WHEN ii.id IS NOT NULL THEN ii.description
      WHEN IFNULL(si.code, '') != '' THEN TRIM(si.code || ' — ' || COALESCE(si.name, ''))
      ELSE COALESCE(si.name, ll.description)
    END AS invoice_line_description
  FROM lpo_lines ll
  LEFT JOIN invoice_items ii ON ii.id = ll.invoice_item_id
  LEFT JOIN stock_items si ON si.id = ll.stock_item_id
  WHERE ll.lpo_id = ?
  ORDER BY ll.id
`;

publicLpoVerifyRouter.get('/:token', (req, res) => {
  const token = String(req.params.token || '').trim();
  if (!token || token.length > 96) {
    res.status(400).type('html').send(page('Invalid link', '<p>This verification link is not valid.</p>'));
    return;
  }

  const lpo = db
    .prepare(
      `
    SELECT l.*, s.name AS supplier_name, s.address AS supplier_address, s.phone AS supplier_phone, s.email AS supplier_email,
      i.invoice_number, i.type AS invoice_type,
      c.name AS customer_name,
      j.job_number
    FROM lpos l
    JOIN suppliers s ON s.id = l.supplier_id
    LEFT JOIN invoices i ON i.id = l.invoice_id
    LEFT JOIN customers c ON c.id = i.customer_id
    LEFT JOIN jobs j ON j.id = i.job_id
    WHERE l.public_verify_token = ?
  `,
    )
    .get(token);

  if (!lpo) {
    res.status(404).type('html').send(page('Unknown order', '<p>No matching purchase order was found for this link.</p>'));
    return;
  }

  const lines = db.prepare(lineSql).all(lpo.id);
  let sumNet = 0;
  let sumVat = 0;
  const lineRows = lines.map((ln) => {
    const net = lpoLineNet(ln);
    const vat = lpoLineVat(ln);
    const gross = lpoLineGross(ln);
    sumNet += net;
    sumVat += vat;
    const vatLabel =
      Number(ln.vat_exempt) === 1 ? 'Exempt' : Number(ln.vat_rate) > 0 ? `${Number(ln.vat_rate)}%` : '—';
    return `
      <tr>
        <td>${escapeHtml(ln.description || '—')}</td>
        <td>${escapeHtml(ln.invoice_line_description || '—')}</td>
        <td style="text-align:right">${(Number(ln.quantity) || 0).toLocaleString(undefined, { maximumFractionDigits: 3 })}</td>
        <td style="text-align:right">${kes(Number(ln.unit_cost) || 0)}</td>
        <td style="text-align:center">${escapeHtml(vatLabel)}</td>
        <td style="text-align:right">${kes(vat)}</td>
        <td style="text-align:right">${kes(gross)}</td>
      </tr>`;
  });

  const totGross = Math.round((sumNet + sumVat) * 100) / 100;
  const approved = Number(lpo.approved) === 1;
  const finalized = Number(lpo.finalized) === 1;
  const scope =
    lpo.invoice_id == null
      ? 'Stock intake (workshop stores)'
      : `${escapeHtml(lpo.invoice_number || 'Invoice')} · ${escapeHtml(lpo.customer_name || 'Customer')}${
          lpo.job_number ? ` · Job ${escapeHtml(lpo.job_number)}` : ''
        }`;

  const body = `
    <div class="banner ok">
      <strong>Verified with ${escapeHtml(config.company?.name || 'the workshop')}</strong>
      <p style="margin:0.35rem 0 0;font-size:0.95rem">This page confirms that the purchase order below is registered in our system. If printed details do not match, do not release parts — contact the workshop.</p>
    </div>
    <dl class="meta">
      <dt>LPO reference</dt><dd><strong>${escapeHtml(lpo.ref)}</strong></dd>
      <dt>Supplier</dt><dd>${escapeHtml(lpo.supplier_name || '—')}</dd>
      <dt>Created</dt><dd>${escapeHtml(new Date(lpo.created_at || Date.now()).toLocaleString('en-GB'))}</dd>
      <dt>Linked to</dt><dd>${scope}</dd>
      <dt>Approval</dt><dd>${approved ? '<span class="yes">Approved</span>' : '<span class="no">Not approved</span>'}</dd>
      <dt>Status</dt><dd>${finalized ? '<span class="yes">Finalised</span>' : 'Draft / open'}</dd>
    </dl>
    <h2>Line items</h2>
    <div style="overflow-x:auto">
      <table>
        <thead>
          <tr>
            <th>Purchase item</th>
            <th>Invoice line / stock</th>
            <th style="text-align:right">Qty</th>
            <th style="text-align:right">Unit (ex VAT)</th>
            <th>VAT</th>
            <th style="text-align:right">VAT amt</th>
            <th style="text-align:right">Line total</th>
          </tr>
        </thead>
        <tbody>
          ${lineRows.length ? lineRows.join('') : '<tr><td colspan="7">No lines on this LPO.</td></tr>'}
        </tbody>
        <tfoot>
          <tr>
            <td colspan="5" style="text-align:right;font-weight:600">Totals (inc VAT on lines)</td>
            <td style="text-align:right;font-weight:600">${kes(sumVat)}</td>
            <td style="text-align:right;font-weight:600">${kes(totGross)}</td>
          </tr>
        </tfoot>
      </table>
    </div>
    <p class="muted">Subtotal (ex VAT): ${kes(sumNet)} · VAT: ${kes(sumVat)} · <strong>Total (inc VAT): ${kes(totGross)}</strong></p>
  `;

  res.type('html').send(page(`LPO ${escapeHtml(lpo.ref)} — verified`, body));
});

function page(title, innerHtml) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${title}</title>
  <style>
    body { font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif; margin: 0; padding: 1rem; background: #0d1117; color: #e6edf3; line-height: 1.45; }
    main { max-width: 960px; margin: 0 auto; }
    h1 { font-size: 1.35rem; margin: 0 0 1rem; }
    h2 { font-size: 1.05rem; margin: 1.25rem 0 0.5rem; }
    .banner { padding: 1rem 1.1rem; border-radius: 8px; margin-bottom: 1rem; border: 1px solid #30363d; }
    .banner.ok { background: #12261a; border-color: #238636; }
    .meta { display: grid; grid-template-columns: 10rem 1fr; gap: 0.35rem 1rem; margin: 0; }
    .meta dt { color: #8b949e; margin: 0; }
    .meta dd { margin: 0; }
    table { width: 100%; border-collapse: collapse; font-size: 0.9rem; }
    th, td { border-bottom: 1px solid #30363d; padding: 0.45rem 0.35rem; text-align: left; }
    th { color: #8b949e; font-weight: 600; font-size: 0.78rem; text-transform: uppercase; letter-spacing: 0.03em; }
    tfoot td { border-bottom: none; padding-top: 0.65rem; }
    .yes { color: #3fb950; font-weight: 600; }
    .no { color: #d29922; font-weight: 600; }
    .muted { color: #8b949e; font-size: 0.88rem; }
  </style>
</head>
<body>
  <main>
    <h1>${title}</h1>
    ${innerHtml}
  </main>
</body>
</html>`;
}
