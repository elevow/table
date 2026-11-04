import type { NextApiRequest, NextApiResponse } from 'next';
import { sendTournamentError } from '../../../src/lib/tournament/api-errors';
import { withoutTournamentInvite } from '../../../src/lib/tournament/tournament-privacy';
import { rateLimit } from '../../../src/lib/api/rate-limit';
import { tournamentManager } from '../../../src/lib/tournament/manager-instance';
import { syncTournamentRooms } from '../../../src/lib/tournament/table-rooms';
import { requirePlayer } from '../../../src/lib/auth/auth-utils';
import { requireOrganizer } from '../../../src/lib/tournament/require-organizer';

// Opening or waking a tournament's tables can take a while with many of them
export const config = { maxDuration: 60 };

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
    // Tables play in game rooms: open, seat and wake them to match
    await syncTournamentRooms(t.id);
    return res.status(200).json(withoutTournamentInvite(t));
  } catch (err) {
    return sendTournamentError(res, err);
  }
}
