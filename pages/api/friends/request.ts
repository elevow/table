import type { NextApiRequest, NextApiResponse } from 'next';
import { Pool } from 'pg';
import { rateLimit } from '../../../src/lib/api/rate-limit';
import { FriendService } from '../../../src/lib/services/friend-service';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const ip = (req.headers['x-forwarded-for'] as string) || req.socket.remoteAddress || 'anon';
  const rl = rateLimit(`POST /api/friends/request:${ip}`, { windowMs: 60 * 60 * 1000, max: 60 });
  if (!rl.allowed) return res.status(429).json({ error: 'Too many requests. Please slow down.' });

  try {
    const { requesterId, recipientId } = (req.body || {}) as { requesterId?: string; recipientId?: string };
    if (!requesterId || !recipientId) return res.status(400).json({ error: 'Missing requesterId or recipientId' });
    const pool = new Pool();
    const service = new FriendService(pool as any);
    const fr = await service.sendRequest(requesterId, recipientId);
    return res.status(201).json(fr);
  } catch (e: any) {
    const message = e?.code ? `${e.code}: ${e.message}` : (e?.message || 'Internal error');
    const status = e?.code === 'BLOCKED' || e?.code === 'DUPLICATE' || e?.code === 'ALREADY_FRIENDS' || e?.code === 'INVALID' ? 400 : 500;
    return res.status(status).json({ error: message });
  }
}
