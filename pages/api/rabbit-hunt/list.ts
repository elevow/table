import { getPool } from '../../../src/lib/database/pool';
import { RabbitHuntService } from '../../../src/lib/services/rabbit-hunt-service';
import { apiHandler } from '../../../src/lib/api/handler';

export default apiHandler({ methods: 'GET', rateLimit: { windowMs: 60_000, max: 300, message: 'Too many requests' } }, async (req, res) => {
  try {
    const pool = getPool();
    const svc = new RabbitHuntService(pool);
    const { handId, limit } = req.query as any;
    const items = await svc.listReveals({ handId, limit: limit ? Number(limit) : undefined });
    return res.status(200).json({ items });
  } catch (err: any) {
    return res.status(400).json({ error: err?.message || 'Bad request' });
  }
});
