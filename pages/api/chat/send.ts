import { ChatService } from '../../../src/lib/services/chat-service';
import { publishChatMessage } from '../../../src/lib/realtime/publisher';
import { getPool } from '../../../src/lib/database/pool';
import {
  getLimit, hasPermission, requirePlayerAccess, sendLimitReached, sendPermissionDenied,
} from '../../../src/lib/auth/access-control';
import { loadRoom } from '../../../src/lib/server/room-config';
import { PRIVATE_TABLE_RESPONSE, canEnterRoom } from '../../../src/lib/server/room-privacy';
import { withSenderNames } from '../../../src/lib/server/chat-senders';
import { apiHandler } from '../../../src/lib/api/handler';

export default apiHandler({ methods: 'POST', rateLimit: { windowMs: 60_000, max: 300, message: 'Too many requests' } }, async (req, res) => {
  // Messages are sent as the signed-in user; a senderId in the body must match the session
  const access = await requirePlayerAccess(req, res, req.body?.senderId);
  if (!access) return;
  const permission = req.body?.isPrivate ? 'chat.private' : 'chat.send';
  if (!hasPermission(access, permission)) return sendPermissionDenied(res, permission, access);
  const senderId = access.userId;
  try {
    const pool = getPool();
    // Counted from saved messages, so the limit holds across server instances
    const perMinute = getLimit(access, 'chat.per_minute');
    if (perMinute !== null) {
      const recent = await pool.query(
        `SELECT COUNT(*)::int AS n FROM chat_messages WHERE sender_id = $1 AND sent_at > NOW() - INTERVAL '1 minute'`,
        [senderId]
      ).then(r => Number(r.rows?.[0]?.n) || 0, () => 0);
      if (recent >= perMinute) return sendLimitReached(res, 'chat.per_minute', perMinute);
    }
    // Table chat in a private room is for the people allowed at the table
    const roomId = req.body?.isPrivate ? null : req.body?.roomId;
    if (typeof roomId === 'string' && roomId) {
      const room = await loadRoom(roomId);
      if (room && !canEnterRoom(access, room)) return res.status(403).json(PRIVATE_TABLE_RESPONSE);
    }
    const svc = new ChatService(pool);
    const sent = await svc.send({ ...(req.body || {}), senderId });
    // The sender's name goes out with the message so others can see who wrote it, and mute them
    const msg = sent?.roomId ? (await withSenderNames([sent]))[0] : sent;
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
});
