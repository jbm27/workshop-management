import { db } from './db.js';

/** Numeric part for the next J / INV / QUO document (stored sequence is one less). */
export const NEXT_JOB_INVOICE_NUMBER = 47093;
export const JOB_INVOICE_SEQUENCE_BASELINE = NEXT_JOB_INVOICE_NUMBER - 1;
/** Next standalone/job quote number is QUO-{QUOTE_SEQUENCE_BASELINE + 1} (default 2438). */
export const QUOTE_SEQUENCE_BASELINE = 2437;

export function nextSequenceRef(seqName, prefix) {
  db.prepare('INSERT OR IGNORE INTO sequences (name, value) VALUES (?, ?)').run(seqName, JOB_INVOICE_SEQUENCE_BASELINE);
  const row = db.prepare('SELECT value FROM sequences WHERE name = ?').get(seqName);
  const next = (row?.value ?? JOB_INVOICE_SEQUENCE_BASELINE) + 1;
  db.prepare('UPDATE sequences SET value = ? WHERE name = ?').run(next, seqName);
  return `${prefix}-${next}`;
}

export function normalizeDocumentNumber(value) {
  const s = value != null ? String(value).trim() : '';
  return s || null;
}

export function isJobNumberTaken(jobNumber, excludeId = null) {
  const row =
    excludeId != null
      ? db.prepare('SELECT 1 AS taken FROM jobs WHERE job_number = ? AND id != ?').get(jobNumber, excludeId)
      : db.prepare('SELECT 1 AS taken FROM jobs WHERE job_number = ?').get(jobNumber);
  return Boolean(row);
}

export function isInvoiceNumberTaken(invoiceNumber, excludeId = null) {
  const row =
    excludeId != null
      ? db.prepare('SELECT 1 AS taken FROM invoices WHERE invoice_number = ? AND id != ?').get(invoiceNumber, excludeId)
      : db.prepare('SELECT 1 AS taken FROM invoices WHERE invoice_number = ?').get(invoiceNumber);
  return Boolean(row);
}

function bumpSequenceValue(seqName, num, baseline) {
  if (!Number.isFinite(num) || num <= 0) return;
  db.prepare('INSERT OR IGNORE INTO sequences (name, value) VALUES (?, ?)').run(seqName, baseline);
  const row = db.prepare('SELECT value FROM sequences WHERE name = ?').get(seqName);
  const current = row?.value ?? baseline;
  if (num > current) {
    db.prepare('UPDATE sequences SET value = ? WHERE name = ?').run(num, seqName);
  }
}

/** Keep auto-numbering ahead when a manual number uses the standard J{n} pattern. */
export function bumpSequenceFromJobNumber(jobNumber) {
  const m = /^J(\d+)(?:-\d+)?$/i.exec(String(jobNumber || ''));
  if (!m) return;
  bumpSequenceValue('job_number', parseInt(m[1], 10), JOB_INVOICE_SEQUENCE_BASELINE);
}

/** Keep auto-numbering ahead when a manual number uses INV-{n} or QUO-{n}. */
export function bumpSequenceFromInvoiceNumber(invoiceNumber) {
  const s = String(invoiceNumber || '');
  const invM = /^INV-(\d+)$/i.exec(s);
  if (invM) {
    bumpSequenceValue('invoice_number', parseInt(invM[1], 10), JOB_INVOICE_SEQUENCE_BASELINE);
    return;
  }
  const quoM = /^QUO-(\d+)$/i.exec(s);
  if (quoM) {
    bumpSequenceValue('quote_number', parseInt(quoM[1], 10), QUOTE_SEQUENCE_BASELINE);
  }
}
