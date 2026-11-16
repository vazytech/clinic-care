// Booking, rescheduling, check-in and status changes.

const router = require('express').Router();
const { tx, audit, HttpError } = require('../db');
const { requirePerm } = require('../auth');
const { text, oneOf, date, time } = require('../validate');
const { STATUSES, inWaitingRoom, todayISO, nowHHMM } = require('../../public/shared');

const APPT_COLUMNS = `id, patient_id AS "patientId", date, time, doctor, type, status, arrived_at AS "arrivedAt"`;

async function getAppointment(db, id) {
  const { rows } = await db.query(`SELECT ${APPT_COLUMNS} FROM appointments WHERE id = $1 FOR UPDATE`, [id]);
  if (!rows[0]) throw new HttpError(404, 'That appointment could not be found.');
  return rows[0];
}

async function markVisited(db, patientId, visitDate) {
  await db.query(
    'UPDATE patients SET last_visit = GREATEST(coalesce(last_visit, $2::date), $2::date) WHERE id = $1',
    [patientId, visitDate]
  );
}

// Applies a status change with the same rules the screens show: arriving records the
// arrival time; leaving the waiting room any way other than completing clears it.
async function changeStatus(db, appt, status) {
  if (status === appt.status) return;
  let arrivedAt = appt.arrivedAt;
  if (inWaitingRoom({ status }) && !inWaitingRoom(appt)) arrivedAt = appt.date === todayISO() ? nowHHMM() : appt.time;
  if (!inWaitingRoom({ status }) && status !== 'Completed') arrivedAt = null;
  await db.query('UPDATE appointments SET status = $2, arrived_at = $3 WHERE id = $1', [appt.id, status, arrivedAt]);
  if (status === 'Checked in' || status === 'Completed') await markVisited(db, appt.patientId, appt.date);
}

async function checkPatient(db, patientId) {
  const { rows } = await db.query('SELECT archived FROM patients WHERE id = $1', [patientId]);
  if (!rows[0]) throw new HttpError(400, 'Choose a valid patient.');
  if (rows[0].archived) throw new HttpError(400, 'That patient is archived. Restore them before booking.');
}

async function checkPractitioner(db, name) {
  const { rows } = await db.query('SELECT 1 FROM team_members WHERE name = $1', [name]);
  if (!rows[0]) throw new HttpError(400, 'Choose a valid practitioner.');
}

function bookingInput(body) {
  return {
    patientId: text(body.patientId, 'patient', { required: true, max: 20 }),
    date: date(body.date, 'date'),
    time: time(body.time),
    doctor: text(body.doctor, 'practitioner', { required: true, max: 120 }),
    type: text(body.type, 'appointment type', { required: true, max: 120 })
  };
}

router.post('/appointments', requirePerm('appointments.edit'), async (req, res) => {
  const b = bookingInput(req.body);
  const id = await tx(async db => {
    await checkPatient(db, b.patientId);
    await checkPractitioner(db, b.doctor);
    const { rows } = await db.query(
      `INSERT INTO appointments (patient_id, date, time, doctor, type, status) VALUES ($1, $2, $3, $4, $5, 'Confirmed') RETURNING id`,
      [b.patientId, b.date, b.time, b.doctor, b.type]
    );
    await audit(db, req.user.id, 'appointment.create', 'appointment', rows[0].id, b);
    return rows[0].id;
  });
  res.status(201).json({ id });
});

router.put('/appointments/:id', requirePerm('appointments.edit'), async (req, res) => {
  const b = bookingInput(req.body);
  const status = oneOf(req.body.status, STATUSES, 'status');
  await tx(async db => {
    const appt = await getAppointment(db, req.params.id);
    if (b.patientId !== appt.patientId) await checkPatient(db, b.patientId);
    await checkPractitioner(db, b.doctor);
    await db.query('UPDATE appointments SET patient_id = $2, date = $3, time = $4, doctor = $5, type = $6 WHERE id = $1',
      [appt.id, b.patientId, b.date, b.time, b.doctor, b.type]);
    await changeStatus(db, { ...appt, ...b }, status);
    await audit(db, req.user.id, 'appointment.update', 'appointment', appt.id, { ...b, status });
  });
  res.json({ ok: true });
});

router.post('/appointments/:id/status', requirePerm('appointments.edit'), async (req, res) => {
  const status = oneOf(req.body.status, STATUSES, 'status');
  await tx(async db => {
    const appt = await getAppointment(db, req.params.id);
    await changeStatus(db, appt, status);
    await audit(db, req.user.id, 'appointment.status', 'appointment', appt.id, { from: appt.status, to: status });
  });
  res.json({ ok: true });
});

router.post('/appointments/walk-in', requirePerm('appointments.edit'), async (req, res) => {
  const patientId = text(req.body.patientId, 'patient', { required: true, max: 20 });
  const doctor = text(req.body.doctor, 'practitioner', { required: true, max: 120 });
  const type = text(req.body.type, 'reason for visit', { required: true, max: 120 });
  const id = await tx(async db => {
    await checkPatient(db, patientId);
    await checkPractitioner(db, doctor);
    const now = nowHHMM();
    const { rows } = await db.query(
      `INSERT INTO appointments (patient_id, date, time, doctor, type, status, arrived_at, walk_in)
       VALUES ($1, CURRENT_DATE, $2, $3, $4, 'Checked in', $2, true) RETURNING id`,
      [patientId, now, doctor, type]
    );
    await markVisited(db, patientId, todayISO());
    await audit(db, req.user.id, 'appointment.walk_in', 'appointment', rows[0].id, { patientId, doctor, type });
    return rows[0].id;
  });
  res.status(201).json({ id });
});

module.exports = { router, getAppointment, changeStatus, markVisited };
