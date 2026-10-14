import type { NextApiRequest, NextApiResponse } from 'next';
import { rateLimit } from '../../../src/lib/api/rate-limit';
import { tournamentManager } from '../../../src/lib/tournament/manager-instance';
import { requirePlayer } from '../../../src/lib/auth/auth-utils';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const rl = rateLimit(req, { limit: 120, windowMs: 60_000 });
  if (!rl.allowed) return res.status(429).json({ error: 'Too many requests' });
  try {
    const { tournamentId, userId: claimedUserId } = req.body || {};
    const userId = await requirePlayer(req, res, claimedUserId);
    if (!userId) return;
    if (!tournamentId) return res.status(400).json({ error: 'Missing tournamentId' });
    const t = tournamentManager.addOn({ tournamentId, userId });
    return res.status(200).json(t);
  } catch (err: any) {
    return res.status(400).json({ error: err?.message || 'Bad request' });
  }
}
