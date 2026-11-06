import { ChatService } from '../../../src/lib/services/chat-service';
import { publishChatModerated } from '../../../src/lib/realtime/publisher';
import { getPool } from '../../../src/lib/database/pool';
import { requirePermission } from '../../../src/lib/auth/access-control';
import { apiHandler } from '../../../src/lib/api/handler';

export default apiHandler({ methods: 'POST', rateLimit: { windowMs: 60_000, max: 120, message: 'Too many requests' } }, async (req, res) => {
  // The moderator is the signed-in user, never a client-supplied ID
  const moderator = await requirePermission(req, res, 'chat.moderate');
  if (!moderator) return;
  const moderatorId = moderator.userId;
  try {
    const { messageId, hide } = req.body || {};
    const pool = getPool();
    const svc = new ChatService(pool);
    const updated = await svc.moderate(String(messageId), String(moderatorId), hide !== false);
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
        await publishChatModerated(roomId, { messageId, hidden: hide !== false, moderatorId });
      } catch {
        // Continue if Supabase broadcast fails
      }
    }
    return res.status(200).json(updated);
  } catch (err: any) {
    return res.status(400).json({ error: err?.message || 'Bad request' });
  }
});
