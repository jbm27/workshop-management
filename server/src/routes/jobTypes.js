import { Router } from 'express';
import { db } from '../db.js';

export const jobTypesRouter = Router();

jobTypesRouter.get('/', (req, res) => {
  res.json(db.prepare('SELECT * FROM job_types ORDER BY name').all());
});

jobTypesRouter.get('/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM job_types WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Job type not found' });
  res.json(row);
});

jobTypesRouter.post('/', (req, res) => {
  const { name, description, default_labour_hours, default_labour_rate, checklist_json } = req.body;
  if (!name) return res.status(400).json({ error: 'Name is required' });
  const result = db.prepare(`
    INSERT INTO job_types (name, description, default_labour_hours, default_labour_rate, checklist_json)
    VALUES (?, ?, ?, ?, ?)
  `).run(name, description || null, default_labour_hours ?? 0, default_labour_rate ?? 0, checklist_json || null);
  res.status(201).json(db.prepare('SELECT * FROM job_types WHERE id = ?').get(result.lastInsertRowid));
});

jobTypesRouter.patch('/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM job_types WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Job type not found' });
  const { name, description, default_labour_hours, default_labour_rate, checklist_json } = req.body;
  db.prepare(`
    UPDATE job_types SET name = ?, description = ?, default_labour_hours = ?, default_labour_rate = ?, checklist_json = ?, updated_at = datetime('now')
    WHERE id = ?
  `).run(name ?? row.name, description ?? row.description, default_labour_hours ?? row.default_labour_hours, default_labour_rate ?? row.default_labour_rate, checklist_json ?? row.checklist_json, req.params.id);
  res.json(db.prepare('SELECT * FROM job_types WHERE id = ?').get(req.params.id));
});

jobTypesRouter.delete('/:id', (req, res) => {
  const result = db.prepare('DELETE FROM job_types WHERE id = ?').run(req.params.id);
  if (result.changes === 0) return res.status(404).json({ error: 'Job type not found' });
  res.status(204).send();
});
