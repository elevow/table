import type { NextApiRequest, NextApiResponse } from 'next';
import { Pool } from 'pg';
import { AvatarService } from '../../../../src/lib/services/avatar-service';
import { rateLimit } from '../../../../src/lib/api/rate-limit';

// Temporarily disable SSL certificate verification for development
if (process.env.NODE_ENV === 'development') {
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const ip = (req.headers['x-forwarded-for'] as string) || req.socket.remoteAddress || 'anon';
  const rl = rateLimit(`GET /api/avatars/user/:userId:${ip}`, { windowMs: 60 * 1000, max: 60 });
  if (!rl.allowed) return res.status(429).json({ error: 'Too many requests. Please slow down.' });

  try {
    const { userId } = req.query as { userId: string };
    
    console.log('=== Avatar Retrieval API Debug ===');
    console.log('Looking up avatar for userId:', userId);
    console.log('This is the userId that will be queried in database');
    console.log('=== Retrieval API Processing ===');
    
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
    const avatar = await service.getLatestForUser(userId);
    
    console.log('=== Avatar Retrieval Result ===');
    console.log('Query result for userId', userId + ':', avatar ? 'Found avatar' : 'No avatar found');
    if (avatar) {
      console.log('Avatar data found:', { id: avatar.id, url: avatar.originalUrl, status: avatar.status });
    }
    console.log('=== End Retrieval Result ===');
    
    // Close the pool connection
    await pool.end();
    
    if (!avatar) {
      console.log('Avatar API - Returning 404 for userId:', userId);
      return res.status(404).json({ error: 'Not found' });
    }
    return res.status(200).json({ id: avatar.id, url: avatar.originalUrl, thumbnails: avatar.variants, status: avatar.status });
  } catch (e: any) {
    console.error('Avatar API error:', e);
    
    // Specific handling for SSL certificate errors
    if (e.code === 'SELF_SIGNED_CERT_IN_CHAIN' || e.message?.includes('certificate')) {
      console.error('SSL Certificate issue - check database SSL configuration');
      return res.status(500).json({ error: 'Database SSL configuration error' });
    }
    
    return res.status(500).json({ error: e?.message || 'Internal error' });
  }
}
