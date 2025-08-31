import type { NextApiRequest, NextApiResponse } from 'next';
import { Pool } from 'pg';
import { rateLimit } from '../../../src/lib/api/rate-limit';
import { PlayerStatisticsService } from '../../../src/lib/services/player-statistics-service';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const rl = rateLimit(req, { limit: 120, windowMs: 60_000 });
  if (!rl.allowed) return res.status(429).json({ error: 'Too many requests' });
  try {
    const userId = String(req.query.userId || '');
    const pool = new Pool();
    const svc = new PlayerStatisticsService(pool);
    const stats = await svc.getOrCreate(userId);
    return res.status(200).json(stats);
  } catch (err: any) {
    return res.status(400).json({ error: err?.message || 'Bad request' });
  }
}
