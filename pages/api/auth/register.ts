import type { NextApiRequest, NextApiResponse } from 'next';
import bcrypt from 'bcryptjs';
import { getPool } from '../../../src/lib/database/pool';
import { rateLimit } from '../../../src/lib/api/rate-limit';
import { UserManager } from '../../../src/lib/database/user-manager';
import { createUserService } from '../../../src/lib/services/user-service';
import { createSafeAudit } from '../../../src/lib/api/audit';
import { emailService } from '../../../src/lib/services/email-service';
import { v4 as uuidv4 } from 'uuid';

function getClientIp(req: NextApiRequest): string {
  const fwd = (req.headers['x-forwarded-for'] as string) || '';
  return (fwd.split(',').map(s => s.trim())[0]) || (req.socket.remoteAddress || 'unknown');
}

interface RegisterRequest {
  email: string;
  username: string;
  password: string;
  confirmPassword?: string;
}

interface RegisterResponse {
  success: boolean;
  user?: {
    id: string;
    email: string;
    username: string;
    createdAt: Date;
  };
  token?: string;
  message?: string;
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<RegisterResponse | { error: string }>
) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Rate limiting - allow fewer registration attempts
  const rl = rateLimit(req, { limit: 10, windowMs: 60_000 });
  if (!rl.allowed) {
    return res.status(429).json({ error: 'Too many registration attempts. Please try again later.' });
  }

  const pool = getPool();
  const safeLog = createSafeAudit(pool);
  const ip = getClientIp(req);
  const userAgent = req.headers['user-agent'] || '';

  try {
    const { email, username, password, confirmPassword }: RegisterRequest = req.body;

    // Input validation
    if (!email || !username || !password) {
      return res.status(400).json({ error: 'Email, username, and password are required' });
    }

    if (confirmPassword && password !== confirmPassword) {
      return res.status(400).json({ error: 'Passwords do not match' });
    }

    // Email validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({ error: 'Please enter a valid email address' });
    }

    // Username validation
    if (username.length < 3 || username.length > 20) {
      return res.status(400).json({ error: 'Username must be between 3 and 20 characters' });
    }

    const usernameRegex = /^[a-zA-Z0-9_-]+$/;
    if (!usernameRegex.test(username)) {
      return res.status(400).json({ error: 'Username can only contain letters, numbers, underscores, and hyphens' });
    }

    // Password validation
    if (password.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters long' });
    }

    // Create user using the existing service (password hashing handled in service)
    const manager = new UserManager(pool);
    const userService = createUserService(manager);

    // Check if user already exists
    const existingUserByEmail = await userService.getUserByEmail(email);
    if (existingUserByEmail) {
      await safeLog('system', 'auth', 'register_attempt', false, {
        ip,
        userAgent,
        endpoint: '/api/auth/register',
        reason: 'email_exists',
        email: email.toLowerCase(),
      });
      return res.status(400).json({ error: 'An account with this email already exists' });
    }

    const existingUserByUsername = await userService.getUserByUsername(username);
    if (existingUserByUsername) {
      await safeLog('system', 'auth', 'register_attempt', false, {
        ip,
        userAgent,
        endpoint: '/api/auth/register',
        reason: 'username_exists',
        username: username.toLowerCase(),
      });
      return res.status(400).json({ error: 'This username is already taken' });
    }

    // Create the user with password (hashing handled by service)
    const newUser = await userService.createUser({
      email: email.toLowerCase(),
      username: username.toLowerCase(),
      password: password, // Service will hash this
      metadata: {
        registrationIp: ip,
        registrationUserAgent: userAgent,
      }
    });

    // Generate a simple session token (stored in auth_tokens table)
    const sessionToken = uuidv4();
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7); // 7 days

    // Store session token in auth_tokens table
    const client = await pool.connect();
    try {
      await client.query(
        `INSERT INTO auth_tokens (id, user_id, token_hash, expires_at, type) 
         VALUES ($1, $2, $3, $4, $5)`,
        [uuidv4(), newUser.id, sessionToken, expiresAt, 'session']
      );
    } finally {
      client.release();
    }

    // Log successful registration
    await safeLog(newUser.id, 'auth', 'register', true, {
      ip,
      userAgent,
      endpoint: '/api/auth/register',
      email: email.toLowerCase(),
      username: username.toLowerCase(),
    });

    // Send welcome email (don't block registration if email fails)
    try {
      const emailResult = await emailService.sendWelcomeEmail(newUser.email, newUser.username);
      if (!emailResult.success) {
        console.warn('Failed to send welcome email:', emailResult.error);
      }
    } catch (emailError) {
      console.warn('Welcome email error:', emailError);
    }

    // Return success response (don't include sensitive data)
    res.status(201).json({
      success: true,
      user: {
        id: newUser.id,
        email: newUser.email,
        username: newUser.username,
        createdAt: newUser.createdAt,
      },
      token: sessionToken,
      message: 'Account created successfully'
    });

  } catch (error: any) {
    console.error('Registration error:', error);

    // Log failed registration attempt
    await safeLog('system', 'auth', 'register_attempt', false, {
      ip,
      userAgent,
      endpoint: '/api/auth/register',
      reason: error.message || 'unknown_error',
    });

    // Handle specific user errors
    if (error.code === 'EMAIL_EXISTS') {
      return res.status(400).json({ error: 'An account with this email already exists' });
    }
    
    if (error.code === 'USERNAME_EXISTS') {
      return res.status(400).json({ error: 'This username is already taken' });
    }

    // Generic error response
    res.status(500).json({ error: 'Unable to create account. Please try again.' });
  }
}
