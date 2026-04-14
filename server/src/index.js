import express from 'express';
import cors from 'cors';
import { initDb, db, reloadDbFromDisk, dbPath } from './db.js';
import { customersRouter } from './routes/customers.js';
import { vehiclesRouter } from './routes/vehicles.js';
import { jobsRouter } from './routes/jobs.js';
import { invoicesRouter } from './routes/invoices.js';
import { jobTypesRouter } from './routes/jobTypes.js';
import { reportsRouter } from './routes/reports.js';
import { stockRouter } from './routes/stock.js';
import { suppliersRouter } from './routes/suppliers.js';
import { lpoIprRouter } from './routes/lpoIpr.js';
import { customerPortalRouter } from './routes/customerPortal.js';
import { adminRouter } from './routes/admin.js';
import { publicLpoVerifyRouter } from './routes/publicLpoVerify.js';
import { config } from './config.js';

const app = express();
app.use(cors());
app.use(express.json());

app.use('/api/customers', customersRouter);
app.use('/api/vehicles', vehiclesRouter);
app.use('/api/jobs', jobsRouter);
app.use('/api/invoices', invoicesRouter);
app.use('/api/job-types', jobTypesRouter);
app.use('/api/stock', stockRouter);
app.use('/api/suppliers', suppliersRouter);
app.use('/api/lpo-ipr', lpoIprRouter);
app.use('/api/reports', reportsRouter);
  app.use('/api/customer-portal', customerPortalRouter);
app.use('/api/admin', adminRouter);
app.use('/api/public/lpo-verify', publicLpoVerifyRouter);

app.get('/api/health', (req, res) => res.json({ ok: true }));

initDb().then(() => {
  const cust = db.prepare('SELECT COUNT(*) as n FROM customers').get().n;
  const veh = db.prepare('SELECT COUNT(*) as n FROM vehicles').get().n;
  const sup = db.prepare('SELECT COUNT(*) as n FROM suppliers').get().n;
  console.log(`[workshop-db] File: ${dbPath}`);
  console.log(`[workshop-db] Loaded: customers=${cust}, vehicles=${veh}, suppliers=${sup}`);

  app.post('/api/reload-db', async (req, res) => {
    const lockedDown =
      process.env.NODE_ENV === 'production' && process.env.ALLOW_DB_RELOAD !== '1';
    if (lockedDown) {
      return res.status(403).json({
        error: 'Reload is disabled in production unless you set ALLOW_DB_RELOAD=1.',
      });
    }
    try {
      await reloadDbFromDisk();
      const c = db.prepare('SELECT COUNT(*) as n FROM customers').get().n;
      const v = db.prepare('SELECT COUNT(*) as n FROM vehicles').get().n;
      const s = db.prepare('SELECT COUNT(*) as n FROM suppliers').get().n;
      console.log(`[workshop-db] Reloaded from disk: customers=${c}, vehicles=${v}, suppliers=${s}`);
      res.json({ ok: true, customers: c, vehicles: v, suppliers: s });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  app.listen(config.port, () => {
    console.log(`Workshop API running at http://localhost:${config.port}`);
    if (cust === 0 && veh === 0) {
      console.log(
        '[workshop-db] Lists are empty in this process. If you ran an import, restart the API or POST /api/reload-db with ALLOW_DB_RELOAD=1.',
      );
    }
  });
}).catch((err) => {
  console.error('Failed to initialise database:', err);
  process.exit(1);
});
