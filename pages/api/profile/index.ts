import type { NextApiRequest, NextApiResponse } from 'next';
import { Pool } from 'pg';
import { rateLimit } from '../../../src/lib/api/rate-limit';
import { UserManager } from '../../../src/lib/database/user-manager';
import { createUserService } from '../../../src/lib/services/user-service';
import { DataProtectionFactory } from '../../../src/lib/database/security-utilities';
import { logAccess } from '../../../src/lib/database/rls-context';

function getClientIp(req: NextApiRequest): string {
  const fwd = (req.headers['x-forwarded-for'] as string) || '';
  return (fwd.split(',').map(s => s.trim())[0]) || (req.socket.remoteAddress || 'unknown');
}

function getCallerUserId(req: NextApiRequest): string | null {
  // Minimal auth stub: expect a header provided by upstream auth (to be replaced with real auth integration)
  const fromHeader = (req.headers['x-user-id'] as string) || '';
  const fromQuery = (req.query && (req.query as any).userId as string) || '';
  return (fromHeader || fromQuery) || null;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const method = req.method || 'GET';
  const allowedMethods = ['GET', 'PUT', 'PATCH'];

  // Rate limit per IP+method
  const rl = rateLimit(req, { windowMs: 60_000, limit: method === 'GET' ? 120 : 60 });
  if (!rl.allowed) return res.status(429).json({ error: 'Too many requests' });

  const callerUserId = getCallerUserId(req);
  if (!callerUserId) return res.status(401).json({ error: 'Unauthorized' });

  const ip = getClientIp(req);
  const userAgent = (req.headers['user-agent'] as string) || '';

  const pool = new Pool();
  const manager = new UserManager(pool);
  const userService = createUserService(manager);
  const dataProtection = await DataProtectionFactory.createDataProtectionService(pool);

  const meta = { ip, userAgent, endpoint: '/api/profile' } as Record<string, any>;

  try {
    if (method === 'GET') {
      const q: any = req.query || {};
      const targetUserId = (q.userId as string) || callerUserId;
      if (targetUserId !== callerUserId) {
        await logAccess(dataProtection, callerUserId, 'users', 'read', false, { ...meta, targetUserId, reason: 'forbidden' });
        return res.status(403).json({ error: 'Forbidden' });
      }
      const user = await userService.getUserById(targetUserId, callerUserId);
      await logAccess(dataProtection, callerUserId, 'users', 'read', true, { ...meta, targetUserId });
      return user ? res.status(200).json(user) : res.status(404).json({ error: 'Not found' });
    }

  if (method === 'PUT' || method === 'PATCH') {
      const q: any = req.query || {};
      const targetUserId = (q.userId as string) || callerUserId;
      if (targetUserId !== callerUserId) {
        await logAccess(dataProtection, callerUserId, 'users', 'update', false, { ...meta, targetUserId, reason: 'forbidden' });
        return res.status(403).json({ error: 'Forbidden' });
      }
      const updates = req.body || {};
      const updated = await userService.updateUser(targetUserId, updates, callerUserId);
      await logAccess(dataProtection, callerUserId, 'users', 'update', true, { ...meta, targetUserId });
      return res.status(200).json(updated);
    }

    // Method not allowed
    res.setHeader('Allow', allowedMethods);
    await logAccess(
      dataProtection,
      callerUserId,
      'users',
      'other',
      false,
      { ...meta, reason: 'method_not_allowed', method }
    );
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err: any) {
    await logAccess(dataProtection, callerUserId, 'users', method === 'GET' ? 'read' : 'update', false, { ...meta, reason: err?.message || 'error' });
    return res.status(400).json({ error: err?.message || 'Bad request' });
  }
}
