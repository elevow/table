import { NextApiRequest, NextApiResponse } from 'next';
import { Pool } from 'pg';
import { rateLimit } from '../../../../src/lib/api/rate-limit';
import { isAdminEmail } from '../../../../src/utils/roleUtils';

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

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  // Rate limiting
  const rl = rateLimit(req, { limit: 30, windowMs: 60_000 });
  if (!rl.allowed) {
    return res.status(429).json({ error: 'Too many requests' });
  }

  // Check admin privileges
  const isAdmin = await isUserAdmin(req);
  if (!isAdmin) {
    return res.status(403).json({ error: 'Admin access required' });
  }

  const { id } = req.query;
  
  if (!id || typeof id !== 'string') {
    return res.status(400).json({ error: 'Room ID is required' });
  }

  if (req.method === 'DELETE') {
    try {
      const connectionString = process.env.POOL_DATABASE_URL || process.env.DIRECT_DATABASE_URL;
      const modifiedConnectionString = process.env.NODE_ENV === 'development' 
        ? connectionString?.replace('sslmode=require', 'sslmode=disable')
        : connectionString;
      
      const pool = new Pool({
        connectionString: modifiedConnectionString,
        ssl: false
      });
      const client = await pool.connect();

      try {
        // First check if the room exists
        const checkResult = await client.query('SELECT id FROM game_rooms WHERE id = $1', [id]);
        
        if (checkResult.rows.length === 0) {
          return res.status(404).json({ error: 'Room not found' });
        }

        // Delete the room (this might cascade to related records depending on your schema)
        await client.query('DELETE FROM game_rooms WHERE id = $1', [id]);

        console.log(`Admin deleted room ${id}`);

        return res.status(200).json({
          success: true,
          message: 'Room deleted successfully'
        });

      } finally {
        client.release();
        await pool.end();
      }
    } catch (error) {
      console.error('Error deleting room:', error);
      return res.status(500).json({ 
        error: 'Failed to delete room',
        details: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  if (req.method === 'GET') {
    try {
      const connectionString = process.env.POOL_DATABASE_URL || process.env.DIRECT_DATABASE_URL;
      const modifiedConnectionString = process.env.NODE_ENV === 'development' 
        ? connectionString?.replace('sslmode=require', 'sslmode=disable')
        : connectionString;
      
      const pool = new Pool({
        connectionString: modifiedConnectionString,
        ssl: false
      });
      const client = await pool.connect();

      try {
        // Get specific room details
        const roomResult = await client.query('SELECT * FROM game_rooms WHERE id = $1', [id]);
        
        if (roomResult.rows.length === 0) {
          return res.status(404).json({ error: 'Room not found' });
        }

        return res.status(200).json({
          success: true,
          room: roomResult.rows[0]
        });

      } finally {
        client.release();
        await pool.end();
      }
    } catch (error) {
      console.error('Error fetching room:', error);
      return res.status(500).json({ 
        error: 'Failed to fetch room details'
      });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}