import { sendTournamentError } from '../../../src/lib/tournament/api-errors';
import { withoutTournamentInvite } from '../../../src/lib/tournament/tournament-privacy';
import { tournamentManager } from '../../../src/lib/tournament/manager-instance';
import { requirePlayer } from '../../../src/lib/auth/auth-utils';
import { apiHandler } from '../../../src/lib/api/handler';

export default apiHandler({ methods: 'POST', rateLimit: { windowMs: 60_000, max: 120, message: 'Too many requests' } }, async (req, res) => {
  try {
    const { tournamentId, userId: claimedUserId } = req.body || {};
    const userId = await requirePlayer(req, res, claimedUserId, 'tournament.register');
    if (!userId) return;
    if (!tournamentId) return res.status(400).json({ error: 'Missing tournamentId' });
    const t = await tournamentManager.unregister({ tournamentId, userId });
    return res.status(200).json(withoutTournamentInvite(t));
  } catch (err) {
    return sendTournamentError(res, err);
  }
});
