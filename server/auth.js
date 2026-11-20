// Passwords, sessions and permission checks.

const crypto = require('node:crypto');
const { promisify } = require('node:util');
const { pool, audit, HttpError } = require('./db');
const { roleCan } = require('../public/shared');

const scrypt = promisify(crypto.scrypt);
const COOKIE = 'cc_session';
const SESSION_HOURS = 12;

/* ---------- Passwords ---------- */

async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(password, salt, 64);
  return `scrypt$${salt.toString('hex')}$${key.toString('hex')}`;
}

async function verifyPassword(password, stored) {
  const [scheme, saltHex, keyHex] = String(stored).split('$');
  if (scheme !== 'scrypt' || !saltHex || !keyHex) return false;
  const expected = Buffer.from(keyHex, 'hex');
  const key = await scrypt(password, Buffer.from(saltHex, 'hex'), expected.length);
  return key.length === expected.length && crypto.timingSafeEqual(key, expected);
}

function checkPasswordStrength(password) {
  if (String(password).length < 10) throw new HttpError(400, 'Use a password of at least 10 characters.');
}

/* ---------- Sessions ---------- */

const tokenHash = token => crypto.createHash('sha256').update(token).digest('hex');

function readCookie(req, name) {
  const match = (req.headers.cookie ?? '').split(/;\s*/).find(c => c.startsWith(`${name}=`));
  return match ? decodeURIComponent(match.slice(name.length + 1)) : null;
}

function setSessionCookie(res, token, maxAgeSeconds) {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  res.setHeader('Set-Cookie', `${COOKIE}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAgeSeconds}${secure}`);
}

async function createSession(res, userId) {
  const token = crypto.randomBytes(32).toString('base64url');
  await pool.query(
    `INSERT INTO sessions (token_hash, user_id, expires_at) VALUES ($1, $2, now() + interval '${SESSION_HOURS} hours')`,
    [tokenHash(token), userId]
  );
  // Housekeeping: drop expired sessions now and then.
  await pool.query('DELETE FROM sessions WHERE expires_at < now()');
  setSessionCookie(res, token, SESSION_HOURS * 3600);
}

async function endSession(req, res) {
  const token = readCookie(req, COOKIE);
  if (token) await pool.query('DELETE FROM sessions WHERE token_hash = $1', [tokenHash(token)]);
  setSessionCookie(res, '', 0);
}

// Attaches req.user if the request carries a valid session cookie.
async function loadUser(req, res, next) {
  const token = readCookie(req, COOKIE);
  if (token) {
    const { rows } = await pool.query(
      `SELECT u.id, u.username, u.name, u.role FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.token_hash = $1 AND s.expires_at > now() AND u.active`,
      [tokenHash(token)]
    );
    req.user = rows[0] ?? null;
  }
  next();
}

function requireLogin(req, res, next) {
  if (!req.user) throw new HttpError(401, 'Please sign in again.');
  next();
}

function requirePerm(perm) {
  return (req, res, next) => {
    if (!roleCan(req.user.role, perm)) throw new HttpError(403, 'Your role doesn’t allow this.');
    next();
  };
}

/* ---------- Login throttling ---------- */

// After 5 failed attempts for a username, block it for 2 minutes. In memory only,
// which is fine for a single server process.
const failures = new Map();
const MAX_FAILURES = 5;
const LOCK_MS = 2 * 60 * 1000;

function checkThrottle(username) {
  const f = failures.get(username);
  if (f && f.count >= MAX_FAILURES && Date.now() - f.last < LOCK_MS) {
    throw new HttpError(429, 'Too many failed attempts. Try again in 2 minutes.');
  }
}

function recordFailure(username) {
  const f = failures.get(username) ?? { count: 0, last: 0 };
  if (Date.now() - f.last > LOCK_MS) f.count = 0;
  failures.set(username, { count: f.count + 1, last: Date.now() });
}

async function login(req, res) {
  const username = String(req.body?.username ?? '').trim().toLowerCase();
  const password = String(req.body?.password ?? '');
  if (!username || !password) throw new HttpError(400, 'Enter your username and password.');
  checkThrottle(username);

  const { rows } = await pool.query('SELECT id, username, name, role, password_hash, status, active FROM users WHERE username = $1', [username]);
  const user = rows[0];
  if (!user || !(await verifyPassword(password, user.password_hash))) {
    recordFailure(username);
    await audit(pool, user?.id ?? null, 'login.failed', 'user', username);
    throw new HttpError(401, 'Wrong username or password.');
  }
  failures.delete(username);
  // Only say why sign-in is blocked once the password has proved who they are.
  if (user.status === 'pending') throw new HttpError(403, 'Your account is waiting for an administrator to approve it.');
  if (user.status !== 'active' || !user.active) throw new HttpError(403, 'This account isn’t active. Contact your clinic administrator.');
  await createSession(res, user.id);
  await audit(pool, user.id, 'login');
  res.json({ user: { id: user.id, username: user.username, name: user.name, role: user.role } });
}

async function logout(req, res) {
  if (req.user) await audit(pool, req.user.id, 'logout');
  await endSession(req, res);
  res.json({ ok: true });
}

// Anyone can request an account, but it stays "pending" — with no access at all —
// until an administrator approves it and chooses its role (see routes/users.js).
const MAX_PENDING = 20;

async function signup(req, res) {
  const name = String(req.body?.name ?? '').trim();
  const username = String(req.body?.username ?? '').trim().toLowerCase();
  const password = String(req.body?.password ?? '');
  const confirmPassword = String(req.body?.confirmPassword ?? '');

  if (name.length < 2 || name.length > 120) throw new HttpError(400, 'Enter your full name (2–120 characters).');
  if (!/^[a-z0-9][a-z0-9._-]{2,39}$/.test(username)) {
    throw new HttpError(400, 'Use a username of 3–40 characters with letters, numbers, dots, underscores or hyphens.');
  }
  checkPasswordStrength(password);
  if (password !== confirmPassword) throw new HttpError(400, 'Passwords do not match.');

  const { rows: existing } = await pool.query('SELECT id FROM users WHERE username = $1', [username]);
  if (existing[0]) throw new HttpError(409, 'That username is already taken.');
  const { rows: [{ pending }] } = await pool.query(`SELECT count(*)::int AS pending FROM users WHERE status = 'pending'`);
  if (pending >= MAX_PENDING) throw new HttpError(429, 'There are too many account requests waiting. Ask your clinic administrator.');

  const passwordHash = await hashPassword(password);
  // The role is a placeholder; the administrator picks the real one when approving.
  const { rows: [user] } = await pool.query(
    `INSERT INTO users (username, name, role, password_hash, status, active)
     VALUES ($1, $2, 'reception', $3, 'pending', false) RETURNING id`,
    [username, name, passwordHash]
  );
  await audit(pool, user.id, 'signup.request', 'user', username);
  res.status(201).json({ pending: true });
}

module.exports = { hashPassword, checkPasswordStrength, loadUser, requireLogin, requirePerm, login, logout, signup };
