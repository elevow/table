import type { NextApiRequest, NextApiResponse } from 'next';
import type { Pool } from 'pg';
import { isAdminEmail } from '../../utils/roleUtils';

// Simple admin auth guard using a shared token header.
// In production, replace with session-based RBAC.
export function isAdminAuthorized(req: NextApiRequest): boolean {
  const headerToken = req.headers['x-admin-token'] || req.headers['X-Admin-Token' as keyof typeof req.headers];
  const token = Array.isArray(headerToken) ? headerToken[0] : headerToken;
  const expected = process.env.ADMIN_API_TOKEN;
  if (!expected) return false;
  return typeof token === 'string' && token === expected;
}

export function requireAdmin(req: NextApiRequest, res: NextApiResponse): boolean {
  if (!isAdminAuthorized(req)) {
    res.status(401).json({ error: 'Unauthorized' });
    return false;
  }
  return true;
}

// Session-based admin check using auth_tokens table.
// This checks the user's email against the ADMIN_EMAILS environment variable.
export async function isUserAdminBySession(req: NextApiRequest, getPool: () => Pool): Promise<boolean> {
  try {
    const authHeader = req.headers.authorization;
    const sessionToken = authHeader?.replace('Bearer ', '') || req.cookies.session_token || req.cookies.auth_token;
    
    if (!sessionToken || sessionToken === 'null') {
      return false;
    }

    const pool = getPool();
    const client = await pool.connect();
    
    try {
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
      return isAdminEmail(userEmail);
    } finally {
      client.release();
    }
  } catch {
    return false;
  }
}
