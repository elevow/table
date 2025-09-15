import type { NextApiRequest, NextApiResponse } from 'next';
import { getPool } from '../../../src/lib/database/pool';
import { rateLimit } from '../../../src/lib/api/rate-limit';
import { UserManager } from '../../../src/lib/database/user-manager';
import { createUserService } from '../../../src/lib/services/user-service';
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

interface ChangePasswordRequest {
  currentPassword: string;
  newPassword: string;
}

interface ChangePasswordResponse {
  success: boolean;
  message: string;
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<ChangePasswordResponse | { error: string }>
) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Rate limiting - be strict with password changes
  const rl = rateLimit(req, { limit: 5, windowMs: 60_000 });
  if (!rl.allowed) {
    return res.status(429).json({ error: 'Too many password change attempts. Please try again later.' });
  }

  const pool = getPool();
  const safeLog = createSafeAudit(pool);
  const ip = getClientIp(req);
  const userAgent = req.headers['user-agent'] || '';

  try {
    const token = getAuthToken(req);
    if (!token) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    // Get user ID from token
    const client = await pool.connect();
    let userId: string;
    
    try {
      const tokenResult = await client.query(
        `SELECT user_id FROM auth_tokens WHERE token_hash = $1 AND type = 'session' AND expires_at > NOW()`,
        [token]
      );

      if (tokenResult.rows.length === 0) {
        return res.status(401).json({ error: 'Invalid or expired token' });
      }
      
      userId = tokenResult.rows[0].user_id;
    } finally {
      client.release();
    }

    const { currentPassword, newPassword }: ChangePasswordRequest = req.body;

    // Input validation
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: 'Current password and new password are required' });
    }

    // New password validation
    if (newPassword.length < 8) {
      return res.status(400).json({ error: 'New password must be at least 8 characters long' });
    }

    if (currentPassword === newPassword) {
      return res.status(400).json({ error: 'New password must be different from current password' });
    }

    const manager = new UserManager(pool);
    const userService = createUserService(manager);

    // Change password using service
    await userService.changePassword({
      userId,
      currentPassword,
      newPassword
    });

    // Log successful password change
    await safeLog(userId, 'auth', 'password_change', true, {
      ip,
      userAgent,
      endpoint: '/api/auth/change-password',
    });

    res.status(200).json({
      success: true,
      message: 'Password changed successfully'
    });

  } catch (error: any) {
    console.error('Password change error:', error);

    // Log failed password change attempt
    await safeLog('system', 'auth', 'password_change_attempt', false, {
      ip,
      userAgent,
      endpoint: '/api/auth/change-password',
      reason: error.message || 'unknown_error',
    });

    // Handle specific errors
    if (error.message === 'Current password is incorrect') {
      return res.status(400).json({ error: 'Current password is incorrect' });
    }

    if (error.message === 'User not found or no password set') {
      return res.status(404).json({ error: 'User account not found' });
    }

    // Generic error response
    res.status(500).json({ error: 'Password change failed. Please try again.' });
  }
}
