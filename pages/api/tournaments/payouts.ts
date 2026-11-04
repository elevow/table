import type { NextApiRequest, NextApiResponse } from 'next';
import { sendTournamentError } from '../../../src/lib/tournament/api-errors';
import { rateLimit } from '../../../src/lib/api/rate-limit';
import { tournamentManager } from '../../../src/lib/tournament/manager-instance';
import { getRequestAccess, hasPermission, sendPermissionDenied } from '../../../src/lib/auth/access-control';
import { PRIVATE_TOURNAMENT_RESPONSE, canSeeTournament } from '../../../src/lib/tournament/tournament-privacy';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const rl = rateLimit(req, { limit: 120, windowMs: 60_000 });
  if (!rl.allowed) return res.status(429).json({ error: 'Too many requests' });
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
}
