// Clinic Care server: serves the app from public/ and the JSON API under /api.

const path = require('node:path');
const express = require('express');
const { pool, HttpError } = require('./db');
const { loadUser, requireLogin, login, logout, signup } = require('./auth');

const app = express();
app.disable('x-powered-by');

app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('Content-Security-Policy', [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "font-src 'self'",
    "img-src 'self' data:",
    "frame-ancestors 'none'"
  ].join('; '));
  next();
});

app.use(express.json({ limit: '200kb' }));

// Requiring JSON on writes means a plain cross-site form can't trigger them.
app.use('/api', (req, res, next) => {
  if (req.method !== 'GET' && !req.is('application/json')) throw new HttpError(415, 'Requests must be sent as JSON.');
  res.setHeader('Cache-Control', 'no-store');
  next();
});

// Lets the hosting platform check the server and database are up. No login needed.
app.get('/api/health', async (req, res) => {
  await pool.query('SELECT 1');
  res.json({ ok: true });
});

app.use('/api', loadUser);
app.post('/api/login', login);
app.post('/api/signup', signup);
app.post('/api/logout', logout);
app.get('/api/me', requireLogin, (req, res) => res.json({ user: req.user }));

app.use('/api', requireLogin);
app.use('/api', require('./routes/bootstrap'));
app.use('/api', require('./routes/patients'));
app.use('/api', require('./routes/appointments').router);
app.use('/api', require('./routes/clinical'));
app.use('/api', require('./routes/billing'));
app.use('/api', require('./routes/team'));
app.use('/api', require('./routes/users'));
app.use('/api', () => { throw new HttpError(404, 'Not found.'); });

app.use(express.static(path.join(__dirname, '..', 'public')));

// Turns errors into JSON the frontend can show. Unexpected errors are logged
// in full but only a generic message goes to the browser.
app.use((err, req, res, next) => {
  if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
  if (err.code === '23505' && err.constraint === 'appointments_no_double_booking') {
    return res.status(409).json({ error: 'That practitioner already has an appointment at that time. Choose another time.' });
  }
  if (err.code === '22P02') return res.status(400).json({ error: 'That ID isn’t valid.' });
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'The request couldn’t be read.' });
  console.error(err);
  res.status(500).json({ error: 'Something went wrong on the server. Please try again.' });
});

const port = Number(process.env.PORT) || 3000;
const host = process.env.HOST || '127.0.0.1';

// Bring the database up to date before serving (schema.sql only adds what's missing),
// so a new deploy picks up new tables or columns without a manual step.
pool.query(require('node:fs').readFileSync(path.join(__dirname, 'schema.sql'), 'utf8'))
  .then(() => app.listen(port, host, () => console.log(`Clinic Care running at http://${host === '0.0.0.0' ? 'localhost' : host}:${port}`)))
  .catch(err => {
    console.error('Could not prepare the database:', err.message);
    process.exit(1);
  });
