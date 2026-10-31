import type { NextApiRequest, NextApiResponse } from 'next';
import { rateLimit } from '../../../src/lib/api/rate-limit';
import { ChatService } from '../../../src/lib/services/chat-service';
import { publishChatMessage } from '../../../src/lib/realtime/publisher';
import { getPool } from '../../../src/lib/database/pool';
import {
  getLimit, hasPermission, requirePlayerAccess, sendLimitReached, sendPermissionDenied,
} from '../../../src/lib/auth/access-control';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const rl = rateLimit(req, { limit: 300, windowMs: 60_000 });
  if (!rl.allowed) return res.status(429).json({ error: 'Too many requests' });
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
    const svc = new ChatService(pool);
    const msg = await svc.send({ ...(req.body || {}), senderId });
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
