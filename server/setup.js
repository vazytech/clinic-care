// Creates the database tables and, on an empty database, the first user accounts.
//
//   npm run setup            tables + staff accounts + demo patients
//   npm run setup -- --no-demo   tables + staff accounts only (for real use)
//
// Prints a one-time password for each new account. Safe to run again: it never
// changes existing data.

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { pool, tx } = require('./db');
const { hashPassword } = require('./auth');
const { isoDate, localDate } = require('../public/shared');

const USERS = [
  { username: 'anna', name: 'Anna martin ', role: 'admin' },
  { username: 'faith', name: 'Faith Njeri', role: 'reception' },
  { username: 'peter', name: 'Peter Wambua', role: 'nurse' },
  { username: 'james', name: 'Dr. James Mwangi', role: 'doctor' },
  { username: 'sarah', name: 'Dr. Sarah Kimani', role: 'doctor' }
];

const TEAM = [
  ['Dr. James Mwangi', 'General practitioner', [1, 2, 3, 4, 5]],
  ['Dr. Sarah Kimani', 'Family medicine', [1, 2, 3, 4, 5]],
  ['Dr. Leah Otieno', 'Paediatrician', [1, 3, 5]],
  ['Peter Wambua', 'Registered nurse', [1, 2, 3, 4, 5, 6]],
  ['Dr. Brian Ochieng', 'Dental surgeon', [2, 4]],
  ['Grace Achieng', 'Clinical officer', [0, 6]]
];

async function seedDemo(db, userIds) {
  const day = offset => isoDate(localDate(offset));
  const patients = [
    ['Miriam Wekesa', 'Female', '1968-05-27', '+254 711 604 218', 'Sulfa drugs', 'Hypertension, Type 2 diabetes', '', '', 'SHA', 'SHA-0937716', -365],
    ['Noah Kiptoo', 'Male', '2002-10-09', '+254 722 913 057', '', '', '', '', 'Cash', '', -200],
    ['Zuri Mwende', 'Female', '2018-06-30', '+254 710 287 331', '', '', 'Agnes Mwende', '+254 710 287 330', 'SHA', 'SHA-1180274', -120],
    ['Peter Otieno', 'Male', '1975-02-11', '+254 733 410 285', 'Penicillin', '', 'Ruth Otieno', '+254 733 222 019', 'Cash', '', -40],
    ['Lila Wanjiku', 'Female', '1997-12-03', '+254 701 853 902', '', '', '', '', 'Cash', '', -6],
    ['David Kamau', 'Male', '1983-08-22', '+254 722 180 449', '', 'Hypertension', '', '', 'Private insurance', 'PI-88213', -4],
    ['Amara Njoroge', 'Female', '1991-04-16', '+254 712 345 678', '', '', 'Joseph Njoroge', '+254 712 000 111', 'SHA', 'SHA-4471023', -1]
  ];
  const ids = {};
  for (const [name, sex, dob, phone, allergies, conditions, kinName, kinPhone, payer, memberNo, registered] of patients) {
    const { rows } = await db.query(
      `INSERT INTO patients (name, sex, dob, phone, allergies, conditions, kin_name, kin_phone, payer, member_no, registered)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING id`,
      [name, sex, dob, phone, allergies, conditions, kinName, kinPhone, payer, memberNo, day(registered)]
    );
    ids[name] = rows[0].id;
  }

  const appt = async (name, offset, time, type, doctor, status, arrivedAt = null) => {
    const { rows } = await db.query(
      `INSERT INTO appointments (patient_id, date, time, doctor, type, status, arrived_at) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
      [ids[name], day(offset), time, doctor, type, status, arrivedAt]
    );
    if (arrivedAt) await db.query('UPDATE patients SET last_visit = $2 WHERE id = $1', [ids[name], day(offset)]);
    return rows[0].id;
  };
  const yesterday = await appt('Peter Otieno', -1, '14:00', 'General consultation', 'Dr. James Mwangi', 'Completed', '13:52');
  await appt('Amara Njoroge', 0, '09:00', 'General consultation', 'Dr. James Mwangi', 'Checked in', '08:54');
  await appt('Miriam Wekesa', 0, '09:15', 'Blood pressure check', 'Dr. Sarah Kimani', 'Checked in', '09:22');
  const david = await appt('David Kamau', 0, '09:30', 'Follow-up · Blood pressure', 'Dr. Sarah Kimani', 'Waiting', '09:18');
  await appt('Lila Wanjiku', 0, '10:15', 'Wellness check', 'Dr. Leah Otieno', 'Confirmed');
  await appt('Peter Otieno', 0, '11:00', 'General consultation', 'Dr. James Mwangi', 'Confirmed');
  await appt('Zuri Mwende', 0, '11:30', 'Vaccination', 'Peter Wambua', 'Confirmed');

  const vitals = `INSERT INTO vitals (patient_id, appointment_id, recorded_at, recorded_by, sys, dia, temp, pulse, resp, spo2, weight, height)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`;
  await db.query(vitals, [ids['David Kamau'], david, `${day(0)} 09:24`, userIds.peter, 148, 94, 36.7, 82, 16, 98, 88, 176]);
  await db.query(vitals, [ids['Peter Otieno'], yesterday, `${day(-1)} 13:58`, userIds.peter, 128, 82, 38.4, 96, 18, 97, 74, 171]);
  await db.query(vitals, [ids['Miriam Wekesa'], null, `${day(-30)} 10:05`, userIds.peter, 152, 96, 36.5, 78, 16, 97, 81, 163]);

  const { rows: [note] } = await db.query(
    `INSERT INTO notes (patient_id, appointment_id, date, type, complaint, findings, diagnosis, plan, author_id, created_at)
     VALUES ($1, $2, $3, 'General consultation', $4, $5, $6, $7, $8, $9) RETURNING id`,
    [ids['Peter Otieno'], yesterday, day(-1), 'Cough and fever for 3 days, sore throat.',
      'Temp 38.4 °C. Throat inflamed, chest clear on auscultation.', 'J06.9 Acute upper respiratory infection',
      'Symptomatic treatment, plenty of fluids. Return if not improving in 5 days or if breathing becomes difficult.',
      userIds.james, `${day(-1)} 14:20`]
  );
  await db.query(`INSERT INTO prescriptions (note_id, drug, dose, freq, days, qty) VALUES ($1, 'Paracetamol 500mg tab', 2, 'TDS', 5, 30)`, [note.id]);

  const { rows: [inv1] } = await db.query('INSERT INTO invoices (patient_id, appointment_id, date) VALUES ($1, $2, $3) RETURNING id', [ids['Peter Otieno'], yesterday, day(-1)]);
  await db.query(`INSERT INTO invoice_items (invoice_id, description, qty, price) VALUES ($1, 'General consultation', 1, 1000), ($1, 'Paracetamol 500mg tab', 30, 2)`, [inv1.id]);
  await db.query(`INSERT INTO payments (invoice_id, method, amount, ref, paid_at, received_by) VALUES ($1, 'M-Pesa', 1060, 'SKL4H7Q2RT', $2, $3)`, [inv1.id, `${day(-1)} 14:31`, userIds.faith]);

  const { rows: [inv2] } = await db.query('INSERT INTO invoices (patient_id, date) VALUES ($1, $2) RETURNING id', [ids['Noah Kiptoo'], day(-5)]);
  await db.query(`INSERT INTO invoice_items (invoice_id, description, qty, price) VALUES ($1, 'Dental check-up', 1, 1500)`, [inv2.id]);
  await db.query(`INSERT INTO payments (invoice_id, method, amount, paid_at, received_by) VALUES ($1, 'Cash', 500, $2, $3)`, [inv2.id, `${day(-5)} 11:10`, userIds.faith]);
}

async function main() {
  const demo = !process.argv.includes('--no-demo');
  await pool.query(fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8'));
  console.log('Tables are ready.');

  const { rows: [{ count }] } = await pool.query('SELECT count(*)::int AS count FROM users');
  if (count > 0) {
    console.log('Accounts already exist, so nothing else was changed.');
    return;
  }

  const passwords = [];
  await tx(async db => {
    const userIds = {};
    for (const u of USERS) {
      const password = crypto.randomBytes(9).toString('base64url');
      const { rows } = await db.query('INSERT INTO users (username, name, role, password_hash) VALUES ($1, $2, $3, $4) RETURNING id',
        [u.username, u.name, u.role, await hashPassword(password)]);
      userIds[u.username] = rows[0].id;
      passwords.push([u.username, u.name, password]);
    }
    for (const [name, role, days] of TEAM) {
      await db.query('INSERT INTO team_members (name, role, days) VALUES ($1, $2, $3)', [name, role, days]);
    }
    if (demo) await seedDemo(db, userIds);
  });

  console.log(demo ? 'Demo patients, appointments and invoices added.' : 'No demo data added.');
  console.log('\nSign-in accounts — save these passwords now, they will not be shown again:\n');
  for (const [username, name, password] of passwords) console.log(`  ${username.padEnd(8)} ${password}   (${name})`);
  console.log('\nChange a password any time with: npm run password -- <username>\n');
}

main()
  .catch(err => {
    console.error(err.message);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
