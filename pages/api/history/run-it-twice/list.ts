import { getPool } from '../../../../src/lib/database/pool';
import { HandHistoryService } from '../../../../src/lib/services/hand-history-service';
import { apiHandler } from '../../../../src/lib/api/handler';

export default apiHandler({ methods: 'GET', rateLimit: { windowMs: 60_000, max: 120, message: 'Too many requests' } }, async (req, res) => {
  try {
    const handId = String((req.query as any).handId || '');
    const pool = getPool();
    const service = new HandHistoryService(pool);
    const list = await service.listRunItTwiceOutcomes(handId);
    return res.status(200).json(list);
  } catch (err: any) {
    return res.status(400).json({ error: err?.message || 'Bad request' });
  }
});
