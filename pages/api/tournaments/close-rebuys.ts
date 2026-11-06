import { sendTournamentError } from '../../../src/lib/tournament/api-errors';
import { withoutTournamentInvite } from '../../../src/lib/tournament/tournament-privacy';
import { tournamentManager } from '../../../src/lib/tournament/manager-instance';
import { syncTournamentRooms } from '../../../src/lib/tournament/table-rooms';
import { requireOrganizer } from '../../../src/lib/tournament/require-organizer';
import { apiHandler } from '../../../src/lib/api/handler';

// Opening or waking a tournament's tables can take a while with many of them
export const config = { maxDuration: 60 };

/** POST { tournamentId }: the director closes rebuys now, which ends the tournament if one player is left. */
export default apiHandler({ methods: 'POST', rateLimit: { windowMs: 60_000, max: 60, message: 'Too many requests' } }, async (req, res) => {
  const { tournamentId } = req.body || {};
  if (!(await requireOrganizer(req, res, 'tournament.manage', tournamentId))) return;
  try {
    const t = await tournamentManager.closeRebuys(tournamentId);
    // Tables learn the tournament is over before their next hand
    await syncTournamentRooms(t.id);
    return res.status(200).json(withoutTournamentInvite(t));
  } catch (err) {
    return sendTournamentError(res, err);
  }
});
