import type { NextApiRequest, NextApiResponse } from 'next';
import { Pool } from 'pg';
import { rateLimit } from '../../../../src/lib/api/rate-limit';
import { getWsManager } from '../../../../src/lib/api/socket-server';
import { ChatService } from '../../../../src/lib/services/chat-service';
import { publishChatReaction } from '../../../../src/lib/realtime/publisher';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const rl = rateLimit(req, { limit: 300, windowMs: 60_000 });
  if (!rl.allowed) return res.status(429).json({ error: 'Too many requests' });
  try {
    const { messageId, userId, emoji } = req.body || {};
    const pool = new Pool();
    const svc = new ChatService(pool);
    const reaction = await svc.addReaction({ messageId, userId, emoji });
    // Determine room and emit reaction event to the table room
    let roomId: string | null = null;
    try {
      const { rows } = await pool.query('SELECT room_id FROM chat_messages WHERE id = $1', [messageId]);
      roomId = rows?.[0]?.room_id ?? null;
      // Broadcast via Socket.IO
      const ws = getWsManager(res);
      if (ws && roomId) {
        ws.broadcast('chat:reaction', { messageId, emoji, userId }, roomId);
      }
    } catch {}
    // Broadcast via Supabase Realtime
    try {
      if (roomId) {
        await publishChatReaction(roomId, { messageId, emoji, userId });
      }
    } catch {}
    return res.status(201).json(reaction);
  } catch (err: any) {
    return res.status(400).json({ error: err?.message || 'Bad request' });
  }
}
