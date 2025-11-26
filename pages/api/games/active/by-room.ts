import type { NextApiRequest, NextApiResponse } from 'next';
import { getPool } from '../../../../src/lib/database/pool';
import { rateLimit } from '../../../../src/lib/api/rate-limit';
import { GameService } from '../../../../src/lib/services/game-service';
import { createSafeAudit } from '../../../../src/lib/api/audit';

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
  const rl = rateLimit(req, { limit: 60, windowMs: 60_000 });
  if (!rl.allowed) return res.status(429).json({ error: 'Too many requests' });
  const pool = getPool();
  const safeLog = createSafeAudit(pool);
  const ip = getClientIp(req);
  const userAgent = (req.headers['user-agent'] as string) || '';
  const meta = { ip, userAgent, endpoint: '/api/games/active/by-room' } as Record<string, any>;
  try {
    const service = new GameService(pool);
    const roomId = String(req.query.roomId || '');
    const callerUserId = getCallerUserId(req);
    const game = callerUserId
      ? await service.getActiveGameByRoom(roomId, callerUserId)
      : await service.getActiveGameByRoom(roomId);

    if (callerUserId) {
      await safeLog(callerUserId, 'games', 'read', Boolean(game), { ...meta, roomId, reason: game ? undefined : 'forbidden' });
    } else {
      // Spectator access: success if public game is visible; otherwise log as unauthorized
      await safeLog('00000000-0000-0000-0000-000000000000', 'games', 'read', Boolean(game), { ...meta, roomId, as: 'spectator', reason: game ? 'spectator' : 'unauthorized' });
    }

    return res.status(200).json(game);
  } catch (err: any) {
    const callerUserId = getCallerUserId(req) || '00000000-0000-0000-0000-000000000000';
    await safeLog(callerUserId, 'games', 'read', false, { ...meta, reason: err?.message || 'error' });
    return res.status(400).json({ error: err?.message || 'Bad request' });
  }
}
