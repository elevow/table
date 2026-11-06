import type { NextApiRequest } from 'next';
import { getPool } from '../../../../src/lib/database/pool';
import { GameService } from '../../../../src/lib/services/game-service';
import { createSafeAudit } from '../../../../src/lib/api/audit';
import { getAuthenticatedUserId } from '../../../../src/lib/auth/auth-utils';
import { guardRoomEntry } from '../../../../src/lib/server/room-privacy';
import { apiHandler } from '../../../../src/lib/api/handler';

function getClientIp(req: NextApiRequest): string {
  const fwd = (req.headers['x-forwarded-for'] as string) || '';
  return (fwd.split(',').map(s => s.trim())[0]) || (req.socket.remoteAddress || 'unknown');
}

export default apiHandler({ methods: 'GET', rateLimit: { windowMs: 60_000, max: 60, message: 'Too many requests' } }, async (req, res) => {
  const pool = getPool();
  const safeLog = createSafeAudit(pool);
  const ip = getClientIp(req);
  const userAgent = (req.headers['user-agent'] as string) || '';
  const meta = { ip, userAgent, endpoint: '/api/games/active/by-room' } as Record<string, any>;
  // Private-room access and the audit log use the session's user, never a client-supplied ID
  let callerUserId: string | null = null;
  try {
    callerUserId = await getAuthenticatedUserId(req);
    const service = new GameService(pool);
    const roomId = String(req.query.roomId || '');
    if (!(await guardRoomEntry(req, res, roomId))) return;
    const game = callerUserId
      ? await service.getActiveGameByRoom(roomId, callerUserId)
      : await service.getActiveGameByRoom(roomId);

    if (callerUserId) {
      await safeLog(callerUserId, 'games', 'read', Boolean(game), { ...meta, roomId, reason: game ? undefined : 'forbidden' });
    } else {
      // Spectator access: success if public game is visible; otherwise log as unauthorized
      await safeLog('00000000-0000-0000-0000-000000000000', 'games', 'read', Boolean(game), { ...meta, roomId, as: 'spectator', reason: game ? 'spectator' : 'unauthorized' });
    }

    if (!game) return res.status(200).json(null);
    // The saved engine state holds every player's hole cards and the undealt deck; never return it
    const { state: _engineState, ...publicGame } = game;
    return res.status(200).json(publicGame);
  } catch (err: any) {
    await safeLog(callerUserId || '00000000-0000-0000-0000-000000000000', 'games', 'read', false, { ...meta, reason: err?.message || 'error' });
    return res.status(400).json({ error: err?.message || 'Bad request' });
  }
});
