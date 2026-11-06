import { sendTournamentError } from '../../../src/lib/tournament/api-errors';
import { withoutTournamentInvite } from '../../../src/lib/tournament/tournament-privacy';
import { tournamentManager } from '../../../src/lib/tournament/manager-instance';
import { requireOrganizer } from '../../../src/lib/tournament/require-organizer';
import { apiHandler } from '../../../src/lib/api/handler';

export default apiHandler({ methods: 'POST', rateLimit: { windowMs: 60_000, max: 60, message: 'Too many requests' } }, async (req, res) => {
  const { tournamentId } = req.body || {};
  if (!(await requireOrganizer(req, res, 'tournament.manage', tournamentId))) return;
  try {
    const t = await tournamentManager.pause(tournamentId);
    return res.status(200).json(withoutTournamentInvite(t));
  } catch (err) {
    return sendTournamentError(res, err);
  }
});
