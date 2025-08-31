import type { NextApiRequest, NextApiResponse } from 'next';
import { Pool } from 'pg';
import { rateLimit } from '../../../src/lib/api/rate-limit';
import { FriendService } from '../../../src/lib/services/friend-service';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const ip = (req.headers['x-forwarded-for'] as string) || req.socket.remoteAddress || 'anon';
  const rl = rateLimit(`POST /api/friends/unblock:${ip}`, { windowMs: 60 * 60 * 1000, max: 60 });
  if (!rl.allowed) return res.status(429).json({ error: 'Too many requests. Please slow down.' });

  try {
    const { userId, blockedId } = (req.body || {}) as { userId?: string; blockedId?: string };
    if (!userId || !blockedId) return res.status(400).json({ error: 'Missing userId or blockedId' });
    const pool = new Pool();
    const service = new FriendService(pool as any);
    await service.unblock(userId, blockedId);
    return res.status(200).json({ success: true });
  } catch (e: any) {
    return res.status(500).json({ error: e?.message || 'Internal error' });
  }
}
