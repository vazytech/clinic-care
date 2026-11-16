// GET /api/bootstrap — everything the signed-in user's screens need, filtered by role.

const router = require('express').Router();
const { pool } = require('../db');
const { roleCan } = require('../../public/shared');

const STAMP = `'YYYY-MM-DD"T"HH24:MI:SS'`;

function groupBy(rows, key) {
  const map = new Map();
  for (const { [key]: k, ...rest } of rows) {
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(rest);
  }
  return map;
}

router.get('/bootstrap', async (req, res) => {
  const clinical = roleCan(req.user.role, 'clinical.view');
  const billing = roleCan(req.user.role, 'billing.view');

  const [patients, appointments, team] = await Promise.all([
    pool.query(`SELECT id, name, sex, dob, phone, national_id AS "nationalId", allergies,
        ${clinical ? 'conditions' : `'' AS conditions`}, kin_name AS "kinName", kin_phone AS "kinPhone",
        payer, member_no AS "memberNo", visit, last_visit AS "lastVisit", registered, archived
      FROM patients ORDER BY created_at DESC, id DESC`),
    pool.query(`SELECT id, patient_id AS "patientId", date, time, doctor, type, status,
        arrived_at AS "arrivedAt", walk_in AS "walkIn"
      FROM appointments ORDER BY date, time`),
    pool.query(`SELECT m.id, m.name, m.role, m.days,
        coalesce(array_agg(to_char(a.date, 'YYYY-MM-DD')) FILTER (WHERE a.date IS NOT NULL), '{}') AS away
      FROM team_members m LEFT JOIN team_away a ON a.member_id = m.id AND a.date >= CURRENT_DATE
      GROUP BY m.id ORDER BY m.id`)
  ]);

  const data = { patients: patients.rows, appointments: appointments.rows, team: team.rows, vitals: [], notes: [], invoices: [] };

  if (clinical) {
    const [vitals, notes, rx, amendments] = await Promise.all([
      pool.query(`SELECT v.id, v.patient_id AS "patientId", v.appointment_id AS "appointmentId",
          to_char(v.recorded_at, ${STAMP}) AS at, u.name AS by,
          v.sys, v.dia, v.temp, v.pulse, v.resp, v.spo2, v.weight, v.height
        FROM vitals v LEFT JOIN users u ON u.id = v.recorded_by`),
      pool.query(`SELECT n.id, n.patient_id AS "patientId", n.appointment_id AS "appointmentId", n.date, n.type,
          n.complaint, n.findings, n.diagnosis, n.plan, u.name AS author, to_char(n.created_at, ${STAMP}) AS "createdAt"
        FROM notes n LEFT JOIN users u ON u.id = n.author_id`),
      pool.query('SELECT note_id, drug, dose, freq, days, qty FROM prescriptions ORDER BY id'),
      pool.query(`SELECT a.note_id, to_char(a.amended_at, ${STAMP}) AS at, u.name AS by, a.reason, a.previous
        FROM note_amendments a LEFT JOIN users u ON u.id = a.amended_by ORDER BY a.id`)
    ]);
    const rxByNote = groupBy(rx.rows, 'note_id');
    const amendByNote = groupBy(amendments.rows, 'note_id');
    data.vitals = vitals.rows;
    data.notes = notes.rows.map(n => ({ ...n, prescriptions: rxByNote.get(n.id) ?? [], amendments: amendByNote.get(n.id) ?? [] }));
  }

  if (billing) {
    const [invoices, items, payments] = await Promise.all([
      pool.query(`SELECT id, patient_id AS "patientId", appointment_id AS "appointmentId", date FROM invoices ORDER BY id`),
      pool.query(`SELECT invoice_id, description AS "desc", qty, price FROM invoice_items ORDER BY id`),
      pool.query(`SELECT p.invoice_id, p.method, p.amount, p.ref, to_char(p.paid_at, ${STAMP}) AS at, u.name AS by
        FROM payments p LEFT JOIN users u ON u.id = p.received_by ORDER BY p.id`)
    ]);
    const itemsByInvoice = groupBy(items.rows, 'invoice_id');
    const paymentsByInvoice = groupBy(payments.rows, 'invoice_id');
    data.invoices = invoices.rows.map(i => ({ ...i, items: itemsByInvoice.get(i.id) ?? [], payments: paymentsByInvoice.get(i.id) ?? [] }));
  }

  res.json(data);
});

module.exports = router;
