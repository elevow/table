import type { NextApiRequest, NextApiResponse } from 'next';
import { getPool } from '../../../src/lib/database/pool';
import { isUserAdminBySession } from '../../../src/lib/api/admin-auth';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Reuse the existing isUserAdminBySession function to maintain DRY principles
    const isAdmin = await isUserAdminBySession(req, getPool);
    
    // Optionally return email for debugging if needed
    if (isAdmin) {
      const authHeader = req.headers.authorization;
      const sessionToken = authHeader?.replace('Bearer ', '') || req.cookies.session_token || req.cookies.auth_token;
      const pool = getPool();
      const client = await pool.connect();
      try {
        const result = await client.query(
          `SELECT u.email FROM users u 
           JOIN auth_tokens at ON u.id = at.user_id 
           WHERE at.token_hash = $1 AND at.expires_at > NOW()`,
          [sessionToken]
        );
        return res.status(200).json({ isAdmin: true, email: result.rows[0]?.email });
      } finally {
        client.release();
      }
    }
    
    return res.status(200).json({ isAdmin: false, reason: 'not_admin' });
  } catch {
    return res.status(200).json({ isAdmin: false, reason: 'error' });
  }
}
