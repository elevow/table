import type { NextApiRequest, NextApiResponse } from 'next';
import { Pool } from 'pg';
import { rateLimit } from '../../../../src/lib/api/rate-limit';
import { GameService } from '../../../../src/lib/services/game-service';
import { createSafeAudit } from '../../../../src/lib/api/audit';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const rl = rateLimit(req, { limit: 60, windowMs: 60_000 });
  if (!rl.allowed) return res.status(429).json({ error: 'Too many requests' });

  const pool = new Pool();
  const safeLog = createSafeAudit(pool);

  try {
    const service = new GameService(pool);
    const page = Number(req.query.page || 1);
    const limit = Number(req.query.limit || 20);
    const data = await service.listRooms(page, limit);
    return res.status(200).json(data);
  } catch (err: any) {
    await safeLog(
      '00000000-0000-0000-0000-000000000000',
      'games',
      'list_rooms',
      false,
      { endpoint: '/api/games/rooms/list', reason: err?.message || 'error' }
    );
    return res.status(400).json({ error: err?.message || 'Bad request' });
  }
}
