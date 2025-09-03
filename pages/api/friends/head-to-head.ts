import type { NextApiRequest, NextApiResponse } from 'next';
import { Pool } from 'pg';
import { rateLimit } from '../../../src/lib/api/rate-limit';
import { FriendService } from '../../../src/lib/services/friend-service';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const ip = (req.headers['x-forwarded-for'] as string) || req.socket.remoteAddress || 'anon';
  const rl = rateLimit(`GET /api/friends/head-to-head:${ip}`, { windowMs: 60 * 1000, max: 240 });
  if (!rl.allowed) return res.status(429).json({ error: 'Too many requests. Please slow down.' });

  try {
    const { a, b } = req.query as { a?: string; b?: string };
    if (!a || !b) return res.status(400).json({ error: 'Missing a or b' });
    const pool = new Pool();
    const service = new FriendService(pool as any);
    const h2h = await service.headToHead(a, b);
    return res.status(200).json(h2h);
  } catch (e: any) {
    return res.status(500).json({ error: e?.message || 'Internal error' });
  }
}
