// Session Management Service

import { Pool } from 'pg';
import { v4 as uuidv4 } from 'uuid';
import crypto from 'crypto';
import { AuthSession, SessionCleanupOptions } from '../../types/auth';
import { AuthTokenRecord } from '../../types/user';

export class SessionManager {
  constructor(private pool: Pool) {}

  /**
   * Create a new session
   */
  async createSession(
    userId: string, 
    ipAddress: string, 
    userAgent: string,
    expirationHours: number = 168 // 7 days default
  ): Promise<{ session: AuthSession; token: string }> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      // Clean up existing expired sessions for this user
      await this.cleanupExpiredSessions(userId, client);

      // Generate secure session token
      const token = this.generateSecureToken();
      const tokenHash = this.hashToken(token);
      
      const sessionId = uuidv4();
      const now = new Date();
      const expiresAt = new Date(now.getTime() + (expirationHours * 60 * 60 * 1000));

      // Insert session into auth_tokens table
      await client.query(
        `INSERT INTO auth_tokens (id, user_id, token_hash, expires_at, type) 
         VALUES ($1, $2, $3, $4, $5)`,
        [sessionId, userId, tokenHash, expiresAt, 'session']
      );

      // Create session record
      const session: AuthSession = {
        id: sessionId,
        userId,
        token: tokenHash, // Store hash for security
        expiresAt,
        createdAt: now,
        lastAccessed: now,
        ipAddress,
        userAgent,
        isActive: true
      };

      await client.query('COMMIT');
      
      return { session, token }; // Return plain token for client
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Validate and refresh session
   */
  async validateSession(token: string, ipAddress?: string): Promise<AuthSession | null> {
    const tokenHash = this.hashToken(token);
    const client = await this.pool.connect();
    
    try {
      // Get session with user info
      const result = await client.query(
        `SELECT t.*, u.email, u.username, u.is_verified 
         FROM auth_tokens t
         JOIN public.users u ON t.user_id = u.id
         WHERE t.token_hash = $1 AND t.type = 'session' AND t.expires_at > NOW()`,
        [tokenHash]
      );

      if (result.rows.length === 0) {
        return null;
      }

      const row = result.rows[0];
      
      // Update last accessed time
      await client.query(
        `UPDATE auth_tokens SET expires_at = expires_at + INTERVAL '1 hour' 
         WHERE id = $1 AND expires_at > NOW() - INTERVAL '24 hours'`,
        [row.id]
      );

      return {
        id: row.id,
        userId: row.user_id,
        token: tokenHash,
        expiresAt: row.expires_at,
        createdAt: row.created_at || new Date(), // fallback if missing
        lastAccessed: new Date(),
        ipAddress: ipAddress || 'unknown',
        userAgent: 'unknown',
        isActive: true
      };
    } finally {
      client.release();
    }
  }

  /**
   * Revoke session (logout)
   */
  async revokeSession(token: string): Promise<boolean> {
    const tokenHash = this.hashToken(token);
    const result = await this.pool.query(
      `DELETE FROM auth_tokens WHERE token_hash = $1 AND type = 'session'`,
      [tokenHash]
    );
    
    return (result.rowCount || 0) > 0;
  }

  /**
   * Revoke all sessions for a user (logout from all devices)
   */
  async revokeAllUserSessions(userId: string): Promise<number> {
    const result = await this.pool.query(
      `DELETE FROM auth_tokens WHERE user_id = $1 AND type = 'session'`,
      [userId]
    );
    
    return result.rowCount || 0;
  }

  /**
   * Get all active sessions for a user
   */
  async getUserSessions(userId: string): Promise<AuthSession[]> {
    const result = await this.pool.query(
      `SELECT * FROM auth_tokens 
       WHERE user_id = $1 AND type = 'session' AND expires_at > NOW()
       ORDER BY expires_at DESC`,
      [userId]
    );

    return result.rows.map(row => ({
      id: row.id,
      userId: row.user_id,
      token: row.token_hash,
      expiresAt: row.expires_at,
      createdAt: row.created_at || new Date(),
      lastAccessed: row.updated_at || row.created_at || new Date(),
      ipAddress: 'stored', // Would need additional table for full session info
      userAgent: 'stored',
      isActive: true
    }));
  }

  /**
   * Clean up expired sessions
   */
  async cleanupExpiredSessions(userId?: string, client?: any): Promise<number> {
    const dbClient = client || this.pool;
    
    let query = `DELETE FROM auth_tokens WHERE type = 'session' AND expires_at <= NOW()`;
    const params: any[] = [];
    
    if (userId) {
      query += ` AND user_id = $1`;
      params.push(userId);
    }
    
    const result = await dbClient.query(query, params);
    return result.rowCount || 0;
  }

  /**
   * Cleanup old sessions based on options
   */
  async performSessionCleanup(options: SessionCleanupOptions = {}): Promise<{
    expiredRemoved: number;
    idleRemoved: number;
    oldRemoved: number;
  }> {
    const client = await this.pool.connect();
    let expiredRemoved = 0;
    let idleRemoved = 0;
    let oldRemoved = 0;

    try {
      // Clean expired sessions
      if (options.cleanupExpired !== false) {
        const expiredResult = await client.query(
          `DELETE FROM auth_tokens WHERE type = 'session' AND expires_at <= NOW()`
        );
        expiredRemoved = expiredResult.rowCount || 0;
      }

      // Clean idle sessions (if we had last_accessed tracking)
      if (options.maxIdleTime) {
        const idleResult = await client.query(
          `DELETE FROM auth_tokens 
           WHERE type = 'session' 
           AND expires_at > NOW()
           AND expires_at < NOW() - INTERVAL '${options.maxIdleTime} milliseconds'`
        );
        idleRemoved = idleResult.rowCount || 0;
      }

      // Clean very old sessions
      if (options.maxSessionAge) {
        const oldResult = await client.query(
          `DELETE FROM auth_tokens 
           WHERE type = 'session' 
           AND (expires_at - INTERVAL '7 days') < NOW() - INTERVAL '${options.maxSessionAge} milliseconds'`
        );
        oldRemoved = oldResult.rowCount || 0;
      }

    } finally {
      client.release();
    }

    return { expiredRemoved, idleRemoved, oldRemoved };
  }

  /**
   * Generate a cryptographically secure token
   */
  private generateSecureToken(): string {
    return crypto.randomBytes(32).toString('hex');
  }

  /**
   * Hash token for secure storage
   */
  private hashToken(token: string): string {
    return crypto.createHash('sha256').update(token).digest('hex');
  }
}
