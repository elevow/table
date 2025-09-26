import type { NextApiRequest, NextApiResponse } from 'next';
import { Pool } from 'pg';
import { AvatarService } from '../../../src/lib/services/avatar-service';
import { rateLimit } from '../../../src/lib/api/rate-limit';

// Temporarily disable SSL certificate verification for development
if (process.env.NODE_ENV === 'development') {
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const ip = (req.headers['x-forwarded-for'] as string) || req.socket.remoteAddress || 'anon';
  const avatarId = (req.query as any).avatarId as string;
  if (!avatarId) return res.status(400).json({ error: 'Missing avatarId' });

  if (req.method === 'DELETE') {
    const rl = rateLimit(`DELETE /api/avatars/:avatarId:${ip}`, { windowMs: 60 * 60 * 1000, max: 5 });
    if (!rl.allowed) return res.status(429).json({ error: 'Delete limit exceeded. Try again later.' });
    
    try {
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
      const archived = await service['manager'].updateAvatar(avatarId, { status: 'archived' });
      
      // Close the pool connection
      await pool.end();
      
      return res.status(200).json({ success: true, id: archived.id, status: archived.status });
    } catch (e: any) {
      return res.status(500).json({ success: false, message: e?.message || 'Internal error' });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
