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

interface ResetPasswordRequest {
  token: string;
  email: string;
  newPassword: string;
  confirmPassword?: string;
}

interface ResetPasswordResponse {
  success: boolean;
  message: string;
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<ResetPasswordResponse | { error: string }>
) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Rate limiting for password reset - 5 attempts per hour
  const rl = rateLimit(req, { limit: 5, windowMs: 60 * 60 * 1000 });
  if (!rl.allowed) {
    return res.status(429).json({ error: 'Too many password reset attempts. Please try again later.' });
  }

  const pool = getPool();
  const safeLog = createSafeAudit(pool);
  const ip = getClientIp(req);

  try {
    const { token, email, newPassword, confirmPassword }: ResetPasswordRequest = req.body;

    // Validate input
    if (!token || typeof token !== 'string') {
      await safeLog('anonymous', 'reset_password', 'invalid_token', false, {
        ip,
        error: 'Missing or invalid token'
      });
      return res.status(400).json({ error: 'Invalid reset token' });
    }

    if (!email || typeof email !== 'string') {
      await safeLog('anonymous', 'reset_password', 'invalid_email', false, {
        ip,
        error: 'Missing or invalid email'
      });
      return res.status(400).json({ error: 'Email is required' });
    }

    if (!newPassword || typeof newPassword !== 'string') {
      await safeLog('anonymous', 'reset_password', 'invalid_password', false, {
        ip,
        error: 'Missing or invalid password'
      });
      return res.status(400).json({ error: 'New password is required' });
    }

    // Validate password strength
    if (newPassword.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters long' });
    }

    // Check password confirmation if provided
    if (confirmPassword && newPassword !== confirmPassword) {
      return res.status(400).json({ error: 'Passwords do not match' });
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      await safeLog('anonymous', 'reset_password', 'invalid_email_format', false, {
        ip,
        email: email.substring(0, 3) + '***'
      });
      return res.status(400).json({ error: 'Invalid email format' });
    }

    const userManager = new UserManager(pool);
    const userService = createUserService(userManager);

    // Find user by email
    const user = await userManager.getUserByEmail(email.toLowerCase().trim());
    
    if (!user) {
      await safeLog('anonymous', 'reset_password', 'user_not_found', false, {
        ip,
        email: email.substring(0, 3) + '***'
      });
      return res.status(400).json({ error: 'Invalid reset token or email' });
    }

    // Verify the reset token
    const isValidToken = await userService.verifyPasswordReset(user.id, token);
    
    if (!isValidToken) {
      await safeLog(user.id, 'reset_password', 'invalid_token', false, {
        ip,
        email: email.substring(0, 3) + '***'
      });
      return res.status(400).json({ error: 'Invalid or expired reset token' });
    }

    try {
      // Update the user's password
      const hashedPassword = await userService.hashPassword(newPassword);
      await userManager.updateUser(user.id, { passwordHash: hashedPassword });

      // Consume the reset token (mark as used)
      await userService.consumePasswordReset(user.id, token);

      await safeLog(user.id, 'reset_password', 'success', true, {
        ip,
        email: email.substring(0, 3) + '***'
      });

      return res.status(200).json({
        success: true,
        message: 'Password has been successfully reset. You can now log in with your new password.'
      });

    } catch (error) {
      console.error('Error updating password:', error);
      await safeLog(user.id, 'reset_password', 'update_error', false, {
        ip,
        error: error instanceof Error ? error.message : 'Unknown error'
      });

      return res.status(500).json({ error: 'Failed to update password. Please try again.' });
    }

  } catch (error) {
    console.error('Reset password error:', error);
    await safeLog('anonymous', 'reset_password', 'server_error', false, {
      ip,
      error: error instanceof Error ? error.message : 'Unknown server error'
    });

    return res.status(500).json({ error: 'Internal server error' });
  }
}
