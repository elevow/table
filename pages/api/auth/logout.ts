import type { NextApiRequest, NextApiResponse } from 'next';
import { getPool } from '../../../src/lib/database/pool';
import { rateLimit } from '../../../src/lib/api/rate-limit';
import { createSafeAudit } from '../../../src/lib/api/audit';

function getClientIp(req: NextApiRequest): string {
  const fwd = (req.headers['x-forwarded-for'] as string) || '';
  return (fwd.split(',').map(s => s.trim())[0]) || (req.socket.remoteAddress || 'unknown');
}

function getAuthToken(req: NextApiRequest): string | null {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return authHeader.substring(7);
  }
  return null;
}

interface LogoutResponse {
  success: boolean;
  message: string;
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<LogoutResponse | { error: string }>
) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Rate limiting
  const rl = rateLimit(req, { limit: 30, windowMs: 60_000 });
  if (!rl.allowed) {
    return res.status(429).json({ error: 'Too many requests' });
  }

  const pool = getPool();
  const safeLog = createSafeAudit(pool);
  const ip = getClientIp(req);
  const userAgent = req.headers['user-agent'] || '';

  try {
    const token = getAuthToken(req);
    
    if (!token) {
      return res.status(400).json({ error: 'No authentication token provided' });
    }

    const client = await pool.connect();
    let userId: string | null = null;
    
    try {
      // Find the session token and get user ID
      const tokenResult = await client.query(
        `SELECT user_id FROM auth_tokens WHERE token_hash = $1 AND type = 'session' AND expires_at > NOW()`,
        [token]
      );

      if (tokenResult.rows.length > 0) {
        userId = tokenResult.rows[0].user_id;
      }

      // Delete the session token (logout)
      await client.query(
        `DELETE FROM auth_tokens WHERE token_hash = $1 AND type = 'session'`,
        [token]
      );

      // Optionally, delete all session tokens for this user (logout from all devices)
      // await client.query(
      //   `DELETE FROM auth_tokens WHERE user_id = $1 AND type = 'session'`,
      //   [userId]
      // );

    } finally {
      client.release();
    }

    // Log logout attempt
    await safeLog(userId || 'system', 'auth', 'logout', true, {
      ip,
      userAgent,
      endpoint: '/api/auth/logout',
      tokenProvided: !!token,
    });

    res.status(200).json({
      success: true,
      message: 'Logged out successfully'
    });

  } catch (error: any) {
    console.error('Logout error:', error);

    // Log failed logout attempt
    await safeLog('system', 'auth', 'logout_attempt', false, {
      ip,
      userAgent,
      endpoint: '/api/auth/logout',
      reason: error.message || 'unknown_error',
    });

    res.status(500).json({ error: 'Logout failed. Please try again.' });
  }
}
