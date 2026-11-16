// Sets a user's password and signs them out everywhere.
//   npm run password -- <username>

const readline = require('node:readline/promises');
const { pool } = require('../server/db');
const { hashPassword, checkPasswordStrength } = require('../server/auth');

async function main() {
  const username = String(process.argv[2] ?? '').toLowerCase();
  if (!username) throw new Error('Usage: npm run password -- <username>');
  const { rows: [user] } = await pool.query('SELECT id, name FROM users WHERE username = $1', [username]);
  if (!user) throw new Error(`No user called "${username}".`);

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const password = await rl.question(`New password for ${user.name}: `);
  rl.close();
  checkPasswordStrength(password);

  await pool.query('UPDATE users SET password_hash = $2 WHERE id = $1', [user.id, await hashPassword(password)]);
  await pool.query('DELETE FROM sessions WHERE user_id = $1', [user.id]);
  console.log('Password updated.');
}

main()
  .catch(err => {
    console.error(err.message);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
