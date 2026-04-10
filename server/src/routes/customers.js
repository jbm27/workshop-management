import { Router } from 'express';
import { db } from '../db.js';

export const customersRouter = Router();

customersRouter.get('/', (req, res) => {
  const q = (req.query.q || '').trim();
  let stmt;
  if (q) {
    stmt = db.prepare(`
      SELECT * FROM customers
      WHERE name LIKE ? OR email LIKE ? OR phone LIKE ?
      ORDER BY name
    `);
    const like = `%${q}%`;
    res.json(stmt.all(like, like, like));
  } else {
    stmt = db.prepare('SELECT * FROM customers ORDER BY name');
    res.json(stmt.all());
  }
});

customersRouter.get('/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM customers WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Customer not found' });
  res.json(row);
});

customersRouter.get('/:id/vehicles', (req, res) => {
  res.json(db.prepare('SELECT * FROM vehicles WHERE customer_id = ? ORDER BY created_at DESC').all(req.params.id));
});

customersRouter.post('/', (req, res) => {
  const { name, email, phone, address, notes } = req.body;
  if (!name) return res.status(400).json({ error: 'Name is required' });
  const result = db.prepare(`
    INSERT INTO customers (name, email, phone, address, notes)
    VALUES (?, ?, ?, ?, ?)
  `).run(name, email || null, phone || null, address || null, notes || null);
  const row = db.prepare('SELECT * FROM customers WHERE id = ?').get(result.lastInsertRowid);
  res.status(201).json(row);
});

customersRouter.patch('/:id', (req, res) => {
  const { name, email, phone, address, notes } = req.body;
  const row = db.prepare('SELECT * FROM customers WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Customer not found' });
  db.prepare(`
    UPDATE customers SET name = ?, email = ?, phone = ?, address = ?, notes = ?, updated_at = datetime('now')
    WHERE id = ?
  `).run(name ?? row.name, email ?? row.email, phone ?? row.phone, address ?? row.address, notes ?? row.notes, req.params.id);
  res.json(db.prepare('SELECT * FROM customers WHERE id = ?').get(req.params.id));
});

customersRouter.delete('/:id', (req, res) => {
  const result = db.prepare('DELETE FROM customers WHERE id = ?').run(req.params.id);
  if (result.changes === 0) return res.status(404).json({ error: 'Customer not found' });
  res.status(204).send();
});

customersRouter.post('/:id/portal-link', (req, res) => {
  const row = db.prepare('SELECT * FROM customers WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Customer not found' });
  let token = row.portal_token;
  if (!token) {
    token = Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
    db.prepare('UPDATE customers SET portal_token = ?, updated_at = datetime("now") WHERE id = ?').run(token, req.params.id);
  }
  const baseUrl = process.env.PORTAL_BASE_URL || 'http://localhost:5173';
  const portalUrl = `${baseUrl}/portal/${token}`;
  console.log(`Portal link for customer ${row.name}: ${portalUrl}`);
  res.json({ portal_url: portalUrl, token });
});
