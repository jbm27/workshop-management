import { db } from './db.js';

/** Numeric part for the next J / INV / QUO document (stored sequence is one less). */
export const NEXT_JOB_INVOICE_NUMBER = 47093;
export const JOB_INVOICE_SEQUENCE_BASELINE = NEXT_JOB_INVOICE_NUMBER - 1;

export function nextSequenceRef(seqName, prefix) {
  db.prepare('INSERT OR IGNORE INTO sequences (name, value) VALUES (?, ?)').run(seqName, JOB_INVOICE_SEQUENCE_BASELINE);
  const row = db.prepare('SELECT value FROM sequences WHERE name = ?').get(seqName);
  const next = (row?.value ?? JOB_INVOICE_SEQUENCE_BASELINE) + 1;
  db.prepare('UPDATE sequences SET value = ? WHERE name = ?').run(next, seqName);
  return `${prefix}-${next}`;
}
