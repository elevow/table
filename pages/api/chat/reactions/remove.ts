import { ChatService } from '../../../../src/lib/services/chat-service';
import { publishChatReactionRemoved } from '../../../../src/lib/realtime/publisher';
import { getPool } from '../../../../src/lib/database/pool';
import { requirePlayer } from '../../../../src/lib/auth/auth-utils';
import { apiHandler } from '../../../../src/lib/api/handler';

export default apiHandler({ methods: 'POST', rateLimit: { windowMs: 60_000, max: 300, message: 'Too many requests' } }, async (req, res) => {
  // Reactions belong to the signed-in user; a userId in the body must match the session
  const userId = await requirePlayer(req, res, req.body?.userId);
  if (!userId) return;
  try {
    const { messageId, emoji } = req.body || {};
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
});
