import { sendTournamentError } from '../../../src/lib/tournament/api-errors';
import { tournamentManager } from '../../../src/lib/tournament/manager-instance';
import { requirePermission } from '../../../src/lib/auth/access-control';
import { withoutTournamentInvite } from '../../../src/lib/tournament/tournament-privacy';
import { apiHandler } from '../../../src/lib/api/handler';

export default apiHandler({ methods: 'POST', rateLimit: { windowMs: 60_000, max: 60, message: 'Too many requests' } }, async (req, res) => {
  const access = await requirePermission(req, res, 'tournament.create');
  if (!access) return;
  try {
    const { name, config } = req.body || {};
    if (!name || !config) return res.status(400).json({ error: 'Missing name or config' });
    // Anyone who can create a tournament can make it private; the invite code is the server's
    const visibility = req.body?.visibility === 'private' ? 'private' : 'public';
    const created = await tournamentManager.create({ name, config, createdBy: access.userId, visibility });
    // The director gets the invite link from the director controls
    return res.status(201).json(withoutTournamentInvite(created));
  } catch (err) {
    return sendTournamentError(res, err);
  }
});
