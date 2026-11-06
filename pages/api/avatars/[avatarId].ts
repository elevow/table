import type { NextApiRequest, NextApiResponse } from 'next';
import { getPool } from '../../../src/lib/database/pool';
import { AvatarService } from '../../../src/lib/services/avatar-service';
import { rateLimit } from '../../../src/lib/api/rate-limit';
import { getAuthenticatedUserId } from '../../../src/lib/auth/auth-utils';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const ip = (req.headers['x-forwarded-for'] as string) || req.socket.remoteAddress || 'anon';
  const avatarId = (req.query as any).avatarId as string;
  if (!avatarId) return res.status(400).json({ error: 'Missing avatarId' });

  if (req.method === 'DELETE') {
    const rl = rateLimit(`DELETE /api/avatars/:avatarId:${ip}`, { windowMs: 60 * 60 * 1000, max: 5 });
    if (!rl.allowed) return res.status(429).json({ error: 'Delete limit exceeded. Try again later.' });
    
    const userId = await getAuthenticatedUserId(req);
    if (!userId) return res.status(401).json({ error: 'Authentication required' });

    try {
      const pool = getPool();
      const service = new AvatarService(pool as any);
      // Only the avatar's owner may remove it; someone else's looks the same as a missing one
      const avatar = await service['manager'].getAvatarById(avatarId);
      if (!avatar || avatar.userId !== userId) return res.status(404).json({ error: 'Not found' });
      const archived = await service['manager'].updateAvatar(avatarId, { status: 'archived' });
      return res.status(200).json({ success: true, id: archived.id, status: archived.status });
    } catch (e: any) {
      console.error('Avatar delete error:', e);
      return res.status(500).json({ success: false, message: 'Internal error' });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
