import type { NextApiRequest, NextApiResponse } from 'next';
import { sendTournamentError } from '../../../src/lib/tournament/api-errors';
import { rateLimit } from '../../../src/lib/api/rate-limit';
import { tournamentManager } from '../../../src/lib/tournament/manager-instance';
import { buildTournamentSummary } from '../../../src/lib/tournament/tournament-view';
import { canManageTournament } from '../../../src/lib/tournament/require-organizer';
import { syncTournamentRooms } from '../../../src/lib/tournament/table-rooms';
import { getRequestAccess, hasPermission, sendPermissionDenied } from '../../../src/lib/auth/access-control';
import type { TournamentStatus } from '../../../src/types/tournament-management';

// Opening or waking a tournament's tables can take a while with many of them
export const config = { maxDuration: 60 };

const FILTERS: Record<string, TournamentStatus[]> = {
  upcoming: ['setup'],
  running: ['running', 'paused', 'on-break'],
  finished: ['completed', 'cancelled'],
};

/** Tournaments for the lobby: ?filter=upcoming|running|finished (default upcoming and running). */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const rl = rateLimit(req, { limit: 120, windowMs: 60_000 });
  if (!rl.allowed) return res.status(429).json({ error: 'Too many requests' });
  const access = await getRequestAccess(req);
  if (!hasPermission(access, 'tournament.view')) return sendPermissionDenied(res, 'tournament.view', access);
  try {
    const filter = typeof req.query?.filter === 'string' ? req.query.filter : '';
    if (filter && !FILTERS[filter]) return res.status(400).json({ error: 'filter must be upcoming, running or finished' });
    const statuses = filter ? FILTERS[filter] : [...FILTERS.upcoming, ...FILTERS.running];
    const now = Date.now();
    const listed = await tournamentManager.list(statuses);
    // Tournaments whose start time has come start (or are called off) now
    for (const [i, t] of listed.entries()) {
      if (t.status !== 'setup' || t.config.startsAt === undefined || t.config.startsAt > now) continue;
      const { tournament, started } = await tournamentManager.startIfDue(t.id);
      if (tournament) listed[i] = tournament;
      if (started) await syncTournamentRooms(t.id);
    }
    // A clock catching up can finish a tournament, so filter again after reading
    const tournaments = listed
      .filter(t => statuses.includes(t.status))
      .map(t => buildTournamentSummary(t, now, access.userId, canManageTournament(access, t)));
    return res.status(200).json({ tournaments });
  } catch (err) {
    return sendTournamentError(res, err);
  }
}
