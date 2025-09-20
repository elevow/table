import type { NextApiRequest, NextApiResponse } from 'next';
import { Pool } from 'pg';
import { rateLimit } from '../../../src/lib/api/rate-limit';
import { isAdminEmail } from '../../../src/utils/roleUtils';

interface AdminRoomsResponse {
  success: boolean;
  rooms: any[];
  total: number;
  page: number;
  limit: number;
}

// Check if user is admin based on session
async function isUserAdmin(req: NextApiRequest): Promise<boolean> {
  try {
    // Get session token from Authorization header or cookies
    const authHeader = req.headers.authorization;
    const sessionToken = authHeader?.replace('Bearer ', '') || req.cookies.session_token || req.cookies.auth_token;
    
    if (!sessionToken || sessionToken === 'null') {
      return false;
    }

    // Use environment variable for database connection - disable SSL for development
    const connectionString = process.env.POOL_DATABASE_URL || process.env.DIRECT_DATABASE_URL;
    const modifiedConnectionString = process.env.NODE_ENV === 'development' 
      ? connectionString?.replace('sslmode=require', 'sslmode=disable')
      : connectionString;
    
    console.log('Development mode: Using connection without SSL requirement');
    
    const pool = new Pool({
      connectionString: modifiedConnectionString,
      ssl: false
    });
    
    const client = await pool.connect();
    
    try {
      // Get user email from session
      const result = await client.query(
        `SELECT u.email FROM users u 
         JOIN auth_tokens at ON u.id = at.user_id 
         WHERE at.token_hash = $1 AND at.expires_at > NOW()`,
        [sessionToken]
      );
      
      if (result.rows.length === 0) {
        return false;
      }
      
      const userEmail = result.rows[0].email;
      const isAdmin = isAdminEmail(userEmail);
      console.log(`Admin check for ${userEmail}: ${isAdmin}`);
      return isAdmin;
      
    } finally {
      client.release();
      await pool.end();
    }
  } catch (error) {
    console.error('Error checking admin status:', error);
    return false;
  }
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<AdminRoomsResponse | { error: string }>
) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Rate limiting
  const rl = rateLimit(req, { limit: 60, windowMs: 60_000 });
  if (!rl.allowed) {
    return res.status(429).json({ error: 'Too many requests' });
  }

  // Check admin privileges
  const isAdmin = await isUserAdmin(req);
  if (!isAdmin) {
    return res.status(403).json({ error: 'Admin access required' });
  }

  try {
    const connectionString = process.env.POOL_DATABASE_URL || process.env.DIRECT_DATABASE_URL;
    const modifiedConnectionString = process.env.NODE_ENV === 'development' 
      ? connectionString?.replace('sslmode=require', 'sslmode=disable')
      : connectionString;
    
    console.log('Development mode: Using connection without SSL requirement');
    
    const pool = new Pool({
      connectionString: modifiedConnectionString,
      ssl: false
    });
    const client = await pool.connect();

    try {
      // Pagination
      const page = Math.max(1, parseInt(req.query.page as string) || 1);
      const limit = Math.min(50, Math.max(1, parseInt(req.query.limit as string) || 20));
      const offset = (page - 1) * limit;

      // Get total count
      const countResult = await client.query('SELECT COUNT(*) as total FROM game_rooms');
      const total = parseInt(countResult.rows[0].total);

      // First, let's check what columns exist in the game_rooms table
      const schemaResult = await client.query(`
        SELECT column_name 
        FROM information_schema.columns 
        WHERE table_name = 'game_rooms'
        ORDER BY ordinal_position
      `);
      
      console.log('Available columns in game_rooms table:', schemaResult.rows.map(row => row.column_name));

      // Get rooms with basic columns that should exist
      const roomsResult = await client.query(`
        SELECT *
        FROM game_rooms r
        ORDER BY r.created_at DESC
        LIMIT $1 OFFSET $2
      `, [limit, offset]);

      return res.status(200).json({
        success: true,
        rooms: roomsResult.rows,
        total,
        page,
        limit
      });

    } finally {
      client.release();
      await pool.end();
    }
  } catch (error: any) {
    console.error('Error fetching admin rooms:', error);
    return res.status(500).json({ error: 'Failed to fetch rooms' });
  }
}
