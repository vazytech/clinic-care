// Patient registration, editing, archiving.

const router = require('express').Router();
const { tx, audit, HttpError } = require('../db');
const { requirePerm } = require('../auth');
const { text, oneOf, date } = require('../validate');
const { SEXES, PAYERS, roleCan } = require('../../public/shared');

function patientInput(body) {
  const p = {
    name: text(body.name, 'patient’s name', { required: true, max: 120 }),
    sex: oneOf(body.sex, SEXES, 'sex'),
    dob: date(body.dob, 'date of birth', { required: false, notFuture: true }),
    phone: text(body.phone, 'phone number', { max: 40 }),
    nationalId: text(body.nationalId, 'national ID', { max: 40 }),
    allergies: text(body.allergies, 'allergies', { max: 300 }),
    conditions: text(body.conditions, 'conditions', { max: 300 }),
    kinName: text(body.kinName, 'next of kin', { max: 120 }),
    kinPhone: text(body.kinPhone, 'next of kin phone', { max: 40 }),
    payer: oneOf(body.payer, PAYERS, 'payer'),
    memberNo: text(body.memberNo, 'member number', { max: 60 })
  };
  if (p.payer !== 'Cash' && !p.memberNo) throw new HttpError(400, `Enter the ${p.payer} member number, or set the payer to Cash.`);
  return p;
}

// Same name is allowed (common in practice); same name *and* birth date is almost certainly a duplicate.
async function checkDuplicate(db, p, exceptId) {
  if (!p.dob) return;
  const { rows } = await db.query(
    'SELECT id, name FROM patients WHERE lower(name) = lower($1) AND dob = $2 AND id <> $3',
    [p.name, p.dob, exceptId ?? '']
  );
  if (rows[0]) throw new HttpError(409, `${rows[0].name} (${rows[0].id}) is already registered with that date of birth.`);
}

router.post('/patients', requirePerm('patients.edit'), async (req, res) => {
  const p = patientInput(req.body);
  // Staff who can't see clinical details can't set them either.
  if (!roleCan(req.user.role, 'clinical.view')) p.conditions = '';
  const id = await tx(async db => {
    await checkDuplicate(db, p, null);
    const { rows } = await db.query(
      `INSERT INTO patients (name, sex, dob, phone, national_id, allergies, conditions, kin_name, kin_phone, payer, member_no)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING id`,
      [p.name, p.sex, p.dob, p.phone, p.nationalId, p.allergies, p.conditions, p.kinName, p.kinPhone, p.payer, p.memberNo]
    );
    await audit(db, req.user.id, 'patient.create', 'patient', rows[0].id);
    return rows[0].id;
  });
  res.status(201).json({ id });
});

router.put('/patients/:id', requirePerm('patients.edit'), async (req, res) => {
  const p = patientInput(req.body);
  const clinical = roleCan(req.user.role, 'clinical.view');
  await tx(async db => {
    await checkDuplicate(db, p, req.params.id);
    const { rowCount } = await db.query(
      `UPDATE patients SET name = $2, sex = $3, dob = $4, phone = $5, national_id = $6, allergies = $7,
         ${clinical ? 'conditions = $12,' : ''} kin_name = $8, kin_phone = $9, payer = $10, member_no = $11, updated_at = now()
       WHERE id = $1`,
      [req.params.id, p.name, p.sex, p.dob, p.phone, p.nationalId, p.allergies, p.kinName, p.kinPhone, p.payer, p.memberNo,
        ...(clinical ? [p.conditions] : [])]
    );
    if (!rowCount) throw new HttpError(404, 'That patient record could not be found.');
    await audit(db, req.user.id, 'patient.update', 'patient', req.params.id);
  });
  res.json({ id: req.params.id });
});

router.post('/patients/:id/archive', requirePerm('patients.archive'), async (req, res) => {
  const cancelled = await tx(async db => {
    const { rowCount } = await db.query('UPDATE patients SET archived = true, updated_at = now() WHERE id = $1', [req.params.id]);
    if (!rowCount) throw new HttpError(404, 'That patient record could not be found.');
    const { rows } = await db.query(
      `UPDATE appointments SET status = 'Cancelled', arrived_at = NULL
       WHERE patient_id = $1 AND date >= CURRENT_DATE AND status = 'Confirmed' RETURNING id`,
      [req.params.id]
    );
    await audit(db, req.user.id, 'patient.archive', 'patient', req.params.id, { cancelledAppointments: rows.length });
    return rows.length;
  });
  res.json({ cancelled });
});

router.post('/patients/:id/restore', requirePerm('patients.archive'), async (req, res) => {
  await tx(async db => {
    const { rowCount } = await db.query('UPDATE patients SET archived = false, updated_at = now() WHERE id = $1', [req.params.id]);
    if (!rowCount) throw new HttpError(404, 'That patient record could not be found.');
    await audit(db, req.user.id, 'patient.restore', 'patient', req.params.id);
  });
  res.json({ ok: true });
});

module.exports = router;
