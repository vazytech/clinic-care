// Invoices and payments.

const router = require('express').Router();
const { tx, audit, HttpError } = require('../db');
const { requirePerm } = require('../auth');
const { text, oneOf, number } = require('../validate');
const { SERVICE_PRICES, PAYMENT_METHODS } = require('../../public/shared');

router.post('/invoices', requirePerm('billing.view'), async (req, res) => {
  const patientId = text(req.body.patientId, 'patient', { required: true, max: 20 });
  const service = oneOf(req.body.service, Object.keys(SERVICE_PRICES), 'service');
  const qty = number(req.body.qty, 'quantity', [1, 50], { required: true, integer: true });
  const id = await tx(async db => {
    const { rows: [patient] } = await db.query('SELECT archived FROM patients WHERE id = $1', [patientId]);
    if (!patient) throw new HttpError(400, 'Choose a valid patient.');
    const { rows: [inv] } = await db.query('INSERT INTO invoices (patient_id) VALUES ($1) RETURNING id', [patientId]);
    await db.query('INSERT INTO invoice_items (invoice_id, description, qty, price) VALUES ($1, $2, $3, $4)',
      [inv.id, service, qty, SERVICE_PRICES[service]]);
    await audit(db, req.user.id, 'invoice.create', 'invoice', inv.id, { patientId, service, qty });
    return inv.id;
  });
  res.status(201).json({ id });
});

router.post('/invoices/:id/payments', requirePerm('billing.view'), async (req, res) => {
  const method = oneOf(req.body.method, PAYMENT_METHODS, 'payment method');
  const ref = text(req.body.ref, 'reference', { max: 60 }).toUpperCase();
  if (method === 'M-Pesa' && !/^[A-Z0-9]{10}$/.test(ref)) throw new HttpError(400, 'Enter the 10-character M-Pesa transaction code, e.g. SKL4H7Q2RT.');
  if ((method === 'SHA' || method === 'Insurance') && !ref) throw new HttpError(400, `Enter the ${method} claim or member number.`);

  const balance = await tx(async db => {
    // Lock the invoice so two cashiers can't both take the last balance.
    const { rows: [inv] } = await db.query('SELECT id FROM invoices WHERE id = $1 FOR UPDATE', [req.params.id]);
    if (!inv) throw new HttpError(404, 'That invoice could not be found.');
    const { rows: [{ due }] } = await db.query(
      `SELECT ((SELECT coalesce(sum(qty * price), 0) FROM invoice_items WHERE invoice_id = $1)
             - (SELECT coalesce(sum(amount), 0) FROM payments WHERE invoice_id = $1))::int AS due`, [inv.id]);
    if (due <= 0) throw new HttpError(400, 'This invoice is already paid.');
    const amount = number(req.body.amount, 'amount', [1, due], { required: true, integer: true });
    if (method === 'M-Pesa') {
      const { rows } = await db.query(`SELECT invoice_id FROM payments WHERE method = 'M-Pesa' AND ref = $1`, [ref]);
      if (rows[0]) throw new HttpError(409, `M-Pesa code ${ref} has already been used on ${rows[0].invoice_id}.`);
    }
    await db.query('INSERT INTO payments (invoice_id, method, amount, ref, received_by) VALUES ($1, $2, $3, $4, $5)',
      [inv.id, method, amount, ref, req.user.id]);
    await audit(db, req.user.id, 'payment.record', 'invoice', inv.id, { method, amount, ref });
    return due - amount;
  });
  res.status(201).json({ balance });
});

module.exports = router;
