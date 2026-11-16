// Vitals, consultations (with prescriptions and billing) and note amendments.

const router = require('express').Router();
const { tx, audit, HttpError } = require('../db');
const { requirePerm } = require('../auth');
const { text, number } = require('../validate');
const { getAppointment, changeStatus, markVisited } = require('./appointments');
const {
  VITAL_LIMITS, FREQUENCIES, drugByName, prescriptionQty, allergyConflict, servicePrice, vitalFlags, todayISO
} = require('../../public/shared');

async function getPatient(db, id) {
  const { rows } = await db.query('SELECT id, name, allergies, archived FROM patients WHERE id = $1', [id]);
  if (!rows[0]) throw new HttpError(400, 'Choose a valid patient.');
  if (rows[0].archived) throw new HttpError(400, 'That patient is archived.');
  return rows[0];
}

async function patientAppointment(db, appointmentId, patientId) {
  if (!appointmentId) return null;
  const appt = await getAppointment(db, appointmentId);
  if (appt.patientId !== patientId) throw new HttpError(400, 'That appointment belongs to a different patient.');
  return appt;
}

router.post('/vitals', requirePerm('vitals.record'), async (req, res) => {
  const patientId = text(req.body.patientId, 'patient', { required: true, max: 20 });
  const labels = { sys: 'systolic BP', dia: 'diastolic BP', temp: 'temperature', pulse: 'pulse', resp: 'respiratory rate', spo2: 'SpO₂', weight: 'weight', height: 'height' };
  const v = {};
  for (const [key, range] of Object.entries(VITAL_LIMITS)) {
    v[key] = number(req.body[key], labels[key], range, { integer: !['temp', 'weight', 'height'].includes(key) });
  }
  if (!Object.entries(v).some(([k, val]) => k !== 'height' && val !== null)) throw new HttpError(400, 'Enter at least one measurement.');
  if ((v.sys === null) !== (v.dia === null)) throw new HttpError(400, 'Enter both systolic and diastolic blood pressure.');

  const result = await tx(async db => {
    await getPatient(db, patientId);
    const appt = await patientAppointment(db, req.body.appointmentId, patientId);
    const { rows } = await db.query(
      `INSERT INTO vitals (patient_id, appointment_id, recorded_by, sys, dia, temp, pulse, resp, spo2, weight, height)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING id`,
      [patientId, appt?.id ?? null, req.user.id, v.sys, v.dia, v.temp, v.pulse, v.resp, v.spo2, v.weight, v.height]
    );
    // Triage done: the patient is now ready for the clinician.
    if (appt?.status === 'Checked in') await changeStatus(db, appt, 'Waiting');
    await audit(db, req.user.id, 'vitals.record', 'patient', patientId, { vitalsId: rows[0].id });
    return { id: rows[0].id, flags: vitalFlags(v), readyForClinician: appt?.status === 'Checked in' };
  });
  res.status(201).json(result);
});

router.post('/consultations', requirePerm('notes.write'), async (req, res) => {
  const patientId = text(req.body.patientId, 'patient', { required: true, max: 20 });
  const note = {
    type: text(req.body.type, 'visit type', { required: true, max: 120 }),
    complaint: text(req.body.complaint, 'presenting complaint', { required: true, max: 4000 }),
    findings: text(req.body.findings, 'examination findings', { max: 4000 }),
    diagnosis: text(req.body.diagnosis, 'diagnosis', { required: true, max: 300 }),
    plan: text(req.body.plan, 'plan', { required: true, max: 4000 })
  };
  const lines = Array.isArray(req.body.prescriptions) ? req.body.prescriptions : [];
  if (lines.length > 20) throw new HttpError(400, 'Too many medicines on one prescription.');

  const result = await tx(async db => {
    const patient = await getPatient(db, patientId);
    const prescriptions = lines.map(line => {
      const drug = drugByName(line.drug);
      if (!drug) throw new HttpError(400, 'Choose medicines from the list.');
      if (!(line.freq in FREQUENCIES)) throw new HttpError(400, `Choose a valid frequency for ${drug.name}.`);
      const dose = number(line.dose, `dose of ${drug.name}`, [0.5, 20], { required: true });
      const days = number(line.days, `number of days for ${drug.name}`, [1, 365], { required: true, integer: true });
      // The server makes the final allergy check, whatever the browser did.
      const allergy = allergyConflict(patient, drug);
      if (allergy) throw new HttpError(400, `${patient.name} has a recorded allergy to ${allergy} — ${drug.name} is a ${drug.cls}. Remove it or choose another medicine.`);
      return { drug, dose, freq: line.freq, days, qty: prescriptionQty(drug, dose, line.freq, days) };
    });
    const appt = await patientAppointment(db, req.body.appointmentId, patientId);

    const { rows: [saved] } = await db.query(
      `INSERT INTO notes (patient_id, appointment_id, type, complaint, findings, diagnosis, plan, author_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
      [patientId, appt?.id ?? null, note.type, note.complaint, note.findings, note.diagnosis, note.plan, req.user.id]
    );
    for (const r of prescriptions) {
      await db.query('INSERT INTO prescriptions (note_id, drug, dose, freq, days, qty) VALUES ($1, $2, $3, $4, $5, $6)',
        [saved.id, r.drug.name, r.dose, r.freq, r.days, r.qty]);
    }
    await db.query('UPDATE patients SET visit = $2 WHERE id = $1', [patientId, note.type]);
    await markVisited(db, patientId, todayISO());
    if (appt) await changeStatus(db, appt, 'Completed');

    // Bill the visit and dispensed medicines, adding to this appointment's invoice if one exists.
    let invoiceId = appt && (await db.query('SELECT id FROM invoices WHERE appointment_id = $1', [appt.id])).rows[0]?.id;
    if (!invoiceId) {
      invoiceId = (await db.query('INSERT INTO invoices (patient_id, appointment_id) VALUES ($1, $2) RETURNING id', [patientId, appt?.id ?? null])).rows[0].id;
    }
    const items = [{ desc: note.type, qty: 1, price: servicePrice(note.type) }, ...prescriptions.map(r => ({ desc: r.drug.name, qty: r.qty, price: r.drug.price }))];
    for (const i of items) {
      await db.query('INSERT INTO invoice_items (invoice_id, description, qty, price) VALUES ($1, $2, $3, $4)', [invoiceId, i.desc, i.qty, i.price]);
    }
    const { rows: [{ balance }] } = await db.query(
      `SELECT ((SELECT coalesce(sum(qty * price), 0) FROM invoice_items WHERE invoice_id = $1)
             - (SELECT coalesce(sum(amount), 0) FROM payments WHERE invoice_id = $1))::int AS balance`, [invoiceId]);

    await audit(db, req.user.id, 'consultation.create', 'patient', patientId, { noteId: saved.id, invoiceId });
    return { noteId: saved.id, invoiceId, balance };
  });
  res.status(201).json(result);
});

router.post('/notes/:id/amend', requirePerm('notes.write'), async (req, res) => {
  const reason = text(req.body.reason, 'reason for amendment', { required: true, max: 300 });
  const next = {
    complaint: text(req.body.complaint, 'presenting complaint', { max: 4000 }),
    findings: text(req.body.findings, 'examination findings', { max: 4000 }),
    diagnosis: text(req.body.diagnosis, 'diagnosis', { max: 300 }),
    plan: text(req.body.plan, 'plan', { max: 4000 })
  };
  await tx(async db => {
    const { rows: [note] } = await db.query('SELECT id, patient_id, complaint, findings, diagnosis, plan FROM notes WHERE id = $1 FOR UPDATE', [req.params.id]);
    if (!note) throw new HttpError(404, 'That note could not be found.');
    const previous = { complaint: note.complaint, findings: note.findings, diagnosis: note.diagnosis, plan: note.plan };
    if (Object.keys(next).every(k => next[k] === previous[k])) throw new HttpError(400, 'Nothing has changed.');
    await db.query('INSERT INTO note_amendments (note_id, amended_by, reason, previous) VALUES ($1, $2, $3, $4)',
      [note.id, req.user.id, reason, previous]);
    await db.query('UPDATE notes SET complaint = $2, findings = $3, diagnosis = $4, plan = $5 WHERE id = $1',
      [note.id, next.complaint, next.findings, next.diagnosis, next.plan]);
    await audit(db, req.user.id, 'note.amend', 'patient', note.patient_id, { noteId: note.id, reason });
  });
  res.json({ ok: true });
});

module.exports = router;
