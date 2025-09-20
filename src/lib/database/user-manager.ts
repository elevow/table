// US-017: Core User Profile - Data Access Layer

import { Pool } from 'pg';
import { v4 as uuidv4 } from 'uuid';
import {
  UserRecord,
  CreateUserRequest,
  UpdateUserRequest,
  AuthTokenRecord,
  UserQueryFilters,
  PaginationOptions,
  PaginatedUsersResponse,
  UserServiceError
} from '../../types/user';

class UserError extends Error implements UserServiceError {
  code: string;
  details?: Record<string, any>;

  constructor(message: string, code = 'UNKNOWN_ERROR', details?: Record<string, any>) {
    super(message);
    this.name = 'UserError';
    this.code = code;
    this.details = details;
  }
}

export class UserManager {
  constructor(private pool: Pool) {}

  async createUser(req: CreateUserRequest): Promise<UserRecord> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      // Uniqueness checks
      const [emailCheck, usernameCheck] = await Promise.all([
        client.query('SELECT id FROM users WHERE email = $1', [req.email]),
        client.query('SELECT id FROM users WHERE username = $1', [req.username])
      ]);
      if (emailCheck.rows.length) throw new UserError('Email already exists', 'EMAIL_EXISTS');
      if (usernameCheck.rows.length) throw new UserError('Username already exists', 'USERNAME_EXISTS');

      const id = uuidv4();
      const insert = await client.query(
        `INSERT INTO users (id, email, username, password_hash, auth_provider, auth_provider_id, metadata)
         VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
        [
          id, 
          req.email, 
          req.username, 
          req.passwordHash || null,
          req.authProvider || null, 
          req.authProviderId || null, 
          req.metadata ? JSON.stringify(req.metadata) : null
        ]
      );

      await client.query('COMMIT');
      return this.mapRowToUser(insert.rows[0]);
    } catch (e: any) {
      await client.query('ROLLBACK');
      // Preserve known user errors
      if (e instanceof UserError) {
        throw e;
      }
      if (e && (e.code === 'EMAIL_EXISTS' || e.code === 'USERNAME_EXISTS')) {
        throw new UserError(e.message || 'Duplicate', e.code, e.details);
      }
      if (e?.code === '23505') {
        if (e?.detail?.includes('email')) throw new UserError('Email already exists', 'EMAIL_EXISTS');
        if (e?.detail?.includes('username')) throw new UserError('Username already exists', 'USERNAME_EXISTS');
      }
      throw new UserError(e?.message || 'Create user failed', 'CREATE_FAILED', { original: e });
    } finally {
      client.release();
    }
  }

  async getUserById(id: string, callerUserId?: string): Promise<UserRecord | null> {
    // If callerUserId provided, run within RLS context to honor policies
    if (callerUserId) {
      const { withRlsUserContext } = await import('./rls-context');
      return withRlsUserContext(this.pool, { userId: callerUserId }, async (client) => {
        const res = await client.query('SELECT * FROM users WHERE id = $1', [id]);
        return res.rows[0] ? this.mapRowToUser(res.rows[0]) : null;
      });
    }
    const res = await this.pool.query('SELECT * FROM users WHERE id = $1', [id]);
    return res.rows[0] ? this.mapRowToUser(res.rows[0]) : null;
  }

  async getUserByEmail(email: string): Promise<UserRecord | null> {
    const res = await this.pool.query('SELECT * FROM users WHERE email = $1', [email]);
    return res.rows[0] ? this.mapRowToUser(res.rows[0]) : null;
  }

  async getUserByUsername(username: string): Promise<UserRecord | null> {
    const res = await this.pool.query('SELECT * FROM users WHERE username = $1', [username]);
    return res.rows[0] ? this.mapRowToUser(res.rows[0]) : null;
  }

  async updateUser(id: string, updates: UpdateUserRequest, callerUserId?: string): Promise<UserRecord> {
    const sets: string[] = [];
    const vals: any[] = [];
    let i = 1;
    if (updates.email !== undefined) { sets.push(`email = $${i++}`); vals.push(updates.email); }
    if (updates.username !== undefined) { sets.push(`username = $${i++}`); vals.push(updates.username); }
    if (updates.passwordHash !== undefined) { sets.push(`password_hash = $${i++}`); vals.push(updates.passwordHash); }
    if (updates.lastLogin !== undefined) { sets.push(`last_login = $${i++}`); vals.push(updates.lastLogin); }
    if (updates.isVerified !== undefined) { sets.push(`is_verified = $${i++}`); vals.push(updates.isVerified); }
    if (updates.metadata !== undefined) { sets.push(`metadata = COALESCE(metadata,'{}'::jsonb) || $${i++}::jsonb`); vals.push(JSON.stringify(updates.metadata)); }
    if (!sets.length) {
      const existing = await this.getUserById(id, callerUserId);
      if (!existing) throw new UserError('User not found', 'NOT_FOUND');
      return existing;
    }
    vals.push(id);
    if (callerUserId) {
      const { withRlsUserContext } = await import('./rls-context');
      const res = await withRlsUserContext(this.pool, { userId: callerUserId }, async (client) => {
        return client.query(
          `UPDATE users SET ${sets.join(', ')} WHERE id = $${i} RETURNING *`,
          vals
        );
      });
      const row = (res as any).rows?.[0];
      if (!row) throw new UserError('User not found', 'NOT_FOUND');
      return this.mapRowToUser(row);
    }
    const res = await this.pool.query(
      `UPDATE users SET ${sets.join(', ')} WHERE id = $${i} RETURNING *`,
      vals
    );
    if (!res.rows[0]) throw new UserError('User not found', 'NOT_FOUND');
    return this.mapRowToUser(res.rows[0]);
  }

  async upsertAuthToken(userId: string, tokenHash: string, expiresAt: Date, type: AuthTokenRecord['type']): Promise<AuthTokenRecord> {
    const res = await this.pool.query(
      `INSERT INTO auth_tokens (user_id, token_hash, expires_at, type)
       VALUES ($1,$2,$3,$4) RETURNING *`,
      [userId, tokenHash, expiresAt, type]
    );
    return this.mapRowToToken(res.rows[0]);
  }

  async findValidToken(userId: string, tokenHash: string, type: AuthTokenRecord['type']): Promise<AuthTokenRecord | null> {
    const res = await this.pool.query(
      `SELECT * FROM auth_tokens WHERE user_id = $1 AND token_hash = $2 AND type = $3 AND expires_at > NOW()`,
      [userId, tokenHash, type]
    );
    return res.rows[0] ? this.mapRowToToken(res.rows[0]) : null;
  }

  async deleteToken(id: string): Promise<void> {
    await this.pool.query('DELETE FROM auth_tokens WHERE id = $1', [id]);
  }

  async searchUsers(filters: UserQueryFilters = {}, pagination: PaginationOptions): Promise<PaginatedUsersResponse> {
    const clauses: string[] = [];
    const vals: any[] = [];
    let i = 1;
    if (filters.email) { clauses.push(`email ILIKE $${i++}`); vals.push(`%${filters.email}%`); }
    if (filters.username) { clauses.push(`username ILIKE $${i++}`); vals.push(`%${filters.username}%`); }
    if (filters.createdAfter) { clauses.push(`created_at >= $${i++}`); vals.push(filters.createdAfter); }
    if (filters.createdBefore) { clauses.push(`created_at <= $${i++}`); vals.push(filters.createdBefore); }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';

    const count = await this.pool.query(`SELECT COUNT(*) AS total FROM users ${where}`, vals);
    const total = parseInt(count.rows?.[0]?.total || '0', 10);

    const orderBy = pagination.sortBy || 'created_at';
    const order = pagination.sortOrder || 'desc';
    const offset = (pagination.page - 1) * pagination.limit;

    const list = await this.pool.query(
      `SELECT * FROM users ${where} ORDER BY ${orderBy} ${order} LIMIT $${i++} OFFSET $${i++}`,
      [...vals, pagination.limit, offset]
    );

    return {
      users: list.rows.map(r => this.mapRowToUser(r)),
      total,
      page: pagination.page,
      limit: pagination.limit,
      totalPages: Math.ceil(total / pagination.limit)
    };
  }

  private mapRowToUser(row: any): UserRecord {
    return {
      id: row.id,
      email: row.email,
      username: row.username,
      passwordHash: row.password_hash,
      role: row.role || 'player', // Default to 'player' if role field doesn't exist
      createdAt: row.created_at,
      lastLogin: row.last_login,
      authProvider: row.auth_provider,
      authProviderId: row.auth_provider_id,
      isVerified: row.is_verified,
      metadata: row.metadata ?? null,
    };
  }

  private mapRowToToken(row: any): AuthTokenRecord {
    return {
      id: row.id,
      userId: row.user_id,
      tokenHash: row.token_hash,
      expiresAt: row.expires_at,
      type: row.type
    };
  }
}
