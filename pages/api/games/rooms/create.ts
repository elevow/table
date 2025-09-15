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
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const rl = rateLimit(req, { limit: 60, windowMs: 60_000 });
  if (!rl.allowed) return res.status(429).json({ error: 'Too many requests' });

  const pool = getPool();
  const safeLog = createSafeAudit(pool);

  try {
    const service = new GameService(pool);
    console.log('Creating room with data:', JSON.stringify(req.body, null, 2));
    const created = await service.createRoom(req.body);
    console.log('Room created successfully:', created.id);
    return res.status(201).json(created);
  } catch (err: any) {
    console.error('Room creation failed:', err.message);
    console.error('Error stack:', err.stack);
    await safeLog(
      getCallerUserId(req) || '00000000-0000-0000-0000-000000000000',
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
