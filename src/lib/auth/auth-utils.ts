import type { NextApiRequest, NextApiResponse } from 'next';
import { getPool } from '../database/pool';
import { isAdminEmail } from '../../utils/roleUtils';
import { hashSessionToken } from './session-token';

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
    // Use shared pool with unified SSL configuration
    const pool = getPool();
    
    const client = await pool.connect();
    
    try {
      // Get user ID from valid session token
      const result = await client.query(
        `SELECT user_id FROM auth_tokens 
         WHERE token_hash = $1 AND type = 'session' AND expires_at > NOW()`,
        [hashSessionToken(token)]
      );
      
      if (result.rows.length === 0) {
        return null;
      }
      
      return result.rows[0].user_id;
      
    } finally {
      client.release();
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

/**
 * Authenticate the caller of a game route and confirm they are acting as themselves.
 * Returns the authenticated user ID, or sends 401/403 and returns null.
 * A claimedPlayerId from the request is optional; when present it must match the session.
 */
export async function requirePlayer(
  req: NextApiRequest,
  res: NextApiResponse,
  claimedPlayerId?: unknown
): Promise<string | null> {
  const userId = await getAuthenticatedUserId(req);

  if (!userId) {
    res.status(401).json({ error: 'Authentication required' });
    return null;
  }

  if (claimedPlayerId != null && claimedPlayerId !== '' && String(claimedPlayerId) !== userId) {
    res.status(403).json({ error: 'playerId does not match the authenticated user' });
    return null;
  }

  return userId;
}

/**
 * The user behind a valid session token, or null when signed out or the lookup fails.
 */
export async function getSessionUser(
  req: NextApiRequest
): Promise<{ id: string; email: string | null } | null> {
  const token = getAuthToken(req);
  if (!token || token === 'null') return null;
  try {
    const result = await getPool().query(
      `SELECT u.id, u.email FROM users u
       JOIN auth_tokens at ON u.id = at.user_id
       WHERE at.token_hash = $1 AND at.type = 'session' AND at.expires_at > NOW()`,
      [hashSessionToken(token)]
    );
    return result.rows[0] || null;
  } catch (error) {
    console.error('Error verifying session:', error);
    return null;
  }
}

/**
 * Require an authenticated admin session (email listed in ADMIN_EMAILS).
 * Returns the admin's user ID, or sends 401/403 and returns null.
 */
export async function requireAdminSession(
  req: NextApiRequest,
  res: NextApiResponse
): Promise<string | null> {
  const user = await getSessionUser(req);

  if (!user) {
    res.status(401).json({ error: 'Authentication required' });
    return null;
  }

  if (!user.email || !isAdminEmail(user.email)) {
    res.status(403).json({ error: 'Admin access required' });
    return null;
  }

  return user.id;
}
