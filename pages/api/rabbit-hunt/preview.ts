import type { NextApiRequest } from 'next';
import { getPool } from '../../../src/lib/database/pool';
import { RabbitHuntService } from '../../../src/lib/services/rabbit-hunt-service';
import { createSafeAudit } from '../../../src/lib/api/audit';
import { getAuthenticatedUserId } from '../../../src/lib/auth/auth-utils';
import { apiHandler } from '../../../src/lib/api/handler';

function getClientIp(req: NextApiRequest): string {
  const fwd = (req.headers['x-forwarded-for'] as string) || '';
  return (fwd.split(',').map(s => s.trim())[0]) || (req.socket.remoteAddress || 'unknown');
}

export default apiHandler({ methods: 'GET', rateLimit: { windowMs: 60_000, max: 300, message: 'Too many requests' } }, async (req, res) => {
  // The caller comes from the session, never from a client-supplied header or query param
  const callerUserId = await getAuthenticatedUserId(req);
  try {
    const pool = getPool();
    const svc = new RabbitHuntService(pool);
    const safeLog = createSafeAudit(pool);

    if (!callerUserId) {
      await safeLog('00000000-0000-0000-0000-000000000000', 'rabbit_hunt', 'preview', false, { reason: 'unauthorized' });
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const ip = getClientIp(req);
    const userAgent = (req.headers['user-agent'] as string) || '';
    const meta = { ip, userAgent, endpoint: '/api/rabbit-hunt/preview' } as Record<string, any>;

    const { roomId, street, knownCards, communityCards } = req.query as any;
    const known = typeof knownCards === 'string' ? knownCards.split(',').filter(Boolean) : Array.isArray(knownCards) ? knownCards : [];
    const community = typeof communityCards === 'string' ? communityCards.split(',').filter(Boolean) : Array.isArray(communityCards) ? communityCards : [];
    const result = await svc.preview({ roomId, street, knownCards: known, communityCards: community, callerUserId });
    await safeLog(callerUserId, 'rabbit_hunt', 'preview', true, { ...meta, roomId, street });
    return res.status(200).json(result);
  } catch (err: any) {
    const pool = getPool();
    const safeLog = createSafeAudit(pool);
    const ip = getClientIp(req);
    const userAgent = (req.headers['user-agent'] as string) || '';
    const meta = { ip, userAgent, endpoint: '/api/rabbit-hunt/preview' } as Record<string, any>;
    await safeLog(callerUserId || '00000000-0000-0000-0000-000000000000', 'rabbit_hunt', 'preview', false, { ...meta, reason: err?.message || 'error' });
    // If RLS hides the active game or room not found
    const status = err?.message === 'No active game for room' ? 403 : 400;
    return res.status(status).json({ error: err?.message || 'Bad request' });
  }
});
