import type { NextApiRequest, NextApiResponse } from 'next';
import { Pool } from 'pg';
import { rateLimit } from '../../../src/lib/api/rate-limit';
import { getWsManager } from '../../../src/lib/api/socket-server';
import { ChatService } from '../../../src/lib/services/chat-service';
import { publishChatMessage } from '../../../src/lib/realtime/publisher';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const rl = rateLimit(req, { limit: 300, windowMs: 60_000 });
  if (!rl.allowed) return res.status(429).json({ error: 'Too many requests' });
  try {
    const pool = new Pool();
    const svc = new ChatService(pool);
    const msg = await svc.send(req.body);
    // Authoritative server-side emit to room after DB write
    // Broadcast via Socket.IO
    try {
      const ws = getWsManager(res);
      if (ws && msg?.roomId) {
        ws.broadcast('chat:new_message', { message: msg }, msg.roomId);
      }
    } catch {}
    // Broadcast via Supabase Realtime
    try {
      if (msg?.roomId) {
        await publishChatMessage(msg.roomId, { message: msg });
      }
    } catch {}
    return res.status(201).json(msg);
  } catch (err: any) {
    return res.status(400).json({ error: err?.message || 'Bad request' });
  }
}
