import type { NextApiRequest, NextApiResponse } from 'next';
import { Pool } from 'pg';
import { rateLimit } from '../../../../src/lib/api/rate-limit';
import { GameService } from '../../../../src/lib/services/game-service';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const rl = rateLimit(req, { limit: 60, windowMs: 60_000 });
  if (!rl.allowed) return res.status(429).json({ error: 'Too many requests' });

  try {
    const pool = new Pool();
    const service = new GameService(pool);
    const room = await service.createRoom(req.body);
    return res.status(201).json(room);
  } catch (err: any) {
    return res.status(400).json({ error: err?.message || 'Bad request' });
  }
}
