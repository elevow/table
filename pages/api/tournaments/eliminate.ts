import type { NextApiRequest, NextApiResponse } from 'next';
import { rateLimit } from '../../../src/lib/api/rate-limit';
import { tournamentManager } from '../../../src/lib/tournament/manager-instance';
import { requireOrganizer } from '../../../src/lib/tournament/require-organizer';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const rl = rateLimit(req, { limit: 120, windowMs: 60_000 });
  if (!rl.allowed) return res.status(429).json({ error: 'Too many requests' });
  const { tournamentId, userId, eliminatedBy } = req.body || {};
  if (!(await requireOrganizer(req, res, 'tournament.eliminate', tournamentId))) return;
  if (!userId) return res.status(400).json({ error: 'Missing userId' });
  try {
    const t = await tournamentManager.eliminate({ tournamentId, userId: String(userId), eliminatedBy: eliminatedBy ? String(eliminatedBy) : undefined });
    return res.status(200).json(t);
  } catch (err: any) {
    return res.status(400).json({ error: err?.message || 'Bad request' });
  }
}
