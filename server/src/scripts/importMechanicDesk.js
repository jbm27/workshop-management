import path from 'path';
import { existsSync } from 'fs';
import { fileURLToPath } from 'url';
import xlsxPkg from 'xlsx';
import { initDb, db, dbPath } from '../db.js';

const xlsx = xlsxPkg.default || xlsxPkg;
const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Project root (workshop-management/), three levels above server/src/scripts */
const PROJECT_ROOT = path.join(__dirname, '..', '..', '..');
const DEFAULT_XLS = path.join(PROJECT_ROOT, 'MechanicDeskCustomerVehcileData.xls');

function normaliseString(value) {
  if (value == null || value === '') return '';
  return String(value).trim();
}

function buildAddress(row) {
  const parts = [
    normaliseString(row.Address || row['Street Address']),
    normaliseString(row.Suburb || row['Street Address Suburb']),
    normaliseString(row.State || row['Street Address State']),
    normaliseString(row.Postcode || row['Street Address Postcode']),
    normaliseString(row.Country),
  ].filter(Boolean);
  return parts.join(', ');
}

async function importMechanicDesk() {
  const wbPath = process.env.MECHANICDESK_XLS || DEFAULT_XLS;
  if (!existsSync(wbPath)) {
    console.error(`Excel file not found:\n  ${wbPath}\nSet MECHANICDESK_XLS or place MechanicDeskCustomerVehcileData.xls in the project root.`);
    process.exit(1);
  }

  await initDb();

  const workbook = xlsx.readFile(wbPath);
  const customerSheet = workbook.Sheets.Customers;
  const vehicleSheet = workbook.Sheets.Vehicles;
  const supplierSheet = workbook.Sheets.Suppliers;

  if (!customerSheet || !vehicleSheet) {
    console.error('Expected "Customers" and "Vehicles" sheets in the Excel file.');
    process.exit(1);
  }

  const customerRows = xlsx.utils.sheet_to_json(customerSheet, { defval: '' });
  const vehicleRows = xlsx.utils.sheet_to_json(vehicleSheet, { defval: '' });
  const supplierRows = supplierSheet ? xlsx.utils.sheet_to_json(supplierSheet, { defval: '' }) : [];

  const customerIdToDbId = new Map();
  let customersInserted = 0;
  let customersMatched = 0;

  console.log(`Importing ${customerRows.length} customers…`);

  for (const row of customerRows) {
    const extId = normaliseString(row['Customer ID']);
    const name = normaliseString(row.Name);
    const phone = normaliseString(row.Mobile || row.Phone);
    const email = normaliseString(row.Email);
    const address = buildAddress(row);
    const notes = normaliseString(row.Note);

    if (!extId || !name) continue;

    let existing = null;
    if (email) {
      existing = db.prepare('SELECT id FROM customers WHERE email = ?').get(email);
    }
    if (!existing && phone) {
      existing = db.prepare('SELECT id FROM customers WHERE phone = ?').get(phone);
    }
    if (!existing) {
      existing = db
        .prepare('SELECT id FROM customers WHERE name = ? AND (phone IS NULL OR phone = ?)')
        .get(name, phone || null);
    }

    let dbId;
    if (existing) {
      dbId = existing.id;
      customersMatched += 1;
    } else {
      const result = db
        .prepare(
          `INSERT INTO customers (name, email, phone, address, notes)
           VALUES (?, ?, ?, ?, ?)`,
        )
        .run(name, email || null, phone || null, address || null, notes || null);
      dbId = result.lastInsertRowid;
      customersInserted += 1;
    }

    customerIdToDbId.set(extId, dbId);
  }

  console.log(`Customers inserted: ${customersInserted}, matched to existing: ${customersMatched}`);

  let suppliersInserted = 0;
  let suppliersMatched = 0;
  let suppliersSkipped = 0;

  if (supplierRows.length) {
    console.log(`Importing ${supplierRows.length} suppliers…`);
    for (const row of supplierRows) {
      const name = normaliseString(row.Name);
      if (!name) {
        suppliersSkipped += 1;
        continue;
      }
      const phone = normaliseString(row.Mobile || row.Phone);
      const email = normaliseString(row.Email);
      const address = buildAddress(row);
      const pin = normaliseString(row.ABN);
      const contact = normaliseString(row['Contact Name']);
      const accNo = normaliseString(row['Acc. No']);
      const noteRaw = normaliseString(row.Note);
      const noteParts = [
        contact && `Contact: ${contact}`,
        accNo && `Acc. No: ${accNo}`,
        noteRaw,
      ].filter(Boolean);
      const notes = noteParts.length ? noteParts.join('\n') : null;

      let existing = null;
      if (email) {
        existing = db.prepare('SELECT id FROM suppliers WHERE email = ?').get(email);
      }
      if (!existing && phone) {
        existing = db.prepare('SELECT id FROM suppliers WHERE phone = ?').get(phone);
      }
      if (!existing) {
        existing = db
          .prepare('SELECT id FROM suppliers WHERE name = ? AND (phone IS NULL OR phone = ?)')
          .get(name, phone || null);
      }

      if (existing) {
        suppliersMatched += 1;
        continue;
      }

      db.prepare(
        `INSERT INTO suppliers (name, email, phone, address, pin, notes)
         VALUES (?, ?, ?, ?, ?, ?)`,
      ).run(name, email || null, phone || null, address || null, pin || null, notes);
      suppliersInserted += 1;
    }
    console.log(
      `Suppliers inserted: ${suppliersInserted}, matched to existing: ${suppliersMatched}, skipped (no name): ${suppliersSkipped}`,
    );
  } else {
    console.log('No Suppliers sheet or empty — skipping suppliers.');
  }

  let vehiclesInserted = 0;
  let vehiclesSkipped = 0;

  console.log(`Importing ${vehicleRows.length} vehicles…`);

  for (const row of vehicleRows) {
    const reg = normaliseString(row['Registration Number']);
    const make = normaliseString(row.Make);
    const model = normaliseString(row.Model);
    const year = parseInt(row.Year, 10) || null;
    const vin = normaliseString(row.VIN || row['Chassis Number']);
    const odometer = row.Odometer !== '' && row.Odometer != null ? parseInt(row.Odometer, 10) : null;
    const customerExtId = normaliseString(row['Customer ID']);
    const vehNotes = normaliseString(row.Note);
    const serviceNote = normaliseString(row['Service Note']);
    const extraNotes = [vehNotes, serviceNote && `Service: ${serviceNote}`].filter(Boolean);
    const notes = extraNotes.length ? extraNotes.join('\n') : null;

    if (!reg) {
      vehiclesSkipped += 1;
      continue;
    }

    const customerDbId = customerExtId ? customerIdToDbId.get(customerExtId) : null;

    const existingVehicle = db.prepare('SELECT id FROM vehicles WHERE registration = ?').get(reg);
    if (existingVehicle) {
      vehiclesSkipped += 1;
      continue;
    }

    db.prepare(
      `INSERT INTO vehicles (customer_id, registration, make, model, year, vin, odometer, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      customerDbId || null,
      reg,
      make || null,
      model || null,
      year,
      vin || null,
      Number.isFinite(odometer) ? odometer : null,
      notes,
    );
    vehiclesInserted += 1;
  }

  console.log(`Vehicles inserted: ${vehiclesInserted}, skipped (no reg / duplicate): ${vehiclesSkipped}`);
}

importMechanicDesk()
  .then(() => {
    console.log('MechanicDesk import complete.');
    console.log(`Data written to: ${dbPath}`);
    console.log(
      'If the workshop API is already running, restart it OR run (from server folder):\n' +
        '  npm run reload-db\n' +
        'so the API reloads workshop.db from disk (sql.js keeps data in memory until then).',
    );
    process.exit(0);
  })
  .catch((err) => {
    console.error('MechanicDesk import failed:', err);
    process.exit(1);
  });
