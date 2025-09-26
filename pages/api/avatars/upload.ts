import type { NextApiRequest, NextApiResponse } from 'next';
import { Pool } from 'pg';
import { AvatarService } from '../../../src/lib/services/avatar-service';
import { rateLimit } from '../../../src/lib/api/rate-limit';
import { requireAuth } from '../../../src/lib/auth/auth-utils';

// Temporarily disable SSL certificate verification for development
if (process.env.NODE_ENV === 'development') {
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
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

    if (!originalUrl || !variants) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // Use proper database configuration with SSL fix for self-signed certificates
    const connectionString = process.env.POOL_DATABASE_URL || process.env.DATABASE_URL;
    
    // Parse connection string to modify SSL mode
    let modifiedConnectionString = connectionString;
    if (connectionString?.includes('sslmode=require')) {
      modifiedConnectionString = connectionString.replace('sslmode=require', 'sslmode=prefer');
    }
    
    const pool = new Pool({
      connectionString: modifiedConnectionString,
      ssl: connectionString?.includes('supabase') ? { 
        rejectUnauthorized: false
      } : false
    });
    
    const service = new AvatarService(pool as any);
    const avatar = await service.uploadAvatar({ userId: authenticatedUserId, originalUrl, variants });
    
    // Close the pool connection
    await pool.end();
    
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
