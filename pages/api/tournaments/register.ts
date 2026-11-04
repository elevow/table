import type { NextApiRequest, NextApiResponse } from 'next';
import { sendTournamentError } from '../../../src/lib/tournament/api-errors';
import { rateLimit } from '../../../src/lib/api/rate-limit';
import { tournamentManager } from '../../../src/lib/tournament/manager-instance';
import { syncTournamentRooms } from '../../../src/lib/tournament/table-rooms';
import { requirePlayer } from '../../../src/lib/auth/auth-utils';
import { getRequestAccess } from '../../../src/lib/auth/access-control';
import { PRIVATE_TOURNAMENT_RESPONSE, canRegisterForTournament, withoutTournamentInvite } from '../../../src/lib/tournament/tournament-privacy';

// Opening or waking a tournament's tables can take a while with many of them
export const config = { maxDuration: 60 };

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const rl = rateLimit(req, { limit: 120, windowMs: 60_000 });
  if (!rl.allowed) return res.status(429).json({ error: 'Too many requests' });
  try {
    const { tournamentId, userId: claimedUserId } = req.body || {};
    const userId = await requirePlayer(req, res, claimedUserId, 'tournament.register');
    if (!userId) return;
    if (!tournamentId) return res.status(400).json({ error: 'Missing tournamentId' });
    const current = await tournamentManager.get(String(tournamentId));
    if (current && !canRegisterForTournament(await getRequestAccess(req), current)) {
      return res.status(403).json(PRIVATE_TOURNAMENT_RESPONSE);
    }
    const t = await tournamentManager.register({ tournamentId, userId });
    // Tables play in game rooms: open, seat and wake them to match
    await syncTournamentRooms(t.id);
    return res.status(200).json(withoutTournamentInvite(t));
  } catch (err) {
    return sendTournamentError(res, err);
  }
}
