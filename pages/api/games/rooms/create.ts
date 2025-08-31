import type { NextApiRequest, NextApiResponse } from 'next';
import { Pool } from 'pg';
import { rateLimit } from '../../../../src/lib/api/rate-limit';
import { GameService } from '../../../../src/lib/services/game-service';
import { DataProtectionFactory } from '../../../../src/lib/database/security-utilities';
import { logAccess } from '../../../../src/lib/database/rls-context';

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

  const pool = new Pool();
  const safeLog = async (
    userId: string,
    resource: string,
    action: string,
    success: boolean,
    metadata?: Record<string, any>
  ) => {
    try {
      const dp = await DataProtectionFactory.createDataProtectionService(pool);
      await logAccess(dp, userId, resource, action, success, metadata);
    } catch {
      // ignore audit failures
    }
  };

  try {
    const service = new GameService(pool);
    const created = await service.createRoom(req.body);
    return res.status(201).json(created);
  } catch (err: any) {
    await safeLog(
      getCallerUserId(req) || '00000000-0000-0000-0000-000000000000',
      'games',
      'create',
      false,
      {
        ip: getClientIp(req),
        userAgent: req.headers['user-agent'] || '',
        endpoint: '/api/games/rooms/create',
        reason: err?.message || 'error',
      }
    );
    return res.status(400).json({ error: err?.message || 'Bad request' });
  }
}
