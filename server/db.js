// Database connection and small helpers shared by the routes.

const { Pool, types } = require('pg');

// Return DATE columns as 'YYYY-MM-DD' strings and NUMERIC as numbers,
// which is what the frontend works with.
types.setTypeParser(1082, v => v);
types.setTypeParser(1700, v => Number(v));

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is not set. Copy .env.example to .env and fill it in.');
  process.exit(1);
}

// Dates like "today" follow the clinic's time zone, both here and in the database.
const TZ = (process.env.TZ || 'Africa/Nairobi').replace(/[^\w/+-]/g, '');
const pool = new Pool({ connectionString: process.env.DATABASE_URL, options: `-c TimeZone=${TZ}` });

// Runs `fn` inside a transaction; rolls back if it throws.
async function tx(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function audit(db, userId, action, entity = null, entityId = null, detail = null) {
  await db.query(
    'INSERT INTO audit_log (user_id, action, entity, entity_id, detail) VALUES ($1, $2, $3, $4, $5)',
    [userId, action, entity, entityId, detail]
  );
}

// An error whose message is safe to show to the user.
class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

module.exports = { pool, tx, audit, HttpError };
