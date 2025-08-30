import type { NextApiRequest, NextApiResponse } from 'next';
import { Pool } from 'pg';
import { AvatarService } from '../../../src/lib/services/avatar-service';
import { rateLimit } from '../../../src/lib/api/rate-limit';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const ip = (req.headers['x-forwarded-for'] as string) || req.socket.remoteAddress || 'anon';
  const rl = rateLimit(`GET /api/avatars/:userId:${ip}`, { windowMs: 60 * 1000, max: 60 });
  if (!rl.allowed) return res.status(429).json({ error: 'Too many requests. Please slow down.' });

  try {
    const { userId } = req.query as { userId: string };
    const pool = new Pool();
    const service = new AvatarService(pool as any);
    const avatar = await service.getLatestForUser(userId);
    if (!avatar) return res.status(404).json({ error: 'Not found' });
    return res.status(200).json({ id: avatar.id, url: avatar.originalUrl, thumbnails: avatar.variants, status: avatar.status });
  } catch (e: any) {
    return res.status(500).json({ error: e?.message || 'Internal error' });
  }
}
