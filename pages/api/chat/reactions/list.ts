import { ChatService } from '../../../../src/lib/services/chat-service';
import { getPool } from '../../../../src/lib/database/pool';
import { apiHandler } from '../../../../src/lib/api/handler';

export default apiHandler({ methods: 'GET', rateLimit: { windowMs: 60_000, max: 300, message: 'Too many requests' } }, async (req, res) => {
  try {
    const { messageId } = req.query;
    const pool = getPool();
    const svc = new ChatService(pool);
    const items = await svc.listReactions(String(messageId));
    return res.status(200).json({ items });
  } catch (err: any) {
    return res.status(400).json({ error: err?.message || 'Bad request' });
  }
});
