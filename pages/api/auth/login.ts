import type { NextApiRequest, NextApiResponse } from 'next';
import bcrypt from 'bcryptjs';
import { getPool } from '../../../src/lib/database/pool';
import { rateLimit } from '../../../src/lib/api/rate-limit';
import { UserManager } from '../../../src/lib/database/user-manager';
import { createUserService } from '../../../src/lib/services/user-service';
import { createSafeAudit } from '../../../src/lib/api/audit';
import { v4 as uuidv4 } from 'uuid';

function getClientIp(req: NextApiRequest): string {
  const fwd = (req.headers['x-forwarded-for'] as string) || '';
  return (fwd.split(',').map(s => s.trim())[0]) || (req.socket.remoteAddress || 'unknown');
}

interface LoginRequest {
  email: string;
  password: string;
}

interface LoginResponse {
  success: boolean;
  user?: {
    id: string;
    email: string;
    username: string;
    lastLogin: Date;
  };
  token?: string;
  message?: string;
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<LoginResponse | { error: string }>
) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Rate limiting - allow more login attempts than registration
  const rl = rateLimit(req, { limit: 20, windowMs: 60_000 });
  if (!rl.allowed) {
    return res.status(429).json({ error: 'Too many login attempts. Please try again later.' });
  }

  const pool = getPool();
  const safeLog = createSafeAudit(pool);
  const ip = getClientIp(req);
  const userAgent = req.headers['user-agent'] || '';

  try {
    const { email, password }: LoginRequest = req.body;

    // Input validation
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    // Email validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({ error: 'Please enter a valid email address' });
    }

    const manager = new UserManager(pool);
    const userService = createUserService(manager);

    // Find user by email
    const user = await userService.getUserByEmail(email.toLowerCase());
    
    if (!user) {
      await safeLog('system', 'auth', 'login_attempt', false, {
        ip,
        userAgent,
        endpoint: '/api/auth/login',
        reason: 'user_not_found',
        email: email.toLowerCase(),
      });
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    // Check if user has password set (support both new and legacy users)
    const passwordHash = user.passwordHash || user.metadata?.passwordHash;
    if (!passwordHash) {
      await safeLog(user.id, 'auth', 'login_attempt', false, {
        ip,
        userAgent,
        endpoint: '/api/auth/login',
        reason: 'no_password_hash',
        email: email.toLowerCase(),
      });
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    // Verify password using service
    const isValidPassword = await userService.verifyPassword(password, passwordHash);
    
    if (!isValidPassword) {
      await safeLog(user.id, 'auth', 'login_attempt', false, {
        ip,
        userAgent,
        endpoint: '/api/auth/login',
        reason: 'invalid_password',
        email: email.toLowerCase(),
      });
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    // Update last login time
    await userService.updateUser(user.id, {
      lastLogin: new Date()
    });

    // Generate session token
    const sessionToken = uuidv4();
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7); // 7 days

    // Store session token in auth_tokens table
    const client = await pool.connect();
    try {
      // Clean up any expired tokens for this user
      await client.query(
        `DELETE FROM auth_tokens WHERE user_id = $1 AND expires_at < NOW()`,
        [user.id]
      );

      // Insert new session token
      await client.query(
        `INSERT INTO auth_tokens (id, user_id, token_hash, expires_at, type) 
         VALUES ($1, $2, $3, $4, $5)`,
        [uuidv4(), user.id, sessionToken, expiresAt, 'session']
      );
    } finally {
      client.release();
    }

    // Log successful login
    await safeLog(user.id, 'auth', 'login', true, {
      ip,
      userAgent,
      endpoint: '/api/auth/login',
      email: email.toLowerCase(),
    });

    // Return success response
    res.status(200).json({
      success: true,
      user: {
        id: user.id,
        email: user.email,
        username: user.username,
        lastLogin: new Date(),
      },
      token: sessionToken,
      message: 'Login successful'
    });

  } catch (error: any) {
    console.error('Login error:', error);

    // Log failed login attempt
    await safeLog('system', 'auth', 'login_attempt', false, {
      ip,
      userAgent,
      endpoint: '/api/auth/login',
      reason: error.message || 'unknown_error',
    });

    // Generic error response
    res.status(500).json({ error: 'Login failed. Please try again.' });
  }
}
