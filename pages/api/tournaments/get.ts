import { sendTournamentError } from '../../../src/lib/tournament/api-errors';
import { tournamentManager } from '../../../src/lib/tournament/manager-instance';
import { getRequestAccess, hasPermission, sendPermissionDenied } from '../../../src/lib/auth/access-control';
import { canManageTournament } from '../../../src/lib/tournament/require-organizer';
import { PRIVATE_TOURNAMENT_RESPONSE, canSeeTournament, withoutTournamentInvite } from '../../../src/lib/tournament/tournament-privacy';
import { apiHandler } from '../../../src/lib/api/handler';

export default apiHandler({ methods: 'GET', rateLimit: { windowMs: 60_000, max: 120, message: 'Too many requests' } }, async (req, res) => {
  const access = await getRequestAccess(req);
  if (!hasPermission(access, 'tournament.view')) return sendPermissionDenied(res, 'tournament.view', access);
  try {
    const { tournamentId } = (req.query || {}) as any;
    if (!tournamentId) return res.status(400).json({ error: 'Missing tournamentId' });
    const t = await tournamentManager.get(tournamentId);
    if (!t) return res.status(404).json({ error: 'Not found' });
    if (!canSeeTournament(access, t)) return res.status(403).json(PRIVATE_TOURNAMENT_RESPONSE);
    // The undo copy is for the director's undo, and the invite for the director, not for readers
    const { lastElimination: _undo, ...state } = canManageTournament(access, t) ? t : withoutTournamentInvite(t);
    return res.status(200).json(state);
  } catch (err) {
    return sendTournamentError(res, err);
  }
});
