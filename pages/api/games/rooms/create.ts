import type { NextApiRequest, NextApiResponse } from 'next';
import { getPool } from '../../../../src/lib/database/pool';
import { rateLimit } from '../../../../src/lib/api/rate-limit';
import { GameService } from '../../../../src/lib/services/game-service';
import { createSafeAudit } from '../../../../src/lib/api/audit';
import {
  getLimit, hasPermission, requirePlayerAccess, sendLimitReached, sendPermissionDenied,
} from '../../../../src/lib/auth/access-control';

function getClientIp(req: NextApiRequest): string {
  const fwd = (req.headers['x-forwarded-for'] as string) || '';
  return (fwd.split(',').map(s => s.trim())[0]) || (req.socket.remoteAddress || 'unknown');
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const rl = rateLimit(req, { limit: 60, windowMs: 60_000 });
  if (!rl.allowed) return res.status(429).json({ error: 'Too many requests' });

  // Signed-out visitors (including guests without a session) and users without room.create can't create rooms
  const access = await requirePlayerAccess(req, res);
  if (!access) return;
  if (!hasPermission(access, 'room.create')) return sendPermissionDenied(res, 'room.create', access);
  // Dealer's choice and mixed games rotate variants, which is its own host permission
  const variant = req.body?.configuration?.variant;
  if ((variant === 'dealers-choice' || variant === 'mixed') && !hasPermission(access, 'room.choose_variant')) {
    return sendPermissionDenied(res, 'room.choose_variant', access);
  }
  const userId = access.userId;

  const pool = getPool();
  const safeLog = createSafeAudit(pool);

  const perDay = getLimit(access, 'rooms.per_day');
  if (perDay !== null) {
    const recent = await pool.query(
      `SELECT COUNT(*)::int AS n FROM game_rooms WHERE created_by = $1 AND created_at > NOW() - INTERVAL '24 hours'`,
      [userId]
    ).then(r => Number(r.rows[0]?.n) || 0, () => 0);
    if (recent >= perDay) return sendLimitReached(res, 'rooms.per_day', perDay);
  }

  try {
    const service = new GameService(pool);
    // Sanitize/force createdBy to authenticated user
    const payload = { ...req.body, createdBy: userId };

    console.log('Creating room with data:', JSON.stringify({ ...payload, createdBy: '[auth-user]'} , null, 2));
    const created = await service.createRoom(payload);
    console.log('Room created successfully:', created.id);
    return res.status(201).json(created);
  } catch (err: any) {
    console.error('Room creation failed:', err.message);
    console.error('Error stack:', err.stack);
    await safeLog(
      userId,
      'games',
      'create',
      false,
      {
        ip: getClientIp(req),
        userAgent: req.headers['user-agent'] || '',
        endpoint: '/api/games/rooms/create',
        reason: err.message || 'error',
      }
    );
    return res.status(400).json({ error: err.message || 'Bad request' });
  }
}
