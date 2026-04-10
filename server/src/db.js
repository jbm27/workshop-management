import initSqlJs from 'sql.js';
import { readFileSync, writeFileSync, existsSync, unlinkSync, statSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dbPath = process.env.DB_PATH || path.join(__dirname, '..', 'db', 'workshop.db');

let _db = null;
/** sql.js module (used to open a new Database when reloading from disk) */
let _SQL = null;

function getDb() {
  if (!_db) throw new Error('Database not initialised. Call initDb() first.');
  return _db;
}

function all(sql, params = []) {
  const d = getDb();
  const stmt = d.prepare(sql);
  stmt.bind(params);
  const rows = [];
  while (stmt.step()) rows.push(stmt.getAsObject());
  stmt.free();
  return rows;
}

function get(sql, params = []) {
  const rows = all(sql, params);
  return rows[0] ?? null;
}

function run(sql, params = []) {
  const d = getDb();
  d.run(sql, params);
  const lastId = d.exec("SELECT last_insert_rowid() as id");
  const lastInsertRowid = lastId.length && lastId[0].values[0] ? lastId[0].values[0][0] : 0;
  return { lastInsertRowid, changes: d.getRowsModified() };
}

function save() {
  if (!_db) return;
  const data = _db.export();
  writeFileSync(dbPath, Buffer.from(data));
}

function migrate(db) {
  const info = db.exec("PRAGMA table_info(jobs)");
  const names = (info[0]?.values || []).map((row) => row[1]);
  const has = (n) => names.includes(n);
  if (!has('customer_id')) {
    try {
      db.run('ALTER TABLE jobs ADD COLUMN customer_id INTEGER REFERENCES customers(id) ON DELETE SET NULL');
      db.run('UPDATE jobs SET customer_id = (SELECT customer_id FROM vehicles WHERE vehicles.id = jobs.vehicle_id)');
    } catch (e) {
      if (!e.message?.includes('duplicate column')) throw e;
    }
  }
  ['odometer_in', 'odometer_out', 'fuel_in', 'fuel_out'].forEach((col) => {
    if (!has(col)) {
      try {
        const type = col.startsWith('odometer') ? 'INTEGER' : 'TEXT';
        db.run(`ALTER TABLE jobs ADD COLUMN ${col} ${type}`);
      } catch (e) {
        if (!e.message?.includes('duplicate column')) throw e;
      }
    }
  });
  if (has('odometer_at_job') && has('odometer_in')) {
    try {
      db.run('UPDATE jobs SET odometer_in = odometer_at_job WHERE odometer_in IS NULL AND odometer_at_job IS NOT NULL');
    } catch (_) {}
  }
  try {
    const jobInfo = db.exec('PRAGMA table_info(jobs)');
    const jobCols = (jobInfo[0]?.values || []).map((row) => row[1]);
    if (jobCols.length && !jobCols.includes('valuables_in_vehicle')) {
      db.run('ALTER TABLE jobs ADD COLUMN valuables_in_vehicle TEXT');
    }
  } catch (e) {
    if (!e.message?.includes('duplicate column')) throw e;
  }
  try {
    db.run(`
      CREATE TABLE IF NOT EXISTS job_tasks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        job_id INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
        description TEXT NOT NULL,
        sort_order INTEGER DEFAULT 0,
        completed INTEGER DEFAULT 0,
        created_at TEXT DEFAULT (datetime('now'))
      )
    `);
    db.run('CREATE INDEX IF NOT EXISTS idx_job_tasks_job ON job_tasks(job_id)');
  } catch (e) {
    if (!e.message?.includes('already exists')) throw e;
  }
  try {
    db.run(`
      CREATE TABLE IF NOT EXISTS job_test_drives (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        job_id INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
        odometer INTEGER NOT NULL,
        fuel TEXT,
        created_at TEXT DEFAULT (datetime('now'))
      )
    `);
    db.run('CREATE INDEX IF NOT EXISTS idx_job_test_drives_job ON job_test_drives(job_id)');
  } catch (e) {
    if (!e.message?.includes('already exists')) throw e;
  }
  try {
    db.run(`
      CREATE TABLE IF NOT EXISTS job_time_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        job_id INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
        admin_user_id INTEGER NOT NULL REFERENCES admin_users(id),
        hours REAL NOT NULL,
        notes TEXT,
        worked_at TEXT NOT NULL DEFAULT (datetime('now')),
        created_at TEXT DEFAULT (datetime('now'))
      )
    `);
    db.run('CREATE INDEX IF NOT EXISTS idx_job_time_logs_job ON job_time_logs(job_id)');
  } catch (e) {
    if (!e.message?.includes('already exists')) throw e;
  }
  // Ensure job_tasks has a completed flag for checklist behaviour
  try {
    const jtInfo = db.exec("PRAGMA table_info(job_tasks)");
    const jtCols = (jtInfo[0]?.values || []).map((row) => row[1]);
    if (!jtCols.includes('completed')) {
      db.run('ALTER TABLE job_tasks ADD COLUMN completed INTEGER DEFAULT 0');
    }
  } catch (e) {
    if (!e.message?.includes('duplicate column')) throw e;
  }
  // Ensure customers have a portal_token for customer portal links
  try {
    const custInfo = db.exec("PRAGMA table_info(customers)");
    const custCols = (custInfo[0]?.values || []).map((row) => row[1]);
    if (!custCols.includes('portal_token')) {
      db.run('ALTER TABLE customers ADD COLUMN portal_token TEXT');
    }
  } catch (e) {
    if (!e.message?.includes('duplicate column')) throw e;
  }
  // Ensure jobs have customer_rating and customer_feedback
  try {
    const jobInfo = db.exec("PRAGMA table_info(jobs)");
    const jobCols = (jobInfo[0]?.values || []).map((row) => row[1]);
    if (!jobCols.includes('customer_rating')) {
      db.run('ALTER TABLE jobs ADD COLUMN customer_rating INTEGER');
    }
    if (!jobCols.includes('customer_feedback')) {
      db.run('ALTER TABLE jobs ADD COLUMN customer_feedback TEXT');
    }
  } catch (e) {
    if (!e.message?.includes('duplicate column')) throw e;
  }
  const invItemsInfo = db.exec("PRAGMA table_info(invoice_items)");
  const invItemNames = (invItemsInfo[0]?.values || []).map((row) => row[1]);
  if (invItemNames.length && !invItemNames.includes('purchase_price')) {
    try {
      db.run('ALTER TABLE invoice_items ADD COLUMN purchase_price REAL DEFAULT 0');
    } catch (e) {
      if (!e.message?.includes('duplicate column')) throw e;
    }
  }
  if (invItemNames.length && !invItemNames.includes('approved')) {
    try {
      db.run('ALTER TABLE invoice_items ADD COLUMN approved INTEGER DEFAULT 0');
    } catch (e) {
      if (!e.message?.includes('duplicate column')) throw e;
    }
  }
  try {
    db.run("UPDATE jobs SET status = 'in_progress' WHERE status = 'pending'");
  } catch (_) {}
  try {
    const ii = db.exec('PRAGMA table_info(invoice_items)');
    const iiCols = (ii[0]?.values || []).map((row) => row[1]);
    if (iiCols.length && !iiCols.includes('lpo_ref')) {
      db.run('ALTER TABLE invoice_items ADD COLUMN lpo_ref TEXT');
    }
    if (iiCols.length && !iiCols.includes('ipr_ref')) {
      db.run('ALTER TABLE invoice_items ADD COLUMN ipr_ref TEXT');
    }
    if (iiCols.length && !iiCols.includes('supplier_id')) {
      db.run('ALTER TABLE invoice_items ADD COLUMN supplier_id INTEGER REFERENCES suppliers(id)');
    }
  } catch (e) {
    if (!e.message?.includes('duplicate column')) throw e;
  }
  try {
    db.run(`
      CREATE TABLE IF NOT EXISTS supplier_payments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        supplier_id INTEGER NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
        amount REAL NOT NULL,
        paid_at TEXT NOT NULL DEFAULT (datetime('now')),
        notes TEXT,
        created_at TEXT DEFAULT (datetime('now'))
      )
    `);
    db.run('CREATE INDEX IF NOT EXISTS idx_supplier_payments_supplier ON supplier_payments(supplier_id)');
  } catch (e) {
    if (!e.message?.includes('already exists')) throw e;
  }
  try {
    db.run(`
      CREATE TABLE IF NOT EXISTS lpos (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        invoice_id INTEGER NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
        supplier_id INTEGER NOT NULL REFERENCES suppliers(id),
        ref TEXT NOT NULL,
        notes TEXT,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
      )
    `);
    db.run('CREATE INDEX IF NOT EXISTS idx_lpos_invoice ON lpos(invoice_id)');
    db.run('CREATE INDEX IF NOT EXISTS idx_lpos_supplier ON lpos(supplier_id)');
    db.run(`
      CREATE TABLE IF NOT EXISTS lpo_lines (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        lpo_id INTEGER NOT NULL REFERENCES lpos(id) ON DELETE CASCADE,
        invoice_item_id INTEGER NOT NULL REFERENCES invoice_items(id) ON DELETE CASCADE,
        description TEXT NOT NULL,
        quantity REAL NOT NULL DEFAULT 1,
        unit_cost REAL NOT NULL DEFAULT 0,
        created_at TEXT DEFAULT (datetime('now'))
      )
    `);
    db.run('CREATE INDEX IF NOT EXISTS idx_lpo_lines_lpo ON lpo_lines(lpo_id)');
    db.run('CREATE INDEX IF NOT EXISTS idx_lpo_lines_invoice_item ON lpo_lines(invoice_item_id)');
  } catch (e) {
    if (!e.message?.includes('already exists')) throw e;
  }
  try {
    const llInfo = db.exec('PRAGMA table_info(lpo_lines)');
    const llCols = (llInfo[0]?.values || []).map((row) => row[1]);
    if (llCols.length && !llCols.includes('vat_rate')) {
      db.run('ALTER TABLE lpo_lines ADD COLUMN vat_rate REAL NOT NULL DEFAULT 0');
    }
    if (llCols.length && !llCols.includes('vat_exempt')) {
      db.run('ALTER TABLE lpo_lines ADD COLUMN vat_exempt INTEGER NOT NULL DEFAULT 0');
    }
  } catch (e) {
    if (!e.message?.includes('duplicate column')) throw e;
  }
  try {
    const li = db.exec('PRAGMA table_info(lpo_lines)');
    const lpoLineNames = (li[0]?.values || []).map((row) => row[1]);
    if (lpoLineNames.length > 0) {
      const pi = db.exec('PRAGMA table_info(lpos)');
      const pRows = pi[0]?.values || [];
      const invoiceIdInfo = pRows.find((r) => r[1] === 'invoice_id');
      const invoiceItemInfo = (li[0].values || []).find((r) => r[1] === 'invoice_item_id');
      const hasStockItemId = lpoLineNames.includes('stock_item_id');
      const needRebuild =
        (invoiceIdInfo && invoiceIdInfo[3] === 1) || (invoiceItemInfo && invoiceItemInfo[3] === 1);

      if (needRebuild) {
        db.run('CREATE TABLE lpo_lines__mig AS SELECT * FROM lpo_lines');
        db.run('DROP TABLE lpo_lines');
        db.run('CREATE TABLE lpos__mig AS SELECT * FROM lpos');
        db.run('DROP TABLE lpos');
        db.run(`
          CREATE TABLE lpos (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            invoice_id INTEGER REFERENCES invoices(id) ON DELETE CASCADE,
            supplier_id INTEGER NOT NULL REFERENCES suppliers(id),
            ref TEXT NOT NULL,
            notes TEXT,
            created_at TEXT DEFAULT (datetime('now')),
            updated_at TEXT DEFAULT (datetime('now'))
          )
        `);
        db.run('INSERT INTO lpos SELECT * FROM lpos__mig');
        db.run('DROP TABLE lpos__mig');
        db.run('CREATE INDEX IF NOT EXISTS idx_lpos_invoice ON lpos(invoice_id)');
        db.run('CREATE INDEX IF NOT EXISTS idx_lpos_supplier ON lpos(supplier_id)');

        const migInfo = db.exec('PRAGMA table_info(lpo_lines__mig)');
        const migColNames = (migInfo[0]?.values || []).map((r) => r[1]);
        const vatR = migColNames.includes('vat_rate') ? 'COALESCE(vat_rate, 0)' : '0';
        const vatE = migColNames.includes('vat_exempt') ? 'COALESCE(vat_exempt, 0)' : '0';
        db.run(`
          CREATE TABLE lpo_lines (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            lpo_id INTEGER NOT NULL REFERENCES lpos(id) ON DELETE CASCADE,
            invoice_item_id INTEGER REFERENCES invoice_items(id) ON DELETE CASCADE,
            stock_item_id INTEGER REFERENCES stock_items(id),
            description TEXT NOT NULL,
            quantity REAL NOT NULL DEFAULT 1,
            unit_cost REAL NOT NULL DEFAULT 0,
            vat_rate REAL NOT NULL DEFAULT 0,
            vat_exempt INTEGER NOT NULL DEFAULT 0,
            created_at TEXT DEFAULT (datetime('now'))
          )
        `);
        db.run(`INSERT INTO lpo_lines (id, lpo_id, invoice_item_id, stock_item_id, description, quantity, unit_cost, vat_rate, vat_exempt, created_at)
          SELECT id, lpo_id, invoice_item_id, NULL, description, quantity, unit_cost, ${vatR}, ${vatE}, created_at FROM lpo_lines__mig`);
        db.run('DROP TABLE lpo_lines__mig');
        db.run('CREATE INDEX IF NOT EXISTS idx_lpo_lines_lpo ON lpo_lines(lpo_id)');
        db.run('CREATE INDEX IF NOT EXISTS idx_lpo_lines_invoice_item ON lpo_lines(invoice_item_id)');
      } else if (!hasStockItemId) {
        db.run('ALTER TABLE lpo_lines ADD COLUMN stock_item_id INTEGER REFERENCES stock_items(id)');
      }
    }
  } catch (e) {
    if (!e.message?.includes('duplicate column') && !e.message?.includes('already exists')) throw e;
  }
  try {
    const supInfo = db.exec('PRAGMA table_info(suppliers)');
    const supCols = (supInfo[0]?.values || []).map((row) => row[1]);
    if (supCols.length && !supCols.includes('pin')) {
      db.run('ALTER TABLE suppliers ADD COLUMN pin TEXT');
    }
  } catch (e) {
    if (!e.message?.includes('duplicate column')) throw e;
  }
  try {
    db.run("INSERT OR IGNORE INTO sequences (name, value) VALUES ('lpo', 1000)");
    db.run("INSERT OR IGNORE INTO sequences (name, value) VALUES ('ipr', 1000)");
  } catch (_) {}
  try {
    db.run("INSERT OR IGNORE INTO sequences (name, value) VALUES ('quote_number', 1000)");
  } catch (_) {}
  try {
    db.run(`
      CREATE TABLE IF NOT EXISTS invoice_payments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        invoice_id INTEGER NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
        amount REAL NOT NULL,
        paid_at TEXT NOT NULL DEFAULT (datetime('now')),
        notes TEXT,
        created_at TEXT DEFAULT (datetime('now'))
      )
    `);
    db.run('CREATE INDEX IF NOT EXISTS idx_invoice_payments_invoice ON invoice_payments(invoice_id)');
  } catch (e) {
    if (!e.message?.includes('already exists')) throw e;
  }
  try {
    db.run(`
      INSERT INTO invoice_payments (invoice_id, amount, paid_at, notes)
      SELECT i.id, i.total, COALESCE(i.paid_at, datetime('now')), 'Recorded as paid (existing invoice)'
      FROM invoices i
      WHERE i.type = 'invoice' AND i.status = 'paid' AND IFNULL(i.total, 0) > 0
        AND NOT EXISTS (SELECT 1 FROM invoice_payments p WHERE p.invoice_id = i.id)
    `);
  } catch (_) {}
  try {
    db.run(`
      CREATE TABLE IF NOT EXISTS iprs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        invoice_id INTEGER NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
        ref TEXT NOT NULL,
        notes TEXT,
        finalized INTEGER NOT NULL DEFAULT 0,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
      )
    `);
    db.run('CREATE INDEX IF NOT EXISTS idx_iprs_invoice ON iprs(invoice_id)');
    db.run(`
      CREATE TABLE IF NOT EXISTS ipr_lines (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ipr_id INTEGER NOT NULL REFERENCES iprs(id) ON DELETE CASCADE,
        invoice_item_id INTEGER NOT NULL REFERENCES invoice_items(id) ON DELETE CASCADE,
        stock_item_id INTEGER NOT NULL REFERENCES stock_items(id),
        description TEXT NOT NULL,
        quantity REAL NOT NULL DEFAULT 1,
        unit_cost REAL NOT NULL DEFAULT 0,
        vat_rate REAL NOT NULL DEFAULT 0,
        vat_exempt INTEGER NOT NULL DEFAULT 0,
        created_at TEXT DEFAULT (datetime('now'))
      )
    `);
    db.run('CREATE INDEX IF NOT EXISTS idx_ipr_lines_ipr ON ipr_lines(ipr_id)');
    db.run('CREATE INDEX IF NOT EXISTS idx_ipr_lines_invoice_item ON ipr_lines(invoice_item_id)');
  } catch (e) {
    if (!e.message?.includes('already exists')) throw e;
  }
  const mig = db.prepare(`
    SELECT ii.id AS item_id, ii.invoice_id, ii.ipr_ref, ii.stock_item_id, ii.quantity, ii.description
    FROM invoice_items ii
    WHERE ii.ipr_ref IS NOT NULL AND TRIM(ii.ipr_ref) != ''
  `);
  const legacyRows = [];
  while (mig.step()) legacyRows.push(mig.getAsObject());
  mig.free();
  for (const row of legacyRows) {
    const sid = row.stock_item_id;
    if (sid == null || sid === '') {
      db.run('UPDATE invoice_items SET ipr_ref = NULL WHERE id = ?', [row.item_id]);
      continue;
    }
    const st = db.prepare('SELECT code, name, cost_price FROM stock_items WHERE id = ?');
    st.bind([sid]);
    let stock = null;
    if (st.step()) stock = st.getAsObject();
    st.free();
    const desc = stock
      ? `${String(stock.code || '').trim() ? String(stock.code).trim() + ' — ' : ''}${String(stock.name || '').trim() || 'Stock'}`.trim()
      : String(row.description || 'Stock issue').slice(0, 200);
    const uc = stock != null && Number(stock.cost_price) >= 0 ? Number(stock.cost_price) : 0;
    const qty = Number(row.quantity) > 0 ? Number(row.quantity) : 1;
    db.run('INSERT INTO iprs (invoice_id, ref, notes, finalized) VALUES (?, ?, NULL, 1)', [row.invoice_id, row.ipr_ref]);
    const lid = db.exec('SELECT last_insert_rowid() AS id');
    const iprId = lid[0]?.values[0]?.[0];
    db.run(
      'INSERT INTO ipr_lines (ipr_id, invoice_item_id, stock_item_id, description, quantity, unit_cost, vat_rate, vat_exempt) VALUES (?, ?, ?, ?, ?, ?, 0, 0)',
      [iprId, row.item_id, sid, desc || 'Stock', qty, uc],
    );
    db.run('UPDATE invoice_items SET ipr_ref = NULL WHERE id = ?', [row.item_id]);
  }
  try {
    const pi = db.exec('PRAGMA table_info(lpos)');
    const pcols = (pi[0]?.values || []).map((row) => row[1]);
    if (pcols.length && !pcols.includes('finalized')) {
      db.run('ALTER TABLE lpos ADD COLUMN finalized INTEGER NOT NULL DEFAULT 0');
    }
    if (pcols.length && !pcols.includes('approved')) {
      db.run('ALTER TABLE lpos ADD COLUMN approved INTEGER NOT NULL DEFAULT 0');
    }
    if (pcols.length && !pcols.includes('approved_at')) {
      db.run('ALTER TABLE lpos ADD COLUMN approved_at TEXT');
    }
    if (pcols.length && !pcols.includes('approved_by_admin_user_id')) {
      db.run('ALTER TABLE lpos ADD COLUMN approved_by_admin_user_id INTEGER REFERENCES admin_users(id)');
    }
  } catch (e) {
    if (!e.message?.includes('duplicate column')) throw e;
  }
  try {
    const ll = db.exec('PRAGMA table_info(lpo_lines)');
    const cols = (ll[0]?.values || []).map((row) => row[1]);
    if (cols.length && !cols.includes('assigned_admin_user_id')) {
      db.run('ALTER TABLE lpo_lines ADD COLUMN assigned_admin_user_id INTEGER REFERENCES admin_users(id)');
    }
    if (cols.length && !cols.includes('received_confirmed')) {
      db.run('ALTER TABLE lpo_lines ADD COLUMN received_confirmed INTEGER NOT NULL DEFAULT 0');
    }
    if (cols.length && !cols.includes('received_confirmed_at')) {
      db.run('ALTER TABLE lpo_lines ADD COLUMN received_confirmed_at TEXT');
    }
    if (cols.length && !cols.includes('received_confirmed_by_admin_user_id')) {
      db.run('ALTER TABLE lpo_lines ADD COLUMN received_confirmed_by_admin_user_id INTEGER REFERENCES admin_users(id)');
    }
  } catch (e) {
    if (!e.message?.includes('duplicate column')) throw e;
  }
  try {
    const ip = db.exec('PRAGMA table_info(iprs)');
    const cols = (ip[0]?.values || []).map((row) => row[1]);
    if (cols.length && !cols.includes('approved')) {
      db.run('ALTER TABLE iprs ADD COLUMN approved INTEGER NOT NULL DEFAULT 0');
    }
    if (cols.length && !cols.includes('approved_at')) {
      db.run('ALTER TABLE iprs ADD COLUMN approved_at TEXT');
    }
    if (cols.length && !cols.includes('approved_by_admin_user_id')) {
      db.run('ALTER TABLE iprs ADD COLUMN approved_by_admin_user_id INTEGER REFERENCES admin_users(id)');
    }
  } catch (e) {
    if (!e.message?.includes('duplicate column')) throw e;
  }
  try {
    const il = db.exec('PRAGMA table_info(ipr_lines)');
    const cols = (il[0]?.values || []).map((row) => row[1]);
    if (cols.length && !cols.includes('assigned_admin_user_id')) {
      db.run('ALTER TABLE ipr_lines ADD COLUMN assigned_admin_user_id INTEGER REFERENCES admin_users(id)');
    }
    if (cols.length && !cols.includes('received_confirmed')) {
      db.run('ALTER TABLE ipr_lines ADD COLUMN received_confirmed INTEGER NOT NULL DEFAULT 0');
    }
    if (cols.length && !cols.includes('received_confirmed_at')) {
      db.run('ALTER TABLE ipr_lines ADD COLUMN received_confirmed_at TEXT');
    }
    if (cols.length && !cols.includes('received_confirmed_by_admin_user_id')) {
      db.run('ALTER TABLE ipr_lines ADD COLUMN received_confirmed_by_admin_user_id INTEGER REFERENCES admin_users(id)');
    }
  } catch (e) {
    if (!e.message?.includes('duplicate column')) throw e;
  }

  // Admin auth + permissions tables (team members)
  try {
    db.run(`
      CREATE TABLE IF NOT EXISTS admin_users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT NOT NULL UNIQUE,
        display_name TEXT NOT NULL,
        password_salt TEXT NOT NULL,
        password_hash TEXT NOT NULL,
        active INTEGER NOT NULL DEFAULT 1,
        is_mechanic INTEGER NOT NULL DEFAULT 0,

        can_create_lpos INTEGER NOT NULL DEFAULT 0,
        can_create_iprs INTEGER NOT NULL DEFAULT 0,
        can_finalize_lpos INTEGER NOT NULL DEFAULT 0,
        can_finalize_iprs INTEGER NOT NULL DEFAULT 0,
        can_approve_lpo_ipr INTEGER NOT NULL DEFAULT 0,
        can_record_invoice_payments INTEGER NOT NULL DEFAULT 0,
        can_record_supplier_payments INTEGER NOT NULL DEFAULT 0,

        can_manage_team_members INTEGER NOT NULL DEFAULT 0,
        can_view_lpo_ipr INTEGER NOT NULL DEFAULT 1,
        can_view_stores INTEGER NOT NULL DEFAULT 1,

        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
      );
    `);
  } catch (_) {}

  try {
    db.run(`
      CREATE TABLE IF NOT EXISTS admin_sessions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        admin_user_id INTEGER NOT NULL REFERENCES admin_users(id) ON DELETE CASCADE,
        token TEXT NOT NULL UNIQUE,
        created_at TEXT DEFAULT (datetime('now')),
        expires_at TEXT
      )
    `);
    db.run('CREATE INDEX IF NOT EXISTS idx_admin_sessions_admin ON admin_sessions(admin_user_id)');
  } catch (_) {}

  // Backfill missing columns (in case an older DB exists without the latest schema additions)
  try {
    const info = db.exec('PRAGMA table_info(admin_users)');
    const cols = (info[0]?.values || []).map((row) => row[1]);
    const ensureCol = (name, sql) => {
      if (!cols.includes(name)) {
        try {
          db.run(sql);
        } catch (e) {
          if (!e.message?.includes('duplicate column')) throw e;
        }
      }
    };
    ensureCol('can_create_lpos', 'ALTER TABLE admin_users ADD COLUMN can_create_lpos INTEGER NOT NULL DEFAULT 0');
    ensureCol('can_create_iprs', 'ALTER TABLE admin_users ADD COLUMN can_create_iprs INTEGER NOT NULL DEFAULT 0');
    ensureCol('can_finalize_lpos', 'ALTER TABLE admin_users ADD COLUMN can_finalize_lpos INTEGER NOT NULL DEFAULT 0');
    ensureCol('can_finalize_iprs', 'ALTER TABLE admin_users ADD COLUMN can_finalize_iprs INTEGER NOT NULL DEFAULT 0');
    ensureCol('can_approve_lpo_ipr', 'ALTER TABLE admin_users ADD COLUMN can_approve_lpo_ipr INTEGER NOT NULL DEFAULT 0');
    ensureCol(
      'can_record_invoice_payments',
      'ALTER TABLE admin_users ADD COLUMN can_record_invoice_payments INTEGER NOT NULL DEFAULT 0',
    );
    ensureCol(
      'can_record_supplier_payments',
      'ALTER TABLE admin_users ADD COLUMN can_record_supplier_payments INTEGER NOT NULL DEFAULT 0',
    );
    ensureCol('can_manage_team_members', 'ALTER TABLE admin_users ADD COLUMN can_manage_team_members INTEGER NOT NULL DEFAULT 0');
    ensureCol('can_view_lpo_ipr', 'ALTER TABLE admin_users ADD COLUMN can_view_lpo_ipr INTEGER NOT NULL DEFAULT 1');
    ensureCol('can_view_stores', 'ALTER TABLE admin_users ADD COLUMN can_view_stores INTEGER NOT NULL DEFAULT 1');
    ensureCol('is_mechanic', 'ALTER TABLE admin_users ADD COLUMN is_mechanic INTEGER NOT NULL DEFAULT 0');
    db.run('UPDATE admin_users SET can_approve_lpo_ipr = 1 WHERE can_manage_team_members = 1');
  } catch (_) {}

  // Seed a bootstrap admin user for first run / existing DB upgrades.
  try {
    const count = db.prepare('SELECT COUNT(*) as c FROM admin_users').get().c;
    if (!count) {
      const username = process.env.ADMIN_BOOTSTRAP_USERNAME || 'admin';
      const password = process.env.ADMIN_BOOTSTRAP_PASSWORD || 'admin';
      const displayName = process.env.ADMIN_BOOTSTRAP_DISPLAY_NAME || 'Admin';
      const salt = crypto.randomBytes(16).toString('hex');
      const hash = crypto.pbkdf2Sync(password, salt, 100000, 64, 'sha512').toString('hex');
      db.prepare(`
        INSERT INTO admin_users
          (username, display_name, password_salt, password_hash, active,
           can_create_lpos, can_create_iprs, can_finalize_lpos, can_finalize_iprs,
           can_approve_lpo_ipr,
           can_record_invoice_payments, can_record_supplier_payments,
           can_manage_team_members, can_view_lpo_ipr, can_view_stores)
        VALUES (?, ?, ?, ?, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1)
      `).run(username, displayName, salt, hash);
    }
  } catch (_) {}
}

/** Run work in one SQLite transaction without saving until commit (avoids partial writes mid-tx). */
export function transactionSync(fn) {
  const d = getDb();
  d.run('BEGIN IMMEDIATE');
  try {
    const tx = {
      run(sql, params = []) {
        d.run(sql, params);
        return { changes: d.getRowsModified() };
      },
      get(sql, params = []) {
        const stmt = d.prepare(sql);
        stmt.bind(params);
        if (!stmt.step()) {
          stmt.free();
          return null;
        }
        const row = stmt.getAsObject();
        stmt.free();
        return row;
      },
      all(sql, params = []) {
        const stmt = d.prepare(sql);
        stmt.bind(params);
        const rows = [];
        while (stmt.step()) rows.push(stmt.getAsObject());
        stmt.free();
        return rows;
      },
      lastInsertRowid() {
        const r = d.exec('SELECT last_insert_rowid() as id');
        return r[0]?.values[0]?.[0] ?? 0;
      },
    };
    fn(tx);
    d.run('COMMIT');
  } catch (e) {
    try {
      d.run('ROLLBACK');
    } catch (_) {}
    throw e;
  } finally {
    save();
  }
}

export async function initDb() {
  const SQL = await initSqlJs();
  _SQL = SQL;

  if (existsSync(dbPath)) {
    try {
      const st = statSync(dbPath);
      if (st.size === 0) {
        console.warn(
          `[workshop-db] Database file is empty (0 bytes), likely truncated. Removing it and creating a new database.\n` +
            `  Path: ${dbPath}\n` +
            '  If you had customers, jobs, or vehicles before, restore workshop.db from a backup copy.',
        );
        unlinkSync(dbPath);
      }
    } catch (e) {
      console.warn('[workshop-db] Could not check database file:', e.message);
    }
  }

  if (existsSync(dbPath)) {
    const buf = readFileSync(dbPath);
    const probe = new SQL.Database(buf);
    let hasCustomersTable = false;
    try {
      const chk = probe.exec(
        "SELECT 1 FROM sqlite_master WHERE type='table' AND name='customers' LIMIT 1",
      );
      hasCustomersTable = Boolean(chk?.length && chk[0]?.values?.length);
    } catch (_) {
      hasCustomersTable = false;
    }
    if (!hasCustomersTable) {
      console.warn(
        `[workshop-db] Database file has no usable schema (e.g. empty or corrupt). Replacing with a new database.\n` +
          `  Path: ${dbPath}\n` +
          '  Rename or back up the old file if you need to recover data.',
      );
      try {
        probe.close();
      } catch (_) {}
      unlinkSync(dbPath);
    } else {
      _db = probe;
      migrate(_db);
      save();
      return _db;
    }
  }

  _db = new SQL.Database();
  const { readFileSync: read } = await import('fs');
  const schemaPath = path.join(__dirname, '..', 'db', 'schema.sql');
  const schema = read(schemaPath, 'utf8');
  _db.run(schema);
  _db.run(`
    CREATE TABLE IF NOT EXISTS sequences (name TEXT PRIMARY KEY, value INTEGER DEFAULT 0);
    INSERT OR IGNORE INTO sequences (name, value) VALUES ('job_number', 1000);
    INSERT OR IGNORE INTO sequences (name, value) VALUES ('invoice_number', 1000);
    INSERT OR IGNORE INTO sequences (name, value) VALUES ('quote_number', 1000);
    INSERT OR IGNORE INTO sequences (name, value) VALUES ('lpo', 1000);
    INSERT OR IGNORE INTO sequences (name, value) VALUES ('ipr', 1000);
  `);
  _db.run(`INSERT OR IGNORE INTO job_types (id, name, description, default_labour_hours, default_labour_rate) VALUES (1, 'General Service', 'Standard service', 1.5, 2500)`);

  // Seed bootstrap admin user for a brand new database
  try {
    const count = _db.prepare('SELECT COUNT(*) as c FROM admin_users').get().c;
    if (!count) {
      const username = process.env.ADMIN_BOOTSTRAP_USERNAME || 'admin';
      const password = process.env.ADMIN_BOOTSTRAP_PASSWORD || 'admin';
      const displayName = process.env.ADMIN_BOOTSTRAP_DISPLAY_NAME || 'Admin';
      const salt = crypto.randomBytes(16).toString('hex');
      const hash = crypto.pbkdf2Sync(password, salt, 100000, 64, 'sha512').toString('hex');
      _db.prepare(`
        INSERT INTO admin_users
          (username, display_name, password_salt, password_hash, active,
           can_create_lpos, can_create_iprs, can_finalize_lpos, can_finalize_iprs,
           can_approve_lpo_ipr,
           can_record_invoice_payments, can_record_supplier_payments,
           can_manage_team_members, can_view_lpo_ipr, can_view_stores)
        VALUES (?, ?, ?, ?, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1)
      `).run(username, displayName, salt, hash);
    }
  } catch (_) {}
  save();
  return _db;
}

/**
 * Replace in-memory DB with the current contents of workshop.db on disk.
 * Use after running import scripts while the API stays running (sql.js does not auto-refresh the file).
 */
export async function reloadDbFromDisk() {
  if (!_SQL) throw new Error('initDb() must run before reloadDbFromDisk()');
  if (!existsSync(dbPath)) throw new Error(`Database file not found: ${dbPath}`);
  const buf = readFileSync(dbPath);
  if (_db) {
    try {
      _db.close();
    } catch (_) {}
  }
  _db = new _SQL.Database(buf);
  migrate(_db);
  save();
}

export { dbPath };

// Proxy that wraps the db to add save() after run
export const db = {
  prepare(sql) {
    return {
      get(...params) { return get(sql, params); },
      all(...params) { return all(sql, params); },
      run(...params) {
        const out = run(sql, params);
        save();
        return out;
      },
    };
  },
};
