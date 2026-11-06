import { sendTournamentError } from '../../../src/lib/tournament/api-errors';
import { withoutTournamentInvite } from '../../../src/lib/tournament/tournament-privacy';
import { tournamentManager } from '../../../src/lib/tournament/manager-instance';
import { syncTournamentRooms } from '../../../src/lib/tournament/table-rooms';
import { requireOrganizer } from '../../../src/lib/tournament/require-organizer';
import { apiHandler } from '../../../src/lib/api/handler';

// Opening or waking a tournament's tables can take a while with many of them
export const config = { maxDuration: 60 };

export default apiHandler({ methods: 'POST', rateLimit: { windowMs: 60_000, max: 120, message: 'Too many requests' } }, async (req, res) => {
  const { tournamentId, userId, eliminatedBy } = req.body || {};
  if (!(await requireOrganizer(req, res, 'tournament.eliminate', tournamentId))) return;
  if (!userId) return res.status(400).json({ error: 'Missing userId' });
  try {
    const t = await tournamentManager.eliminate({ tournamentId, userId: String(userId), eliminatedBy: eliminatedBy ? String(eliminatedBy) : undefined });
    // Tables play in game rooms: open, seat and wake them to match
    await syncTournamentRooms(t.id);
    return res.status(200).json(withoutTournamentInvite(t));
  } catch (err) {
    return sendTournamentError(res, err);
  }
});
