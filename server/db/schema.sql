-- Workshop Management - Chequered Flag
-- Schema inspired by MechanicDesk-style workflow

-- Customers
CREATE TABLE IF NOT EXISTS customers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  address TEXT,
  notes TEXT,
  portal_token TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

-- Vehicles (optional primary owner – job bill-to is separate)
CREATE TABLE IF NOT EXISTS vehicles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id INTEGER REFERENCES customers(id) ON DELETE SET NULL,
  registration TEXT,
  make TEXT,
  model TEXT,
  year INTEGER,
  vin TEXT,
  odometer INTEGER,
  notes TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

-- Job types (templates for common jobs e.g. logbook service)
CREATE TABLE IF NOT EXISTS job_types (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  description TEXT,
  default_labour_hours REAL DEFAULT 0,
  default_labour_rate REAL DEFAULT 0,
  checklist_json TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

-- Admin users (internal team) and permissions
CREATE TABLE IF NOT EXISTS admin_users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  -- Workshop mechanic: Time logs, Assigned parts, and active Jobs (test drives); all other permissions forced off.
  is_mechanic INTEGER NOT NULL DEFAULT 0,

  -- Action permissions (initial set)
  can_create_lpos INTEGER NOT NULL DEFAULT 0,
  can_create_iprs INTEGER NOT NULL DEFAULT 0,
  can_finalize_lpos INTEGER NOT NULL DEFAULT 0,
  can_finalize_iprs INTEGER NOT NULL DEFAULT 0,
  can_approve_lpo_ipr INTEGER NOT NULL DEFAULT 0,
  can_assign_lpo_ipr_receivers INTEGER NOT NULL DEFAULT 0,
  can_record_invoice_payments INTEGER NOT NULL DEFAULT 0,
  can_record_supplier_payments INTEGER NOT NULL DEFAULT 0,

  -- Management / view permissions
  can_manage_team_members INTEGER NOT NULL DEFAULT 0,
  can_view_lpo_ipr INTEGER NOT NULL DEFAULT 1,
  can_view_stores INTEGER NOT NULL DEFAULT 1,
  can_log_test_drives INTEGER NOT NULL DEFAULT 1,

  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

-- Admin sessions (token-based)
CREATE TABLE IF NOT EXISTS admin_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  admin_user_id INTEGER NOT NULL REFERENCES admin_users(id) ON DELETE CASCADE,
  token TEXT NOT NULL UNIQUE,
  created_at TEXT DEFAULT (datetime('now')),
  expires_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_admin_sessions_admin ON admin_sessions(admin_user_id);

-- Workshop-wide settings (key/value)
CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY,
  value_real REAL,
  updated_at TEXT DEFAULT (datetime('now'))
);
INSERT OR IGNORE INTO app_settings (key, value_real) VALUES ('average_labour_cost_per_hour', 0);

-- Suppliers (before stock_items for FK)
CREATE TABLE IF NOT EXISTS suppliers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  address TEXT,
  pin TEXT,
  notes TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

-- Stock / Inventory
CREATE TABLE IF NOT EXISTS stock_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT,
  name TEXT NOT NULL,
  description TEXT,
  quantity REAL DEFAULT 0,
  unit TEXT DEFAULT 'each',
  reorder_level REAL DEFAULT 0,
  cost_price REAL DEFAULT 0,
  sell_price REAL DEFAULT 0,
  supplier_id INTEGER REFERENCES suppliers(id),
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

-- Jobs (vehicle = which car; customer_id = bill-to / who we invoice)
CREATE TABLE IF NOT EXISTS jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job_number TEXT UNIQUE,
  vehicle_id INTEGER NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  customer_id INTEGER REFERENCES customers(id) ON DELETE SET NULL,
  job_type_id INTEGER REFERENCES job_types(id),
  status TEXT DEFAULT 'in_progress', -- in_progress, vehicle_released, completed, cancelled
  description TEXT,
  notes TEXT,
  odometer_in INTEGER,
  odometer_out INTEGER,
  fuel_in TEXT,
  fuel_out TEXT,
  valuables_in_vehicle TEXT,
  due_date TEXT,
  completed_at TEXT,
  vehicle_released_at TEXT,
  customer_rating INTEGER,
  customer_feedback TEXT,
  labour_hours_frozen REAL,
  labour_rate_frozen REAL,
  labour_cost_frozen REAL,
  quote_prepared_at TEXT,
  is_repeat_job INTEGER NOT NULL DEFAULT 0,
  related_job_id INTEGER REFERENCES jobs(id) ON DELETE SET NULL,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

-- Tasks for a job (e.g. "Check shock absorbers", "Respray the car")
CREATE TABLE IF NOT EXISTS job_tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  description TEXT NOT NULL,
  sort_order INTEGER DEFAULT 0,
  completed INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS job_test_drives (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  admin_user_id INTEGER REFERENCES admin_users(id),
  odometer INTEGER NOT NULL,
  fuel TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

-- Team member time entries against jobs
CREATE TABLE IF NOT EXISTS job_time_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  admin_user_id INTEGER NOT NULL REFERENCES admin_users(id),
  hours REAL NOT NULL,
  notes TEXT,
  worked_at TEXT NOT NULL DEFAULT (datetime('now')),
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_job_time_logs_job ON job_time_logs(job_id);

-- Bookings (diary)
CREATE TABLE IF NOT EXISTS bookings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  vehicle_id INTEGER NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  job_id INTEGER REFERENCES jobs(id),
  start_at TEXT NOT NULL,
  end_at TEXT NOT NULL,
  status TEXT DEFAULT 'scheduled', -- scheduled, confirmed, arrived, completed, no_show, cancelled
  notes TEXT,
  reminder_sent INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

-- Invoices / Quotes
CREATE TABLE IF NOT EXISTS invoices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  invoice_number TEXT UNIQUE,
  job_id INTEGER REFERENCES jobs(id),
  customer_id INTEGER NOT NULL REFERENCES customers(id),
  vehicle_id INTEGER REFERENCES vehicles(id),
  type TEXT NOT NULL, -- quote, invoice
  status TEXT DEFAULT 'draft', -- draft, sent, paid, overdue, cancelled
  subtotal REAL DEFAULT 0,
  tax_rate REAL DEFAULT 0,
  tax_amount REAL DEFAULT 0,
  total REAL DEFAULT 0,
  due_date TEXT,
  paid_at TEXT,
  notes TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

-- Invoice line items (unit_price = sale price to customer; purchase_price = cost from supplier)
CREATE TABLE IF NOT EXISTS invoice_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  invoice_id INTEGER NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  description TEXT NOT NULL,
  quantity REAL DEFAULT 1,
  unit_price REAL NOT NULL,
  purchase_price REAL DEFAULT 0,
  type TEXT DEFAULT 'labour', -- labour, part, other
  stock_item_id INTEGER REFERENCES stock_items(id),
  approved INTEGER DEFAULT 0,
  lpo_ref TEXT,
  ipr_ref TEXT,
  supplier_id INTEGER REFERENCES suppliers(id),
  created_at TEXT DEFAULT (datetime('now'))
);

-- Payments to suppliers (reduces amount owed for LPO / purchase costs)
CREATE TABLE IF NOT EXISTS supplier_payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  supplier_id INTEGER NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
  amount REAL NOT NULL,
  paid_at TEXT NOT NULL DEFAULT (datetime('now')),
  notes TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_supplier_payments_supplier ON supplier_payments(supplier_id);

-- LPO documents: one supplier per LPO; lines allocate supplier costs to invoice line items
CREATE TABLE IF NOT EXISTS lpos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  invoice_id INTEGER REFERENCES invoices(id) ON DELETE CASCADE,
  supplier_id INTEGER NOT NULL REFERENCES suppliers(id),
  ref TEXT NOT NULL,
  notes TEXT,
  approved INTEGER NOT NULL DEFAULT 0,
  approved_at TEXT,
  approved_by_admin_user_id INTEGER REFERENCES admin_users(id),
  finalized INTEGER NOT NULL DEFAULT 0,
  public_verify_token TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_lpos_invoice ON lpos(invoice_id);
CREATE INDEX IF NOT EXISTS idx_lpos_supplier ON lpos(supplier_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_lpos_public_verify_token ON lpos(public_verify_token);

CREATE TABLE IF NOT EXISTS lpo_lines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  lpo_id INTEGER NOT NULL REFERENCES lpos(id) ON DELETE CASCADE,
  invoice_item_id INTEGER REFERENCES invoice_items(id) ON DELETE CASCADE,
  stock_item_id INTEGER REFERENCES stock_items(id),
  description TEXT NOT NULL,
  quantity REAL NOT NULL DEFAULT 1,
  unit_cost REAL NOT NULL DEFAULT 0,
  vat_rate REAL NOT NULL DEFAULT 0,
  vat_exempt INTEGER NOT NULL DEFAULT 0,
  assigned_admin_user_id INTEGER REFERENCES admin_users(id),
  received_confirmed INTEGER NOT NULL DEFAULT 0,
  received_confirmed_at TEXT,
  received_confirmed_by_admin_user_id INTEGER REFERENCES admin_users(id),
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_lpo_lines_lpo ON lpo_lines(lpo_id);
CREATE INDEX IF NOT EXISTS idx_lpo_lines_invoice_item ON lpo_lines(invoice_item_id);

-- Internal requisitions (stock issued to invoice lines); draft until finalised
CREATE TABLE IF NOT EXISTS iprs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  invoice_id INTEGER NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  ref TEXT NOT NULL,
  notes TEXT,
  approved INTEGER NOT NULL DEFAULT 0,
  approved_at TEXT,
  approved_by_admin_user_id INTEGER REFERENCES admin_users(id),
  finalized INTEGER NOT NULL DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_iprs_invoice ON iprs(invoice_id);

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
  assigned_admin_user_id INTEGER REFERENCES admin_users(id),
  received_confirmed INTEGER NOT NULL DEFAULT 0,
  received_confirmed_at TEXT,
  received_confirmed_by_admin_user_id INTEGER REFERENCES admin_users(id),
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_ipr_lines_ipr ON ipr_lines(ipr_id);
CREATE INDEX IF NOT EXISTS idx_ipr_lines_invoice_item ON ipr_lines(invoice_item_id);

-- Payments against invoices (deposits and instalments); not used for quotes
CREATE TABLE IF NOT EXISTS invoice_payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  invoice_id INTEGER NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  amount REAL NOT NULL,
  paid_at TEXT NOT NULL DEFAULT (datetime('now')),
  notes TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_invoice_payments_invoice ON invoice_payments(invoice_id);

-- Job parts (parts used on a job - links job to stock)
CREATE TABLE IF NOT EXISTS job_parts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  stock_item_id INTEGER NOT NULL REFERENCES stock_items(id),
  quantity REAL NOT NULL DEFAULT 1,
  unit_price REAL,
  notes TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

-- Indexes for search and joins
CREATE INDEX IF NOT EXISTS idx_vehicles_customer ON vehicles(customer_id);
CREATE INDEX IF NOT EXISTS idx_jobs_vehicle ON jobs(vehicle_id);
CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);
CREATE INDEX IF NOT EXISTS idx_job_tasks_job ON job_tasks(job_id);
CREATE INDEX IF NOT EXISTS idx_job_test_drives_job ON job_test_drives(job_id);
CREATE INDEX IF NOT EXISTS idx_bookings_start ON bookings(start_at);
CREATE INDEX IF NOT EXISTS idx_invoices_job ON invoices(job_id);
CREATE INDEX IF NOT EXISTS idx_invoices_customer ON invoices(customer_id);
CREATE INDEX IF NOT EXISTS idx_job_parts_job ON job_parts(job_id);
