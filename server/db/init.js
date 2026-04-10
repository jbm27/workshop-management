import initSqlJs from 'sql.js';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dbPath = path.join(__dirname, 'workshop.db');
const schemaPath = path.join(__dirname, 'schema.sql');

const schema = readFileSync(schemaPath, 'utf8');

initSqlJs().then((SQL) => {
  const db = existsSync(dbPath)
    ? new SQL.Database(readFileSync(dbPath))
    : new SQL.Database();

  db.run(schema);
  db.run(`
    CREATE TABLE IF NOT EXISTS sequences (name TEXT PRIMARY KEY, value INTEGER DEFAULT 0);
    INSERT OR IGNORE INTO sequences (name, value) VALUES ('job_number', 1000);
    INSERT OR IGNORE INTO sequences (name, value) VALUES ('invoice_number', 1000);
  `);
  db.run(`INSERT OR IGNORE INTO job_types (id, name, description, default_labour_hours, default_labour_rate) VALUES (1, 'General Service', 'Standard service', 1.5, 2500)`);

  const data = db.export();
  writeFileSync(dbPath, Buffer.from(data));
  console.log('Database initialised at', dbPath);
}).catch((err) => {
  console.error(err);
  process.exit(1);
});
