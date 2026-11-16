// Input checks for request bodies. Each helper returns a clean value or throws a
// 400 error with a message the user can act on.

const { HttpError } = require('./db');
const { todayISO } = require('../public/shared');

function text(value, label, { required = false, max = 500 } = {}) {
  const v = String(value ?? '').trim();
  if (required && !v) throw new HttpError(400, `Enter the ${label}.`);
  if (v.length > max) throw new HttpError(400, `The ${label} is too long (max ${max} characters).`);
  return v;
}

function oneOf(value, options, label) {
  if (!options.includes(value)) throw new HttpError(400, `Choose a valid ${label}.`);
  return value;
}

function date(value, label, { required = true, notFuture = false } = {}) {
  const v = String(value ?? '').trim();
  if (!v && !required) return null;
  const d = new Date(`${v}T00:00:00`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v) || Number.isNaN(d.getTime())) throw new HttpError(400, `Enter a valid ${label}.`);
  if (notFuture && v > todayISO()) throw new HttpError(400, `The ${label} can’t be in the future.`);
  return v;
}

function time(value) {
  const v = String(value ?? '').trim();
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(v)) throw new HttpError(400, 'Enter a valid time.');
  return v;
}

function number(value, label, [min, max], { required = false, integer = false } = {}) {
  if (value === null || value === undefined || value === '') {
    if (required) throw new HttpError(400, `Enter the ${label}.`);
    return null;
  }
  const n = Number(value);
  if (!Number.isFinite(n) || n < min || n > max || (integer && !Number.isInteger(n))) {
    throw new HttpError(400, `The ${label} must be ${integer ? 'a whole number ' : ''}between ${min} and ${max}.`);
  }
  return n;
}

module.exports = { text, oneOf, date, time, number };
