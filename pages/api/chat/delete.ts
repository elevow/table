import type { NextApiRequest, NextApiResponse } from 'next';
import { rateLimit } from '../../../src/lib/api/rate-limit';
import { ChatService } from '../../../src/lib/services/chat-service';
import { publishChatDeleted } from '../../../src/lib/realtime/publisher';
import { getPool } from '../../../src/lib/database/pool';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const rl = rateLimit(req, { limit: 120, windowMs: 60_000 });
  if (!rl.allowed) return res.status(429).json({ error: 'Too many requests' });
  try {
    const { messageId, userId, isAdmin } = req.body || {};
    if (!messageId) return res.status(400).json({ error: 'messageId required' });
    if (!userId) return res.status(400).json({ error: 'userId required' });
    
    const pool = getPool();
    const svc = new ChatService(pool);
    const result = await svc.delete({
      messageId: String(messageId),
      userId: String(userId),
      isAdmin: isAdmin === true
    });
    
    // Broadcast via Supabase Realtime if there's a room
    if (result.roomId) {
      try {
        await publishChatDeleted(result.roomId, { messageId: String(messageId), deletedBy: String(userId) });
      } catch {
        // Continue if Supabase broadcast fails
      }
    }
    
    return res.status(200).json({ deleted: result.deleted });
  } catch (err: any) {
    if (err?.message === 'not authorized to delete this message') {
      return res.status(403).json({ error: err.message });
    }
    if (err?.message === 'message not found') {
      return res.status(404).json({ error: err.message });
    }
    return res.status(400).json({ error: err?.message || 'Bad request' });
  }
}
