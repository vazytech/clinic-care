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

## Staff accounts

- The first accounts come from the setup command (see below).
- New staff can click **"New staff member? Request an account"** on the sign-in screen. The request stays **pending**, with no access at all, until an administrator approves it.
- Administrators see waiting requests in **notifications** and on the **Care team** page. There they **choose the role** (front desk, nurse, clinician or administrator) and approve, or reject the request.
- Rejected requests can't sign in, and their username stays reserved. At most 20 requests can wait at once, to limit spam.

## Demo version (no server)

`demo/` is a standalone copy of the app that needs no server or database: open `demo/index.html` in a browser, or copy the folder to any computer. It has no sign-in; use **View as** in the account menu to try each role. Data is saved only in that browser, so it's for demonstrations, not for a real clinic.

## Requirements

- [Node.js](https://nodejs.org) 22.9 or newer
- [PostgreSQL](https://www.postgresql.org/download/) 13 or newer

## Setup

### Windows (PowerShell)

To run the standalone demo without a server or database:

```powershell
cd "C:\Users\HELLO\Desktop\clinic\clinic-care"
Start-Process .\demo\index.html
```

To run the backend and the real frontend together, first install Node.js 22.9+ and PostgreSQL 13+. In pgAdmin's Query Tool connected to the `postgres` database, run these statements separately (or enter them in the PostgreSQL SQL Shell):

```sql
CREATE USER clinic_care WITH PASSWORD 'choose-a-strong-password';
CREATE DATABASE clinic_care OWNER clinic_care;
```

Then in PowerShell:

```powershell
cd "C:\Users\HELLO\Desktop\clinic\clinic-care"
npm install
Copy-Item .env.example .env
notepad .env
```

In `.env`, set `DATABASE_URL` to `postgresql://clinic_care:choose-a-strong-password@localhost:5432/clinic_care`, replacing the example password with the one you chose. Then initialize and start the app:

```powershell
npm run setup
npm start
```

`npm run setup` prints one-time passwords for the first staff accounts; save them. Open http://localhost:3000. The backend serves the real frontend from `public/`; no separate frontend command is needed. For automatic server restarts while developing, use `npm run dev` instead of `npm start`.

### Linux

1. **Create the database:**
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
   This prints a one-time password for each account (`anna`, `faith`, `peter`, `james`, `sarah`; `anna` is the administrator). Save them.

4. **Start the server:**
   ```bash
   npm start
   ```
   Then open http://localhost:3000.

To change a password: `npm run password -- <username>`.

To let other computers on the clinic network connect, set `HOST=0.0.0.0` in `.env` and open `http://<this-computer's-IP>:3000` on them.

## Use it on the clinic's network (no internet needed)

Everything runs on one computer, with nothing online: no hosting service and no cloud database. The fonts are bundled too.

To let other computers in the clinic use it over the local network (Wi-Fi or cable):

1. In `.env`, set `HOST=0.0.0.0`, then restart with `npm start`.
2. Find this computer's local IP address: `hostname -I` on Linux, `ipconfig` on Windows. It looks like `192.168.1.20`.
3. On the other computers, open `http://192.168.1.20:3000` in a browser.

If a firewall prompt appears, allow access on **private** networks only.

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
