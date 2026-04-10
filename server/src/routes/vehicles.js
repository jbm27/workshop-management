import { Router } from 'express';
import { db } from '../db.js';

export const vehiclesRouter = Router();

vehiclesRouter.get('/', (req, res) => {
  const q = (req.query.q || '').trim();
  const customerId = req.query.customer_id;
  let stmt, rows;
  if (customerId) {
    stmt = db.prepare('SELECT v.*, c.name as customer_name FROM vehicles v LEFT JOIN customers c ON v.customer_id = c.id WHERE v.customer_id = ? ORDER BY v.created_at DESC');
    rows = stmt.all(customerId);
  } else if (q) {
    stmt = db.prepare(`
      SELECT v.*, c.name as customer_name FROM vehicles v
      LEFT JOIN customers c ON v.customer_id = c.id
      WHERE v.registration LIKE ? OR v.make LIKE ? OR v.model LIKE ? OR (c.name LIKE ?)
      ORDER BY v.created_at DESC
    `);
    const like = `%${q}%`;
    rows = stmt.all(like, like, like, like);
  } else {
    stmt = db.prepare('SELECT v.*, c.name as customer_name FROM vehicles v LEFT JOIN customers c ON v.customer_id = c.id ORDER BY v.created_at DESC');
    rows = stmt.all();
  }
  res.json(rows);
});

vehiclesRouter.get('/:id', (req, res) => {
  const row = db.prepare(`
    SELECT v.*, c.name as customer_name, c.phone as customer_phone, c.email as customer_email
    FROM vehicles v LEFT JOIN customers c ON v.customer_id = c.id
    WHERE v.id = ?
  `).get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Vehicle not found' });
  res.json(row);
});

vehiclesRouter.post('/', (req, res) => {
  const { customer_id, registration, make, model, year, vin, odometer, notes } = req.body;
  const result = db.prepare(`
    INSERT INTO vehicles (customer_id, registration, make, model, year, vin, odometer, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(customer_id || null, registration || null, make || null, model || null, year || null, vin || null, odometer || null, notes || null);
  const row = db.prepare('SELECT v.*, c.name as customer_name FROM vehicles v LEFT JOIN customers c ON v.customer_id = c.id WHERE v.id = ?').get(result.lastInsertRowid);
  res.status(201).json(row);
});

vehiclesRouter.patch('/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM vehicles WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Vehicle not found' });
  const { customer_id, registration, make, model, year, vin, odometer, notes } = req.body;
  db.prepare(`
    UPDATE vehicles SET customer_id = ?, registration = ?, make = ?, model = ?, year = ?, vin = ?, odometer = ?, notes = ?, updated_at = datetime('now')
    WHERE id = ?
  `).run(
    customer_id ?? row.customer_id,
    registration ?? row.registration,
    make ?? row.make,
    model ?? row.model,
    year ?? row.year,
    vin ?? row.vin,
    odometer ?? row.odometer,
    notes ?? row.notes,
    req.params.id
  );
  res.json(db.prepare('SELECT v.*, c.name as customer_name FROM vehicles v JOIN customers c ON v.customer_id = c.id WHERE v.id = ?').get(req.params.id));
});

vehiclesRouter.delete('/:id', (req, res) => {
  const result = db.prepare('DELETE FROM vehicles WHERE id = ?').run(req.params.id);
  if (result.changes === 0) return res.status(404).json({ error: 'Vehicle not found' });
  res.status(204).send();
});
