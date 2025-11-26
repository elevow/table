import type { NextApiRequest, NextApiResponse } from 'next';
import { getPool } from '../../../../src/lib/database/pool';
import { rateLimit } from '../../../../src/lib/api/rate-limit';
import { GameService } from '../../../../src/lib/services/game-service';
import { createSafeAudit } from '../../../../src/lib/api/audit';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const rl = rateLimit(req, { limit: 60, windowMs: 60_000 });
  if (!rl.allowed) return res.status(429).json({ error: 'Too many requests' });
  const pool = getPool();
  const safeLog = createSafeAudit(pool);
  try {
    const service = new GameService(pool);
    const game = await service.updateActiveGame(req.body);
    return res.status(200).json(game);
  } catch (err: any) {
    await safeLog(
      '00000000-0000-0000-0000-000000000000',
      'games',
      'update',
      false,
      { endpoint: '/api/games/active/update', reason: err?.message || 'error' }
    );
    return res.status(400).json({ error: err?.message || 'Bad request' });
  }
}
