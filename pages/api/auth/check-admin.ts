import type { NextApiRequest, NextApiResponse } from 'next';
import { getPool } from '../../../src/lib/database/pool';
import { isAdminEmail } from '../../../src/utils/roleUtils';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Get session token from Authorization header or cookies
    const authHeader = req.headers.authorization;
    const sessionToken = authHeader?.replace('Bearer ', '') || req.cookies.session_token || req.cookies.auth_token;
    
    if (!sessionToken || sessionToken === 'null') {
      return res.status(200).json({ isAdmin: false, reason: 'no_token' });
    }

    const pool = getPool();
    const client = await pool.connect();
    
    try {
      // Get user email from session token
      const result = await client.query(
        `SELECT u.email FROM users u 
         JOIN auth_tokens at ON u.id = at.user_id 
         WHERE at.token_hash = $1 AND at.expires_at > NOW()`,
        [sessionToken]
      );
      
      if (result.rows.length === 0) {
        return res.status(200).json({ isAdmin: false, reason: 'no_user_found' });
      }
      
      const userEmail = result.rows[0].email;
      const isAdmin = isAdminEmail(userEmail);
      
      return res.status(200).json({ isAdmin, email: userEmail });
    } finally {
      client.release();
    }
  } catch {
    return res.status(200).json({ isAdmin: false, reason: 'error' });
  }
}
