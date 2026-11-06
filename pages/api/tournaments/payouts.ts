import { sendTournamentError } from '../../../src/lib/tournament/api-errors';
import { tournamentManager } from '../../../src/lib/tournament/manager-instance';
import { getRequestAccess, hasPermission, sendPermissionDenied } from '../../../src/lib/auth/access-control';
import { PRIVATE_TOURNAMENT_RESPONSE, canSeeTournament } from '../../../src/lib/tournament/tournament-privacy';
import { apiHandler } from '../../../src/lib/api/handler';

export default apiHandler({ methods: 'GET', rateLimit: { windowMs: 60_000, max: 120, message: 'Too many requests' } }, async (req, res) => {
  const access = await getRequestAccess(req);
  if (!hasPermission(access, 'tournament.view')) return sendPermissionDenied(res, 'tournament.view', access);
  try {
    const { tournamentId } = (req.query || {}) as any;
    if (!tournamentId) return res.status(400).json({ error: 'Missing tournamentId' });
    const t = await tournamentManager.get(String(tournamentId));
    if (t && !canSeeTournament(access, t)) return res.status(403).json(PRIVATE_TOURNAMENT_RESPONSE);
    // The prize pool comes from the entries, rebuys and add-ons recorded on the server
    const result = await tournamentManager.payouts(String(tournamentId));
    return res.status(200).json(result);
  } catch (err) {
    return sendTournamentError(res, err);
  }
});
