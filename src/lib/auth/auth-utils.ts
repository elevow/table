import type { NextApiRequest } from 'next';
import { Pool } from 'pg';

/**
 * Extract session token from request headers or cookies
 */
export function getAuthToken(req: NextApiRequest): string | null {
  const authHeader = req.headers?.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return authHeader.substring(7);
  }
  
  // Also check in cookies as fallback
  return req.cookies?.session_token || req.cookies?.auth_token || null;
}

/**
 * Get authenticated user ID from session token
 */
export async function getAuthenticatedUserId(req: NextApiRequest): Promise<string | null> {
  const token = getAuthToken(req);
  
  if (!token || token === 'null') {
    return null;
  }

  try {
    // Use environment variable for database connection - disable SSL for development
    const connectionString = process.env.POOL_DATABASE_URL || process.env.DATABASE_URL;
    const modifiedConnectionString = process.env.NODE_ENV === 'development' 
      ? connectionString?.replace('sslmode=require', 'sslmode=disable')
      : connectionString;
    
    const pool = new Pool({
      connectionString: modifiedConnectionString,
      ssl: process.env.NODE_ENV === 'development' ? false : undefined
    });
    
    const client = await pool.connect();
    
    try {
      // Get user ID from valid session token
      const result = await client.query(
        `SELECT user_id FROM auth_tokens 
         WHERE token_hash = $1 AND type = 'session' AND expires_at > NOW()`,
        [token]
      );
      
      if (result.rows.length === 0) {
        return null;
      }
      
      return result.rows[0].user_id;
      
    } finally {
      client.release();
      await pool.end();
    }
  } catch (error) {
    console.error('Error getting authenticated user ID:', error);
    return null;
  }
}

/**
 * Require authentication - returns user ID or throws error
 */
export async function requireAuth(req: NextApiRequest): Promise<string> {
  const userId = await getAuthenticatedUserId(req);
  
  if (!userId) {
    throw new Error('Authentication required');
  }
  
  return userId;
}