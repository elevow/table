import { getPool } from '../../../../src/lib/database/pool';
import { GameService } from '../../../../src/lib/services/game-service';
import { createSafeAudit } from '../../../../src/lib/api/audit';
import { apiHandler } from '../../../../src/lib/api/handler';

export default apiHandler({ methods: 'GET', rateLimit: { windowMs: 60_000, max: 60, message: 'Too many requests' } }, async (req, res) => {
  const pool = getPool();
  const safeLog = createSafeAudit(pool);

  try {
    const service = new GameService(pool);
    const page = Number(req.query.page || 1);
    const limit = Number(req.query.limit || 20);
    const data = await service.listRooms(page, limit);
    return res.status(200).json(data);
  } catch (err: any) {
    await safeLog(
      '00000000-0000-0000-0000-000000000000',
      'games',
      'list_rooms',
      false,
      { endpoint: '/api/games/rooms/list', reason: err?.message || 'error' }
    );
    return res.status(400).json({ error: err?.message || 'Bad request' });
  }
});
