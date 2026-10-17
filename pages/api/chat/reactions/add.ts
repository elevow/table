import type { NextApiRequest, NextApiResponse } from 'next';
import { rateLimit } from '../../../../src/lib/api/rate-limit';
import { ChatService } from '../../../../src/lib/services/chat-service';
import { publishChatReaction } from '../../../../src/lib/realtime/publisher';
import { getPool } from '../../../../src/lib/database/pool';
import { requirePlayer } from '../../../../src/lib/auth/auth-utils';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const rl = rateLimit(req, { limit: 300, windowMs: 60_000 });
  if (!rl.allowed) return res.status(429).json({ error: 'Too many requests' });
  // Reactions belong to the signed-in user; a userId in the body must match the session
  const userId = await requirePlayer(req, res, req.body?.userId);
  if (!userId) return;
  try {
    const { messageId, emoji } = req.body || {};
    const pool = getPool();
    const svc = new ChatService(pool);
    const reaction = await svc.addReaction({ messageId, userId, emoji });
    // Determine room for broadcasting
    let roomId: string | null = null;
    try {
      const { rows } = await pool.query('SELECT room_id FROM chat_messages WHERE id = $1', [messageId]);
      roomId = rows?.[0]?.room_id ?? null;
    } catch {
      // Continue without roomId
    }
    // Broadcast via Supabase Realtime
    if (roomId) {
      try {
        await publishChatReaction(roomId, { messageId, emoji, userId });
      } catch {
        // Continue if Supabase broadcast fails
      }
    }
    return res.status(201).json(reaction);
  } catch (err: any) {
    return res.status(400).json({ error: err?.message || 'Bad request' });
  }
}
