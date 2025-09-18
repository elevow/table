import type { NextApiRequest, NextApiResponse } from 'next';
import { Pool } from 'pg';
import { AvatarService } from '../../../src/lib/services/avatar-service';
import { rateLimit } from '../../../src/lib/api/rate-limit';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const ip = (req.headers['x-forwarded-for'] as string) || req.socket.remoteAddress || 'anon';
  const rl = rateLimit(`POST /api/avatars/upload:${ip}`, { windowMs: 60 * 60 * 1000, max: 5 });
  if (!rl.allowed) return res.status(429).json({ error: 'Upload limit exceeded. Try again later.' });

  try {
    const { userId, originalUrl, variants } = req.body;

    if (!userId || !originalUrl || !variants) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const pool = new Pool();
    const service = new AvatarService(pool as any);
    const avatar = await service.uploadAvatar({ userId, originalUrl, variants });
    
    return res.status(201).json({ 
      id: avatar.id, 
      url: avatar.originalUrl, 
      thumbnails: avatar.variants, 
      status: avatar.status 
    });
  } catch (e: any) {
    return res.status(500).json({ error: e?.message || 'Internal error' });
  }
}
