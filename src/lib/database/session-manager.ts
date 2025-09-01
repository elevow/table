// US-068: Session Tracking - Data Access Layer
import { Pool } from 'pg';
import {
  CreateSessionRequest,
  PaginatedSessionsResponse,
  RenewSessionRequest,
  SessionError,
  UserSessionRecord,
  SessionQueryOptions
} from '../../types/session';

export class SessionManager {
  constructor(private pool: Pool) {}

  private mapRow(row: any): UserSessionRecord {
    return {
      id: row.id,
      userId: row.user_id,
      token: row.token,
      ipAddress: row.ip_address ?? null,
      userAgent: row.user_agent ?? null,
      createdAt: row.created_at,
      expiresAt: row.expires_at,
      lastActivity: row.last_activity,
    };
  }

  async createSession(req: CreateSessionRequest): Promise<UserSessionRecord> {
    const expiresAt = new Date(Date.now() + req.ttlSeconds * 1000);
    const res = await this.pool.query(
      `INSERT INTO user_sessions (user_id, token, ip_address, user_agent, expires_at)
       VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [req.userId, req.token, req.ipAddress || null, req.userAgent || null, expiresAt]
    );
    return this.mapRow(res.rows[0]);
  }

  async getByToken(token: string): Promise<UserSessionRecord | null> {
    const res = await this.pool.query(`SELECT * FROM user_sessions WHERE token = $1`, [token]);
    return res.rows[0] ? this.mapRow(res.rows[0]) : null;
  }

  async touchActivity(token: string): Promise<void> {
    await this.pool.query(`UPDATE user_sessions SET last_activity = NOW() WHERE token = $1`, [token]);
  }

  async renewSession(req: RenewSessionRequest): Promise<UserSessionRecord> {
    const expiresAt = new Date(Date.now() + req.ttlSeconds * 1000);
    const res = await this.pool.query(
      `UPDATE user_sessions SET expires_at = $1, last_activity = NOW() WHERE token = $2 RETURNING *`,
      [expiresAt, req.token]
    );
    if (!res.rows[0]) throw new SessionError('Session not found', 'NOT_FOUND');
    return this.mapRow(res.rows[0]);
  }

  async revokeByToken(token: string): Promise<void> {
    await this.pool.query(`DELETE FROM user_sessions WHERE token = $1`, [token]);
  }

  async revokeAllForUser(userId: string): Promise<number> {
    const res = await this.pool.query(`DELETE FROM user_sessions WHERE user_id = $1`, [userId]);
    return res.rowCount || 0;
  }

  async listUserSessions(userId: string, opts: SessionQueryOptions = {}): Promise<PaginatedSessionsResponse> {
    const page = opts.page && opts.page > 0 ? opts.page : 1;
    const limit = opts.limit && opts.limit > 0 ? Math.min(opts.limit, 100) : 20;
    const offset = (page - 1) * limit;
    const count = await this.pool.query(`SELECT COUNT(*) AS total FROM user_sessions WHERE user_id = $1`, [userId]);
    const total = parseInt(count.rows?.[0]?.total || '0', 10);
    const rows = await this.pool.query(
      `SELECT * FROM user_sessions WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3`,
      [userId, limit, offset]
    );
    return {
      sessions: rows.rows.map(r => this.mapRow(r)),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  async countActiveSessions(userId: string): Promise<number> {
    const res = await this.pool.query(
      `SELECT COUNT(*)::int AS cnt FROM user_sessions WHERE user_id = $1 AND expires_at > NOW()`,
      [userId]
    );
    return res.rows?.[0]?.cnt ?? 0;
  }
}
