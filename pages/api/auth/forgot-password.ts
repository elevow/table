import type { NextApiRequest, NextApiResponse } from 'next';
import { getPool } from '../../../src/lib/database/pool';
import { rateLimit } from '../../../src/lib/api/rate-limit';
import { UserManager } from '../../../src/lib/database/user-manager';
import { createUserService } from '../../../src/lib/services/user-service';
import { createSafeAudit } from '../../../src/lib/api/audit';
import { emailService } from '../../../src/lib/services/email-service';

function getClientIp(req: NextApiRequest): string {
  const fwd = (req.headers['x-forwarded-for'] as string) || '';
  return (fwd.split(',').map(s => s.trim())[0]) || (req.socket.remoteAddress || 'unknown');
}

interface ForgotPasswordRequest {
  email: string;
}

interface ForgotPasswordResponse {
  success: boolean;
  message: string;
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<ForgotPasswordResponse | { error: string }>
) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Strict rate limiting for password reset requests - 3 per hour
  const rl = rateLimit(req, { limit: 3, windowMs: 60 * 60 * 1000 });
  if (!rl.allowed) {
    return res.status(429).json({ error: 'Too many password reset attempts. Please try again later.' });
  }

  const pool = getPool();
  const safeLog = createSafeAudit(pool);
  const ip = getClientIp(req);

  try {
    const { email }: ForgotPasswordRequest = req.body;

    // Validate input
    if (!email || typeof email !== 'string') {
      await safeLog('anonymous', 'forgot_password', 'invalid_input', false, {
        ip,
        error: 'Missing or invalid email'
      });
      return res.status(400).json({ error: 'Email is required' });
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      await safeLog('anonymous', 'forgot_password', 'invalid_email', false, {
        ip,
        email: email.substring(0, 3) + '***' // Log partial email for debugging
      });
      return res.status(400).json({ error: 'Invalid email format' });
    }

    const userManager = new UserManager(pool);
    const userService = createUserService(userManager);

    // Check if user exists
    const user = await userManager.getUserByEmail(email.toLowerCase().trim());
    
    if (user) {
      // User exists - generate reset token
      try {
        const { token, expiresAt } = await userService.createPasswordReset(user.id, 60); // 1 hour expiry
        
        // Send password reset email
        const emailResult = await emailService.sendPasswordResetEmail(email, token, 60);
        
        if (!emailResult.success) {
          console.warn('Failed to send password reset email:', emailResult.error);
          // Continue for security - don't reveal email sending failures
        }
        
        // For development, also log the reset link
        if (process.env.NODE_ENV !== 'production') {
          console.log(`Password reset token for ${email}: ${token}`);
          console.log(`Reset link: ${process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000'}/reset-password?token=${token}&email=${encodeURIComponent(email)}`);
        }
        
        await safeLog(user.id, 'forgot_password', 'token_generated', true, {
          ip,
          email: email.substring(0, 3) + '***',
          expiresAt: expiresAt.toISOString(),
          emailSent: emailResult.success,
          emailProvider: emailResult.provider,
          emailError: emailResult.error
        });

      } catch (error) {
        console.error('Error generating password reset token:', error);
        await safeLog(user.id, 'forgot_password', 'token_error', false, {
          ip,
          error: error instanceof Error ? error.message : 'Unknown error'
        });
        
        // Don't reveal the error to the client for security
        return res.status(200).json({
          success: true,
          message: 'If an account with that email exists, we have sent a password reset link.'
        });
      }
    } else {
      // User doesn't exist - still return success for security (prevent user enumeration)
      await safeLog('anonymous', 'forgot_password', 'user_not_found', true, {
        ip,
        email: email.substring(0, 3) + '***'
      });
    }

    // Always return success to prevent user enumeration attacks
    return res.status(200).json({
      success: true,
      message: 'If an account with that email exists, we have sent a password reset link.'
    });

  } catch (error) {
    console.error('Forgot password error:', error);
    await safeLog('anonymous', 'forgot_password', 'server_error', false, {
      ip,
      error: error instanceof Error ? error.message : 'Unknown server error'
    });

    return res.status(500).json({ error: 'Internal server error' });
  }
}
