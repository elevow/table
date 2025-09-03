import type { NextApiRequest, NextApiResponse } from 'next';
import { Pool } from 'pg';
import { rateLimit } from '../../../../src/lib/api/rate-limit';
import { getWsManager } from '../../../../src/lib/api/socket-server';
import { ChatService } from '../../../../src/lib/services/chat-service';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const rl = rateLimit(req, { limit: 300, windowMs: 60_000 });
  if (!rl.allowed) return res.status(429).json({ error: 'Too many requests' });
  try {
    const { messageId, userId, emoji } = req.body || {};
    const pool = new Pool();
    const svc = new ChatService(pool);
    const result = await svc.removeReaction({ messageId, userId, emoji });
    // Broadcast a decrement event so other clients can update instantly
    try {
      const { rows } = await pool.query('SELECT room_id FROM chat_messages WHERE id = $1', [messageId]);
      const roomId: string | null = rows?.[0]?.room_id ?? null;
      const ws = getWsManager(res);
      if (ws && roomId) {
        ws.broadcast('chat:reaction_removed', { messageId, emoji, userId }, roomId);
      }
    } catch {}
    return res.status(200).json(result);
  } catch (err: any) {
    return res.status(400).json({ error: err?.message || 'Bad request' });
  }
}
