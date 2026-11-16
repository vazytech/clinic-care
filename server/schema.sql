-- Clinic Care database schema (PostgreSQL 13+).
-- Safe to run repeatedly: every statement only creates what is missing.

CREATE TABLE IF NOT EXISTS users (
  id            serial PRIMARY KEY,
  username      text NOT NULL UNIQUE,
  name          text NOT NULL,
  role          text NOT NULL CHECK (role IN ('admin', 'reception', 'nurse', 'doctor')),
  password_hash text NOT NULL,
  active        boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- Only a hash of the session token is stored, so a database leak doesn't expose live sessions.
CREATE TABLE IF NOT EXISTS sessions (
  token_hash text PRIMARY KEY,
  user_id    integer NOT NULL REFERENCES users ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS team_members (
  id   serial PRIMARY KEY,
  name text NOT NULL UNIQUE,
  role text NOT NULL,
  days integer[] NOT NULL DEFAULT '{1,2,3,4,5}'   -- weekly roster, 0 = Sunday
);

CREATE TABLE IF NOT EXISTS team_away (
  member_id integer NOT NULL REFERENCES team_members ON DELETE CASCADE,
  date      date NOT NULL,
  PRIMARY KEY (member_id, date)
);

CREATE SEQUENCE IF NOT EXISTS patient_number_seq;

CREATE TABLE IF NOT EXISTS patients (
  id          text PRIMARY KEY DEFAULT ('CC-' || lpad(nextval('patient_number_seq')::text, 4, '0')),
  name        text NOT NULL,
  sex         text NOT NULL,
  dob         date,
  phone       text NOT NULL DEFAULT '',
  national_id text NOT NULL DEFAULT '',
  allergies   text NOT NULL DEFAULT '',
  conditions  text NOT NULL DEFAULT '',
  kin_name    text NOT NULL DEFAULT '',
  kin_phone   text NOT NULL DEFAULT '',
  payer       text NOT NULL DEFAULT 'Cash',
  member_no   text NOT NULL DEFAULT '',
  visit       text NOT NULL DEFAULT '—',
  last_visit  date,
  registered  date NOT NULL DEFAULT CURRENT_DATE,
  archived    boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS appointments (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id text NOT NULL REFERENCES patients,
  date       date NOT NULL,
  time       text NOT NULL CHECK (time ~ '^[0-2][0-9]:[0-5][0-9]$'),
  doctor     text NOT NULL,
  type       text NOT NULL,
  status     text NOT NULL CHECK (status IN ('Confirmed', 'Checked in', 'Waiting', 'Completed', 'Cancelled')),
  arrived_at text,
  walk_in    boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
-- A practitioner can't have two live appointments at the same time.
CREATE UNIQUE INDEX IF NOT EXISTS appointments_no_double_booking
  ON appointments (doctor, date, time) WHERE status <> 'Cancelled';
CREATE INDEX IF NOT EXISTS appointments_date ON appointments (date);

CREATE TABLE IF NOT EXISTS vitals (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id     text NOT NULL REFERENCES patients,
  appointment_id uuid REFERENCES appointments,
  recorded_at    timestamptz NOT NULL DEFAULT now(),
  recorded_by    integer REFERENCES users,
  sys integer, dia integer, temp numeric(4,1), pulse integer, resp integer, spo2 integer,
  weight numeric(5,1), height numeric(5,1)
);

CREATE TABLE IF NOT EXISTS notes (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id     text NOT NULL REFERENCES patients,
  appointment_id uuid REFERENCES appointments,
  date           date NOT NULL DEFAULT CURRENT_DATE,
  type           text NOT NULL,
  complaint      text NOT NULL DEFAULT '',
  findings       text NOT NULL DEFAULT '',
  diagnosis      text NOT NULL DEFAULT '',
  plan           text NOT NULL DEFAULT '',
  author_id      integer REFERENCES users,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS prescriptions (
  id      serial PRIMARY KEY,
  note_id uuid NOT NULL REFERENCES notes ON DELETE CASCADE,
  drug    text NOT NULL,
  dose    numeric(5,1) NOT NULL,
  freq    text NOT NULL,
  days    integer NOT NULL,
  qty     integer NOT NULL
);

-- Notes are never edited in place without keeping the previous version here.
CREATE TABLE IF NOT EXISTS note_amendments (
  id         serial PRIMARY KEY,
  note_id    uuid NOT NULL REFERENCES notes ON DELETE CASCADE,
  amended_at timestamptz NOT NULL DEFAULT now(),
  amended_by integer REFERENCES users,
  reason     text NOT NULL,
  previous   jsonb NOT NULL
);

CREATE SEQUENCE IF NOT EXISTS invoice_number_seq;

CREATE TABLE IF NOT EXISTS invoices (
  id             text PRIMARY KEY DEFAULT ('INV-' || lpad(nextval('invoice_number_seq')::text, 4, '0')),
  patient_id     text NOT NULL REFERENCES patients,
  appointment_id uuid REFERENCES appointments,
  date           date NOT NULL DEFAULT CURRENT_DATE,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS invoice_items (
  id          serial PRIMARY KEY,
  invoice_id  text NOT NULL REFERENCES invoices ON DELETE CASCADE,
  description text NOT NULL,
  qty         integer NOT NULL CHECK (qty > 0),
  price       integer NOT NULL CHECK (price >= 0)
);

CREATE TABLE IF NOT EXISTS payments (
  id          serial PRIMARY KEY,
  invoice_id  text NOT NULL REFERENCES invoices ON DELETE CASCADE,
  method      text NOT NULL,
  amount      integer NOT NULL CHECK (amount > 0),
  ref         text NOT NULL DEFAULT '',
  paid_at     timestamptz NOT NULL DEFAULT now(),
  received_by integer REFERENCES users
);

-- Who did what, and when. Written for every change and every sign-in.
CREATE TABLE IF NOT EXISTS audit_log (
  id        bigserial PRIMARY KEY,
  at        timestamptz NOT NULL DEFAULT now(),
  user_id   integer REFERENCES users,
  action    text NOT NULL,
  entity    text,
  entity_id text,
  detail    jsonb
);
CREATE INDEX IF NOT EXISTS audit_log_entity ON audit_log (entity, entity_id);
