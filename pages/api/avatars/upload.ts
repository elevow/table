import { getPool } from '../../../src/lib/database/pool';
import { AvatarService } from '../../../src/lib/services/avatar-service';
import { rateLimit } from '../../../src/lib/api/rate-limit';
import { requireAuth } from '../../../src/lib/auth/auth-utils';
import { apiHandler } from '../../../src/lib/api/handler';

export default apiHandler({ methods: 'POST' }, async (req, res) => {
  const ip = (req.headers['x-forwarded-for'] as string) || req.socket.remoteAddress || 'anon';
  const rl = rateLimit(`POST /api/avatars/upload:${ip}`, { windowMs: 60 * 60 * 1000, max: 5 });
  if (!rl.allowed) return res.status(429).json({ error: 'Upload limit exceeded. Try again later.' });

  try {
    // Get authenticated user ID from session
    const authenticatedUserId = await requireAuth(req);
    
    console.log('=== Avatar Upload API Debug ===');
    console.log('Authenticated userId from session:', authenticatedUserId);
    console.log('This userId will be saved to database');
    console.log('=== Upload API Processing ===');
    
    const { originalUrl, variants } = req.body;

    if (!originalUrl) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const pool = getPool();
    
    const service = new AvatarService(pool as any);
    const avatar = await service.uploadAvatar({
      userId: authenticatedUserId,
      originalUrl,
      // The profile page uploads one small image, which serves every size
      variants: variants || { small: originalUrl, medium: originalUrl, large: originalUrl },
    });
    
    return res.status(201).json({ 
      id: avatar.id, 
      url: avatar.originalUrl, 
      thumbnails: avatar.variants, 
      status: avatar.status 
    });
  } catch (e: any) {
    return res.status(500).json({ error: e?.message || 'Internal error' });
  }
});
