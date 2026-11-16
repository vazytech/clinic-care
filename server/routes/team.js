// Duty roster: weekly days and "away today".

const router = require('express').Router();
const { tx, audit, HttpError } = require('../db');
const { requirePerm } = require('../auth');
const { text } = require('../validate');

router.put('/team/:id', requirePerm('team.manage'), async (req, res) => {
  const role = text(req.body.role, 'role', { required: true, max: 120 });
  const days = Array.isArray(req.body.days) ? [...new Set(req.body.days.map(Number))] : null;
  if (!days || !days.every(d => Number.isInteger(d) && d >= 0 && d <= 6)) throw new HttpError(400, 'Choose valid working days.');
  await tx(async db => {
    const { rowCount } = await db.query('UPDATE team_members SET role = $2, days = $3 WHERE id = $1', [req.params.id, role, days.sort()]);
    if (!rowCount) throw new HttpError(404, 'That team member could not be found.');
    await audit(db, req.user.id, 'team.roster', 'team_member', req.params.id, { role, days });
  });
  res.json({ ok: true });
});

router.post('/team/:id/away', requirePerm('team.manage'), async (req, res) => {
  const away = req.body.away === true;
  await tx(async db => {
    const { rows } = await db.query('SELECT 1 FROM team_members WHERE id = $1', [req.params.id]);
    if (!rows[0]) throw new HttpError(404, 'That team member could not be found.');
    if (away) await db.query('INSERT INTO team_away (member_id, date) VALUES ($1, CURRENT_DATE) ON CONFLICT DO NOTHING', [req.params.id]);
    else await db.query('DELETE FROM team_away WHERE member_id = $1 AND date = CURRENT_DATE', [req.params.id]);
    await audit(db, req.user.id, away ? 'team.away' : 'team.back', 'team_member', req.params.id);
  });
  res.json({ ok: true });
});

module.exports = router;
