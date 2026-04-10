import { db } from './db.js';

export function nextSequenceRef(seqName, prefix) {
  db.prepare('INSERT OR IGNORE INTO sequences (name, value) VALUES (?, 1000)').run(seqName);
  const row = db.prepare('SELECT value FROM sequences WHERE name = ?').get(seqName);
  const next = (row?.value ?? 1000) + 1;
  db.prepare('UPDATE sequences SET value = ? WHERE name = ?').run(next, seqName);
  return `${prefix}-${next}`;
}
