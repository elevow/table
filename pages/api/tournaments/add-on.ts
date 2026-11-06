import { sendTournamentError } from '../../../src/lib/tournament/api-errors';
import { withoutTournamentInvite } from '../../../src/lib/tournament/tournament-privacy';
import { tournamentManager } from '../../../src/lib/tournament/manager-instance';
import { syncTournamentRooms } from '../../../src/lib/tournament/table-rooms';
import { requirePlayer } from '../../../src/lib/auth/auth-utils';
import { requireOrganizer } from '../../../src/lib/tournament/require-organizer';
import { apiHandler } from '../../../src/lib/api/handler';

// Opening or waking a tournament's tables can take a while with many of them
export const config = { maxDuration: 60 };

export default apiHandler({ methods: 'POST', rateLimit: { windowMs: 60_000, max: 120, message: 'Too many requests' } }, async (req, res) => {
  try {
    const { tournamentId, userId: claimedUserId, forPlayer } = req.body || {};
    let userId: string | null;
    if (forPlayer) {
      // The director records it for a player, e.g. one paying at the desk
      if (!(await requireOrganizer(req, res, 'tournament.manage', tournamentId))) return;
      userId = String(forPlayer);
    } else {
      userId = await requirePlayer(req, res, claimedUserId, 'game.rebuy');
      if (!userId) return;
      if (!tournamentId) return res.status(400).json({ error: 'Missing tournamentId' });
    }
    const t = await tournamentManager.addOn({ tournamentId, userId });
    // Tables play in game rooms: open, seat and wake them to match
    await syncTournamentRooms(t.id);
    return res.status(200).json(withoutTournamentInvite(t));
  } catch (err) {
    return sendTournamentError(res, err);
  }
});
