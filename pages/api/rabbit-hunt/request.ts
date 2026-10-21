import type { NextApiRequest, NextApiResponse } from 'next';
import { Pool } from 'pg';
import { rateLimit } from '../../../src/lib/api/rate-limit';
import { RabbitHuntService } from '../../../src/lib/services/rabbit-hunt-service';
import { requirePlayer } from '../../../src/lib/auth/auth-utils';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const rl = rateLimit(req, { limit: 120, windowMs: 60_000 });
  if (!rl.allowed) return res.status(429).json({ error: 'Too many requests' });
  // Reveals and cooldowns are recorded for the signed-in user only
  const userId = await requirePlayer(req, res, req.body?.userId);
  if (!userId) return;
  try {
    const pool = new Pool();
    const svc = new RabbitHuntService(pool);
    const record = await svc.requestReveal({ ...(req.body || {}), userId });
    return res.status(201).json(record);
  } catch (err: any) {
    return res.status(400).json({ error: err?.message || 'Bad request' });
  }
}
