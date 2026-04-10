# Workshop Management – Chequered Flag

A workshop and garage management application inspired by MechanicDesk, tailored for **Chequered Flag** (chequeredflag.net) in Nairobi. Manage jobs, bookings, customers, vehicles, stock, and invoicing in one place.

## Features (MechanicDesk-style)

- **Booking diary** – Day/week/month views, drag-and-drop, reminders
- **Job management** – Job types (templates), job cards, link to invoices and parts
- **Customers & vehicles** – Full history, documents, search
- **Invoicing & quoting** – Quotes → jobs/invoices, customisable templates
- **Stock control** – Inventory, alerts, reorder levels
- **Suppliers** – Purchase orders, contact history
- **Reporting** – Sales, payments, work in progress

## Tech stack

- **Frontend:** React 18, Vite, React Router
- **Backend:** Node.js, Express
- **Database:** SQLite via **sql.js** (no native build – runs on Windows without Visual Studio)

## Quick start

### Prerequisites

- Node.js 18+
- npm or yarn

### Install and run

```bash
# From project root – install all
npm run install:all

# Create database (first time only)
cd server && npm run init-db && cd ..

# Terminal 1 – start API
cd server && npm run dev

# Terminal 2 – start frontend
cd client && npm run dev
```

- **Frontend:** http://localhost:5173  
- **API:** http://localhost:3001  

### One-command run (from project root)

```bash
npm run dev
```

Starts both server and client (requires `concurrently` or similar).

## Project structure

```
workshop-management/
├── client/                 # React frontend
│   ├── src/
│   │   ├── components/
│   │   ├── pages/
│   │   ├── hooks/
│   │   └── api/
├── server/                 # Express API
│   ├── db/                 # SQLite schema & seed
│   ├── routes/
│   └── middleware/
├── README.md
└── package.json
```

## Customisation

- **Business name / branding:** Edit `client/src` for “Chequered Flag” and your logo.
- **Currency / locale:** Set in `server/config.js` and frontend i18n/format helpers.
- **SMS/email reminders:** Add providers in `server/services/notifications.js` and wire to booking/job logic.
- **Extra fields:** Add columns or tables in `server/db/schema.sql` and run migrations; extend API and forms.

## License

Private use for Chequered Flag. Modify as needed for your workshop.
