import type { NextApiRequest, NextApiResponse } from 'next';
import { Pool } from 'pg';
import { AvatarService } from '../../../src/lib/services/avatar-service';
import { rateLimit } from '../../../src/lib/api/rate-limit';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const ip = (req.headers['x-forwarded-for'] as string) || req.socket.remoteAddress || 'anon';
  const avatarId = (req.query as any).avatarId as string;
  if (!avatarId) return res.status(400).json({ error: 'Missing avatarId' });

  if (req.method === 'DELETE') {
    const rl = rateLimit(`DELETE /api/avatars/:avatarId:${ip}`, { windowMs: 60 * 60 * 1000, max: 5 });
    if (!rl.allowed) return res.status(429).json({ error: 'Delete limit exceeded. Try again later.' });
    
    try {
      const pool = new Pool();
      const service = new AvatarService(pool as any);
      const archived = await service['manager'].updateAvatar(avatarId, { status: 'archived' });
      return res.status(200).json({ success: true, id: archived.id, status: archived.status });
    } catch (e: any) {
      return res.status(500).json({ success: false, message: e?.message || 'Internal error' });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
