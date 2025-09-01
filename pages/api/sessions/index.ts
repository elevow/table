import type { NextApiRequest, NextApiResponse } from 'next';
import { Pool } from 'pg';
import { rateLimit } from '../../../src/lib/api/rate-limit';
import { SessionService } from '../../../src/lib/services/session-service';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const rl = rateLimit(req, { limit: 120, windowMs: 60_000 });
  if (!rl.allowed) return res.status(429).json({ error: 'Too many requests' });

  const pool = new Pool();
  const svc = new SessionService(pool, { maxConcurrentSessions: 5 });

  if (req.method === 'POST') {
    const { userId, token, ttlSeconds, ipAddress, userAgent } = req.body || {};
    if (!userId || !token || !ttlSeconds) return res.status(400).json({ error: 'Missing fields' });
    try {
      const session = await svc.createSession({ userId, token, ttlSeconds, ipAddress: ipAddress || null, userAgent: userAgent || (req.headers['user-agent'] as string) || null });
      return res.status(201).json(session);
    } catch (e: any) {
      return res.status(400).json({ error: e?.message || 'Failed to create session', code: e?.code });
    }
  }

  if (req.method === 'GET') {
    const token = (req.query.token as string) || '';
    if (!token) return res.status(400).json({ error: 'token required' });
    const session = await svc.verifySession(token);
    if (!session) return res.status(404).json({ error: 'Not found' });
    await svc.touchActivity(token);
    return res.status(200).json(session);
  }

  if (req.method === 'DELETE') {
    const token = (req.query.token as string) || '';
    if (!token) return res.status(400).json({ error: 'token required' });
    await svc.revokeByToken(token);
    return res.status(204).end();
  }

  res.setHeader('Allow', 'GET, POST, DELETE');
  return res.status(405).json({ error: 'Method not allowed' });
}
