import QRCode from 'qrcode';
import { db } from './db.js';
import { config } from './config.js';
import { newLpoPublicVerifyToken } from './lpoPublicToken.js';

/**
 * Ensures `lpo` has a verify token, draws a QR + caption on the PDF, returns Y below the block.
 * @param {import('pdfkit')} doc
 * @param {Record<string, unknown>} lpo — row including `id`, `public_verify_token`
 * @param {{ margin: number; contentWidth: number; y: number }} box
 */
export async function embedLpoVerifyQr(doc, lpo, box) {
  const { margin, contentWidth } = box;
  let y = box.y;
  let token = String(lpo.public_verify_token || '').trim();
  if (!token) {
    token = newLpoPublicVerifyToken();
    db.prepare(`UPDATE lpos SET public_verify_token = ?, updated_at = datetime('now') WHERE id = ?`).run(token, lpo.id);
    lpo.public_verify_token = token;
  }
  const base = String(config.publicBaseUrl || '').replace(/\/+$/, '');
  const verifyUrl = `${base}/api/public/lpo-verify/${token}`;
  let qrBuf;
  try {
    qrBuf = await QRCode.toBuffer(verifyUrl, { type: 'png', width: 240, margin: 1 });
  } catch (e) {
    console.error('[LPO PDF] QR encode failed', e);
    return y;
  }
  const qrW = 72;
  const qrX = margin + contentWidth - qrW;
  doc.image(qrBuf, qrX, y, { width: qrW, height: qrW });
  doc.fontSize(7).font('Helvetica').fillColor('#333333');
  doc.text(
    'Supplier: scan this QR code to confirm this order on our system before releasing parts.',
    margin,
    y,
    { width: Math.max(120, contentWidth - qrW - 10) },
  );
  return Math.max(doc.y, y + qrW) + 10;
}
