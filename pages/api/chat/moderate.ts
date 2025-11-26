import type { NextApiRequest, NextApiResponse } from 'next';
import { Pool } from 'pg';
import { rateLimit } from '../../../src/lib/api/rate-limit';
import { getWsManager } from '../../../src/lib/api/socket-server';
import { ChatService } from '../../../src/lib/services/chat-service';
import { publishChatModerated } from '../../../src/lib/realtime/publisher';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const rl = rateLimit(req, { limit: 120, windowMs: 60_000 });
  if (!rl.allowed) return res.status(429).json({ error: 'Too many requests' });
  try {
    const { messageId, moderatorId, hide } = req.body || {};
    const pool = new Pool();
    const svc = new ChatService(pool);
    const updated = await svc.moderate(String(messageId), String(moderatorId), hide !== false);
    let roomId: string | null = null;
    try {
      const { rows } = await pool.query('SELECT room_id FROM chat_messages WHERE id = $1', [messageId]);
      roomId = rows?.[0]?.room_id ?? null;
      // Broadcast via Socket.IO
      const ws = getWsManager(res);
      if (ws && roomId) {
        ws.broadcast('chat:moderated', { messageId, hidden: hide !== false, moderatorId }, roomId);
      }
    } catch {}
    // Broadcast via Supabase Realtime
    try {
      if (roomId) {
        await publishChatModerated(roomId, { messageId, hidden: hide !== false, moderatorId });
      }
    } catch {}
    return res.status(200).json(updated);
  } catch (err: any) {
    return res.status(400).json({ error: err?.message || 'Bad request' });
  }
}
