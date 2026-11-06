import { sendTournamentError } from '../../../src/lib/tournament/api-errors';
import { withoutTournamentInvite } from '../../../src/lib/tournament/tournament-privacy';
import { tournamentManager } from '../../../src/lib/tournament/manager-instance';
import { syncTournamentRooms } from '../../../src/lib/tournament/table-rooms';
import { requireOrganizer } from '../../../src/lib/tournament/require-organizer';
import { apiHandler } from '../../../src/lib/api/handler';

// Opening or waking a tournament's tables can take a while with many of them
export const config = { maxDuration: 60 };

export default apiHandler({ methods: 'POST', rateLimit: { windowMs: 60_000, max: 60, message: 'Too many requests' } }, async (req, res) => {
  const body = req.body || {};
  if (!(await requireOrganizer(req, res, 'tournament.eliminate', body.tournamentId))) return;
  try {
    if (!body.userId) return res.status(400).json({ error: 'Missing userId' });
    const t = await tournamentManager.removePlayer({ tournamentId: String(body.tournamentId), userId: String(body.userId) });
    // Tables play in game rooms: open, seat and wake them to match
    await syncTournamentRooms(t.id);
    return res.status(200).json(withoutTournamentInvite(t));
  } catch (err) {
    return sendTournamentError(res, err);
  }
});
