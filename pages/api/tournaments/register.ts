import { sendTournamentError } from '../../../src/lib/tournament/api-errors';
import { tournamentManager } from '../../../src/lib/tournament/manager-instance';
import { syncTournamentRooms } from '../../../src/lib/tournament/table-rooms';
import { requirePlayer } from '../../../src/lib/auth/auth-utils';
import { getRequestAccess } from '../../../src/lib/auth/access-control';
import { PRIVATE_TOURNAMENT_RESPONSE, canRegisterForTournament, withoutTournamentInvite } from '../../../src/lib/tournament/tournament-privacy';
import { apiHandler } from '../../../src/lib/api/handler';

// Opening or waking a tournament's tables can take a while with many of them
export const config = { maxDuration: 60 };

export default apiHandler({ methods: 'POST', rateLimit: { windowMs: 60_000, max: 120, message: 'Too many requests' } }, async (req, res) => {
  try {
    const { tournamentId, userId: claimedUserId } = req.body || {};
    const userId = await requirePlayer(req, res, claimedUserId, 'tournament.register');
    if (!userId) return;
    if (!tournamentId) return res.status(400).json({ error: 'Missing tournamentId' });
    const current = await tournamentManager.get(String(tournamentId));
    if (current && !canRegisterForTournament(await getRequestAccess(req), current)) {
      return res.status(403).json(PRIVATE_TOURNAMENT_RESPONSE);
    }
    const t = await tournamentManager.register({ tournamentId, userId });
    // Tables play in game rooms: open, seat and wake them to match
    await syncTournamentRooms(t.id);
    return res.status(200).json(withoutTournamentInvite(t));
  } catch (err) {
    return sendTournamentError(res, err);
  }
});
