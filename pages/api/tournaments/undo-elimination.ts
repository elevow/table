import type { NextApiRequest, NextApiResponse } from 'next';
import { sendTournamentError } from '../../../src/lib/tournament/api-errors';
import { rateLimit } from '../../../src/lib/api/rate-limit';
import { tournamentManager } from '../../../src/lib/tournament/manager-instance';
import { syncTournamentRooms } from '../../../src/lib/tournament/table-rooms';
import { requireOrganizer } from '../../../src/lib/tournament/require-organizer';

// Opening or waking a tournament's tables can take a while with many of them
export const config = { maxDuration: 60 };

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const rl = rateLimit(req, { limit: 60, windowMs: 60_000 });
  if (!rl.allowed) return res.status(429).json({ error: 'Too many requests' });
  const body = req.body || {};
  if (!(await requireOrganizer(req, res, 'tournament.eliminate', body.tournamentId))) return;
  try {
    const t = await tournamentManager.undoElimination(String(body.tournamentId));
    // Tables play in game rooms: open, seat and wake them to match
    await syncTournamentRooms(t.id);
    return res.status(200).json(t);
  } catch (err) {
    return sendTournamentError(res, err);
  }
}
