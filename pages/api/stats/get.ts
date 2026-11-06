import { getPool } from '../../../src/lib/database/pool';
import { PlayerStatisticsService } from '../../../src/lib/services/player-statistics-service';
import { apiHandler } from '../../../src/lib/api/handler';

export default apiHandler({ methods: 'GET', rateLimit: { windowMs: 60_000, max: 120, message: 'Too many requests' } }, async (req, res) => {
  try {
    const userId = String(req.query.userId || '');
    // The app's configured connection (new Pool() would ignore DATABASE_URL and SSL settings)
    const pool = getPool();
    const svc = new PlayerStatisticsService(pool);
    const stats = await svc.getOrCreate(userId);
    return res.status(200).json(stats);
  } catch (err: any) {
    return res.status(400).json({ error: err?.message || 'Bad request' });
  }
});
