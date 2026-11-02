import type { NextApiRequest, NextApiResponse } from 'next';
import { rateLimit } from '../../../src/lib/api/rate-limit';
import { tournamentManager } from '../../../src/lib/tournament/manager-instance';
import { loadPlayerNames } from '../../../src/lib/tournament/pg-tournament-store';
import { buildTournamentView } from '../../../src/lib/tournament/tournament-view';
import { getRequestAccess, hasPermission, sendPermissionDenied } from '../../../src/lib/auth/access-control';

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
    const t = await tournamentManager.get(String(tournamentId));
    if (!t) return res.status(404).json({ error: 'Tournament not found' });
    const names = await loadPlayerNames(t.registeredPlayers).catch(() => ({}));
    return res.status(200).json(buildTournamentView(t, Date.now(), access.userId, names));
  } catch (err: any) {
    return res.status(400).json({ error: err?.message || 'Bad request' });
  }
}
