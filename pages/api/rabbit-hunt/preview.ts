import type { NextApiRequest, NextApiResponse } from 'next';
import { Pool } from 'pg';
import { rateLimit } from '../../../src/lib/api/rate-limit';
import { RabbitHuntService } from '../../../src/lib/services/rabbit-hunt-service';
import { createSafeAudit } from '../../../src/lib/api/audit';

function getClientIp(req: NextApiRequest): string {
  const fwd = (req.headers['x-forwarded-for'] as string) || '';
  return (fwd.split(',').map(s => s.trim())[0]) || (req.socket.remoteAddress || 'unknown');
}

function getCallerUserId(req: NextApiRequest): string | null {
  const fromHeader = (req.headers['x-user-id'] as string) || '';
  const fromQuery = (req.query && (req.query as any).userId as string) || '';
  return (fromHeader || fromQuery) || null;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const rl = rateLimit(req, { limit: 300, windowMs: 60_000 });
  if (!rl.allowed) return res.status(429).json({ error: 'Too many requests' });
  try {
    const pool = new Pool();
    const svc = new RabbitHuntService(pool);
    const safeLog = createSafeAudit(pool);

    const callerUserId = getCallerUserId(req);
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
    const pool = new Pool();
    const safeLog = createSafeAudit(pool);
    const callerUserId = getCallerUserId(req) || '00000000-0000-0000-0000-000000000000';
    const ip = getClientIp(req);
    const userAgent = (req.headers['user-agent'] as string) || '';
    const meta = { ip, userAgent, endpoint: '/api/rabbit-hunt/preview' } as Record<string, any>;
    await safeLog(callerUserId, 'rabbit_hunt', 'preview', false, { ...meta, reason: err?.message || 'error' });
    // If RLS hides the active game or room not found
    const status = err?.message === 'No active game for room' ? 403 : 400;
    return res.status(status).json({ error: err?.message || 'Bad request' });
  }
}
