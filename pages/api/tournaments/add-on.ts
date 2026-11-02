import type { NextApiRequest, NextApiResponse } from 'next';
import { sendTournamentError } from '../../../src/lib/tournament/api-errors';
import { rateLimit } from '../../../src/lib/api/rate-limit';
import { tournamentManager } from '../../../src/lib/tournament/manager-instance';
import { requirePlayer } from '../../../src/lib/auth/auth-utils';
import { requireOrganizer } from '../../../src/lib/tournament/require-organizer';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const rl = rateLimit(req, { limit: 120, windowMs: 60_000 });
  if (!rl.allowed) return res.status(429).json({ error: 'Too many requests' });
  try {
    const { tournamentId, userId: claimedUserId, forPlayer } = req.body || {};
    let userId: string | null;
    if (forPlayer) {
      // The director records it for a player, e.g. one paying at the desk
      if (!(await requireOrganizer(req, res, 'tournament.manage', tournamentId))) return;
      userId = String(forPlayer);
    } else {
      userId = await requirePlayer(req, res, claimedUserId, 'game.rebuy');
      if (!userId) return;
      if (!tournamentId) return res.status(400).json({ error: 'Missing tournamentId' });
    }
    const t = await tournamentManager.addOn({ tournamentId, userId });
    return res.status(200).json(t);
  } catch (err) {
    return sendTournamentError(res, err);
  }
}
