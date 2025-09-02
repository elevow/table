import type { NextApiRequest, NextApiResponse } from 'next';
import { rateLimit } from '../../../src/lib/api/rate-limit';
import { tournamentManager } from '../../../src/lib/tournament/manager-instance';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const rl = rateLimit(req, { limit: 120, windowMs: 60_000 });
  if (!rl.allowed) return res.status(429).json({ error: 'Too many requests' });
  try {
    const { tournamentId, prizePool } = (req.query || {}) as any;
    if (!tournamentId || prizePool == null) return res.status(400).json({ error: 'Missing tournamentId or prizePool' });
    const amount = Number(prizePool);
    if (!Number.isFinite(amount) || amount < 0) return res.status(400).json({ error: 'Invalid prizePool' });
    const result = tournamentManager.payouts(tournamentId, amount);
    return res.status(200).json(result);
  } catch (err: any) {
    return res.status(400).json({ error: err?.message || 'Bad request' });
  }
}
