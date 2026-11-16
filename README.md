# Clinic Care

A clinic management system for small clinics: patient records, appointments, a live waiting room, triage, consultations with prescriptions, billing (cash, M-Pesa, SHA, insurance) and a staff duty roster.

> **Status: early version.** It works end to end, but it hasn't been through a security review or a clinical pilot yet. Don't use it for real patients until it has. See [Before going live](#before-going-live).

## Features

- **Sign-in with roles:** administrator, front desk, nurse and clinician each see only what their role allows. Every rule is enforced on the server.
- **Patients:** registration with allergies, conditions, next of kin and SHA/insurance details. Records are archived, never deleted.
- **Appointments:** day schedule, walk-ins, check-in, and double-booking prevention.
- **Waiting room:** check-in → triage → consultation, with waiting times.
- **Triage:** vital signs with automatic flags for abnormal and critical readings.
- **Consultations:** complaint, findings, ICD-10 diagnosis and plan. Prescriptions are checked against the patient's allergies. Notes can be amended, and the earlier version is always kept.
- **Billing:** invoices are created automatically from each consultation, with partial payments, M-Pesa code checks and printable receipts.
- **Audit log:** every sign-in and every change is recorded with who did it and when.

## Demo version (no server)

`demo/` is a standalone copy of the app that needs no server or database: open `demo/index.html` in a browser, or host the folder anywhere static (Netlify serves it by default, see `netlify.toml`). It has no sign-in; use **View as** in the account menu to try each role. Data is saved only in that browser, so it's for demonstrations, not for a real clinic.

## Requirements

- [Node.js](https://nodejs.org) 22.9 or newer
- [PostgreSQL](https://www.postgresql.org/download/) 13 or newer

## Setup

1. **Create the database** (Linux; on Windows use pgAdmin or the SQL Shell):
   ```bash
   sudo -u postgres psql -c "CREATE USER clinic_care WITH PASSWORD 'choose-a-strong-password';"
   sudo -u postgres createdb -O clinic_care clinic_care
   ```

2. **Install and configure:**
   ```bash
   npm install
   cp .env.example .env
   ```
   Edit `.env` and put your database password in `DATABASE_URL`.

3. **Create the tables and first accounts:**
   ```bash
   npm run setup              # with demo patients
   npm run setup -- --no-demo # without demo data, for real use
   ```
   This prints a one-time password for each account (`alex`, `faith`, `peter`, `james`, `sarah`). Save them.

4. **Start the server:**
   ```bash
   npm start
   ```
   Then open http://localhost:3000.

To change a password: `npm run password -- <username>`.

To let other computers on the clinic network connect, set `HOST=0.0.0.0` in `.env` and open `http://<this-computer's-IP>:3000` on them.

## Project layout

```
public/          The web app (HTML, CSS, JavaScript) served to the browser
  shared.js      Reference data and rules used by both browser and server
  data.js        Talks to the API
  app.js         Screens and interactions
server/
  index.js       Express server and API routing
  auth.js        Passwords, sessions, role checks
  schema.sql     Database tables
  setup.js       Creates tables, accounts and demo data
  routes/        API endpoints by area
scripts/         Admin tools (set password)
```

## Before going live

- Serve over **HTTPS** and set `NODE_ENV=production`.
- Set up **automatic, encrypted, off-site database backups**, and test restoring them.
- Replace the demo **prices and medicine list** in `public/shared.js`.
- Register with the **ODPC** as a data controller (Kenya Data Protection Act 2019). Health data is sensitive personal data.
- Run a **pilot** alongside paper records before switching over.
