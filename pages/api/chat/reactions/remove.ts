import type { NextApiRequest, NextApiResponse } from 'next';
import { rateLimit } from '../../../../src/lib/api/rate-limit';
import { ChatService } from '../../../../src/lib/services/chat-service';
import { publishChatReactionRemoved } from '../../../../src/lib/realtime/publisher';
import { getPool } from '../../../../src/lib/database/pool';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const rl = rateLimit(req, { limit: 300, windowMs: 60_000 });
  if (!rl.allowed) return res.status(429).json({ error: 'Too many requests' });
  try {
    const { messageId, userId, emoji } = req.body || {};
    const pool = getPool();
    const svc = new ChatService(pool);
    const result = await svc.removeReaction({ messageId, userId, emoji });
    // Broadcast a decrement event so other clients can update instantly
    let roomId: string | null = null;
    try {
      const { rows } = await pool.query('SELECT room_id FROM chat_messages WHERE id = $1', [messageId]);
      roomId = rows?.[0]?.room_id ?? null;
    } catch {
      // Optionally log error, but continue
    }
    // Broadcast via Supabase Realtime
    if (roomId) {
      try {
        await publishChatReactionRemoved(roomId, { messageId, emoji, userId });
      } catch {
        // Optionally log error, but continue
      }
    }
    return res.status(200).json(result);
  } catch (err: any) {
    return res.status(400).json({ error: err?.message || 'Bad request' });
  }
}
