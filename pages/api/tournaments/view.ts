import type { NextApiRequest, NextApiResponse } from 'next';
import { sendTournamentError } from '../../../src/lib/tournament/api-errors';
import { rateLimit } from '../../../src/lib/api/rate-limit';
import { tournamentManager } from '../../../src/lib/tournament/manager-instance';
import { loadPlayerNames } from '../../../src/lib/tournament/pg-tournament-store';
import { buildTournamentView } from '../../../src/lib/tournament/tournament-view';
import { getRequestAccess, hasPermission, sendPermissionDenied } from '../../../src/lib/auth/access-control';
import { canManageTournament } from '../../../src/lib/tournament/require-organizer';
import { keepTablesMoving, syncTournamentRooms } from '../../../src/lib/tournament/table-rooms';
import { PRIVATE_TOURNAMENT_RESPONSE, canSeeTournament } from '../../../src/lib/tournament/tournament-privacy';

// Opening or waking a tournament's tables can take a while with many of them
export const config = { maxDuration: 60 };

/** What players see during a tournament: clock, blinds, prize pool and payouts, average stack, bounties and their own seat. */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const rl = rateLimit(req, { limit: 240, windowMs: 60_000 });
  if (!rl.allowed) return res.status(429).json({ error: 'Too many requests' });
  const access = await getRequestAccess(req);
  if (!hasPermission(access, 'tournament.view')) return sendPermissionDenied(res, 'tournament.view', access);
  try {
    const { tournamentId } = (req.query || {}) as any;
    if (!tournamentId) return res.status(400).json({ error: 'Missing tournamentId' });
    const found = await tournamentManager.get(String(tournamentId));
    if (!found) return res.status(404).json({ error: 'Tournament not found' });
    if (!canSeeTournament(access, found)) return res.status(403).json(PRIVATE_TOURNAMENT_RESPONSE);
    // A tournament with a start time starts (or is called off) when it's due
    const { tournament: t, started } = await tournamentManager.startIfDue(found.id);
    if (!t) return res.status(404).json({ error: 'Tournament not found' });
    if (started) await syncTournamentRooms(t.id);
    // Tables nobody has open still need their next hands dealt
    else await keepTablesMoving(t.id);
    const names = await loadPlayerNames(t.registeredPlayers).catch(() => ({}));
    return res.status(200).json(buildTournamentView(t, Date.now(), access.userId, names, { canManage: canManageTournament(access, t) }));
  } catch (err) {
    return sendTournamentError(res, err);
  }
}
