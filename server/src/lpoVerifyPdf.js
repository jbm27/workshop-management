import QRCode from 'qrcode';
import { db } from './db.js';
import { config } from './config.js';
import { newLpoPublicVerifyToken } from './lpoPublicToken.js';

function normalizeBaseUrl(s) {
  return String(s || '').trim().replace(/\/+$/, '');
}

function requestBaseUrl(req) {
  const xfProto = String(req?.headers?.['x-forwarded-proto'] || '').split(',')[0].trim();
  const xfHost = String(req?.headers?.['x-forwarded-host'] || '').split(',')[0].trim();
  const proto = xfProto || req?.protocol || 'http';
  const host = xfHost || String(req?.get?.('host') || '').trim();
  if (!host) return '';
  return normalizeBaseUrl(`${proto}://${host}`);
}

function resolvePublicBaseUrl(req) {
  const envBase = normalizeBaseUrl(process.env.PUBLIC_BASE_URL || '');
  if (envBase) return envBase;
  const reqBase = requestBaseUrl(req);
  if (reqBase) return reqBase;
  return normalizeBaseUrl(config.publicBaseUrl || 'http://localhost:3001');
}

/**
 * Ensures `lpo` has a verify token, draws a QR + caption on the PDF, returns Y below the block.
 * @param {import('pdfkit')} doc
 * @param {Record<string, unknown>} lpo - row including `id`, `public_verify_token`
 * @param {{ margin: number; contentWidth: number; y: number }} box
 * @param {import('express').Request} req
 */
export async function embedLpoVerifyQr(doc, lpo, box, req) {
  const { margin, contentWidth } = box;
  let y = box.y;
  let token = String(lpo.public_verify_token || '').trim();
  if (!token) {
    token = newLpoPublicVerifyToken();
    db.prepare(`UPDATE lpos SET public_verify_token = ?, updated_at = datetime('now') WHERE id = ?`).run(token, lpo.id);
    lpo.public_verify_token = token;
  }
  const base = resolvePublicBaseUrl(req);
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
