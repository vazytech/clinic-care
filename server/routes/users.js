// Approving or rejecting account requests made through sign-up.

const router = require('express').Router();
const { tx, audit, HttpError } = require('../db');
const { requirePerm } = require('../auth');
const { oneOf } = require('../validate');
const { ROLES } = require('../../public/shared');

async function pendingUser(db, id) {
  const { rows: [user] } = await db.query(`SELECT id, username FROM users WHERE id = $1 AND status = 'pending' FOR UPDATE`, [id]);
  if (!user) throw new HttpError(404, 'That account request could not be found. It may already have been handled.');
  return user;
}

router.post('/users/:id/approve', requirePerm('team.manage'), async (req, res) => {
  const role = oneOf(req.body.role, Object.keys(ROLES), 'role');
  await tx(async db => {
    const user = await pendingUser(db, Number(req.params.id) || 0);
    await db.query(`UPDATE users SET status = 'active', active = true, role = $2 WHERE id = $1`, [user.id, role]);
    await audit(db, req.user.id, 'user.approve', 'user', user.username, { role });
  });
  res.json({ ok: true });
});

router.post('/users/:id/reject', requirePerm('team.manage'), async (req, res) => {
  await tx(async db => {
    const user = await pendingUser(db, Number(req.params.id) || 0);
    // Kept (not deleted) so the audit trail still makes sense; the username stays taken.
    await db.query(`UPDATE users SET status = 'rejected', active = false WHERE id = $1`, [user.id]);
    await audit(db, req.user.id, 'user.reject', 'user', user.username);
  });
  res.json({ ok: true });
});

module.exports = router;
