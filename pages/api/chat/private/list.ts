import { ChatService } from '../../../../src/lib/services/chat-service';
import { getPool } from '../../../../src/lib/database/pool';
import { requirePlayer } from '../../../../src/lib/auth/auth-utils';
import { apiHandler } from '../../../../src/lib/api/handler';

export default apiHandler({ methods: 'GET', rateLimit: { windowMs: 60_000, max: 300, message: 'Too many requests' } }, async (req, res) => {
  const userId = await requirePlayer(req, res);
  if (!userId) return;
  const { userAId, userBId, limit, before } = req.query;
  // Only the two people in a private conversation may read it
  if (String(userAId) !== userId && String(userBId) !== userId) {
    return res.status(403).json({ error: 'Not a participant in this conversation' });
  }
  try {
    const pool = getPool();
    const svc = new ChatService(pool);
    const items = await svc.listPrivate({ userAId: String(userAId), userBId: String(userBId), limit: limit ? Number(limit) : undefined, before: before ? String(before) : undefined });
    return res.status(200).json({ items });
  } catch (err: any) {
    return res.status(400).json({ error: err?.message || 'Bad request' });
  }
});
