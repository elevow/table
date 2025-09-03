import type { NextApiRequest, NextApiResponse } from 'next';
import { Pool } from 'pg';
import { rateLimit } from '../../../src/lib/api/rate-limit';
import { FriendService } from '../../../src/lib/services/friend-service';
import { getWsManager } from '../../../src/lib/api/socket-server';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const ip = (req.headers['x-forwarded-for'] as string) || req.socket.remoteAddress || 'anon';
  const rl = rateLimit(`POST /api/friends/invite-respond:${ip}`, { windowMs: 60 * 60 * 1000, max: 120 });
  if (!rl.allowed) return res.status(429).json({ error: 'Too many requests. Please slow down.' });

  try {
    const { id, action } = (req.body || {}) as { id?: string; action?: 'accept' | 'decline' };
    if (!id || (action !== 'accept' && action !== 'decline')) return res.status(400).json({ error: 'Missing id or invalid action' });
    const pool = new Pool();
    const service = new FriendService(pool as any);
    const invite = await service.respondToInvite(id, action);

    // Realtime: notify both inviter and invitee personal rooms of update
    const ws = getWsManager(res);
    if (ws) {
      try {
        ws.broadcast('friends:invite_updated', { invite }, invite.inviterId);
        ws.broadcast('friends:invite_updated', { invite }, invite.inviteeId);
      } catch (_) {
        // ignore websocket errors; API response should remain successful
      }
    }

    return res.status(200).json(invite);
  } catch (e: any) {
    const status = e?.code === 'NOT_FOUND' ? 404 : 500;
    return res.status(status).json({ error: e?.message || 'Internal error' });
  }
}
