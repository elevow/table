import { getPool } from '../../../src/lib/database/pool';
import { RabbitHuntService } from '../../../src/lib/services/rabbit-hunt-service';
import { requirePlayer } from '../../../src/lib/auth/auth-utils';
import { apiHandler } from '../../../src/lib/api/handler';

export default apiHandler({ methods: 'POST', rateLimit: { windowMs: 60_000, max: 120, message: 'Too many requests' } }, async (req, res) => {
  // Reveals and cooldowns are recorded for the signed-in user only
  const userId = await requirePlayer(req, res, req.body?.userId, 'game.rabbit_hunt');
  if (!userId) return;
  try {
    const pool = getPool();
    const svc = new RabbitHuntService(pool);
    const record = await svc.requestReveal({ ...(req.body || {}), userId });
    return res.status(201).json(record);
  } catch (err: any) {
    return res.status(400).json({ error: err?.message || 'Bad request' });
  }
});
