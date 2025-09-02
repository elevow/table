import type { NextApiRequest, NextApiResponse } from 'next';
import { rateLimit } from '../../../src/lib/api/rate-limit';
import { tournamentManager } from '../../../src/lib/tournament/manager-instance';
import { buildTournamentReport } from '../../../src/lib/tournament/tournament-reporting';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const rl = rateLimit(req, { limit: 120, windowMs: 60_000 });
  if (!rl.allowed) return res.status(429).json({ error: 'Too many requests' });
  try {
    const { tournamentId, prizePool } = req.query || {} as any;
    if (!tournamentId) return res.status(400).json({ error: 'Missing tournamentId' });
    const prize = typeof prizePool === 'string' ? parseFloat(prizePool) : Number(prizePool || 0);
    if (Number.isNaN(prize) || prize < 0) return res.status(400).json({ error: 'Invalid prizePool' });
    const t = tournamentManager.get(tournamentId as string);
    if (!t) return res.status(404).json({ error: 'Tournament not found' });
    const report = buildTournamentReport(t, prize);
    return res.status(200).json(report);
  } catch (err: any) {
    return res.status(400).json({ error: err?.message || 'Bad request' });
  }
}
