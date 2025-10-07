// US-018: Avatar Management - Data Access Layer

import { Pool } from 'pg';
import { v4 as uuidv4 } from 'uuid';
import {
  AvatarRecord,
  AvatarVersionRecord,
  CreateAvatarRequest,
  UpdateAvatarRequest,
  AvatarQueryFilters,
  PaginatedAvatarsResponse,
  AvatarServiceError,
  AvatarStatus
} from '../../types/avatar';

class AvatarError extends Error implements AvatarServiceError {
  code: string;
  details?: Record<string, any>;
  constructor(message: string, code = 'UNKNOWN_ERROR', details?: Record<string, any>) {
    super(message);
    this.name = 'AvatarError';
    this.code = code;
    this.details = details;
  }
}

export class AvatarManager {
  constructor(private pool: Pool) {}

  async createAvatar(req: CreateAvatarRequest): Promise<AvatarRecord> {
    const id = uuidv4();
    const res = await this.pool.query(
      `INSERT INTO avatars (id, user_id, status, original_url, variants)
       VALUES ($1,$2,'active',$3,$4::jsonb) RETURNING *`,
      [id, req.userId, req.originalUrl, JSON.stringify(req.variants)]
    );
    return this.mapRowToAvatar(res.rows[0]);
  }

  async getAvatarById(id: string): Promise<AvatarRecord | null> {
    const res = await this.pool.query('SELECT * FROM avatars WHERE id = $1', [id]);
    return res.rows[0] ? this.mapRowToAvatar(res.rows[0]) : null;
  }

  async getLatestAvatarForUser(userId: string): Promise<AvatarRecord | null> {
    try {
      const res = await this.pool.query(
        'SELECT * FROM avatars WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1',
        [userId]
      );
      return res.rows[0] ? this.mapRowToAvatar(res.rows[0]) : null;
    } catch (e: any) {
      // Gracefully handle invalid UUID cast errors from Postgres
      if (e && (e.code === '22P02' || /invalid input syntax for type uuid/i.test(e.message || ''))) {
        return null;
      }
      throw e;
    }
  }

  async updateAvatar(id: string, updates: UpdateAvatarRequest): Promise<AvatarRecord> {
    const sets: string[] = [];
    const vals: any[] = [];
    let i = 1;
    if (updates.status !== undefined) { sets.push(`status = $${i++}`); vals.push(updates.status); }
    if (updates.variants !== undefined) { sets.push(`variants = $${i++}::jsonb`); vals.push(JSON.stringify(updates.variants)); }
    if (!sets.length) {
      const existing = await this.getAvatarById(id);
      if (!existing) throw new AvatarError('Avatar not found', 'NOT_FOUND');
      return existing;
    }
    vals.push(id);
    const res = await this.pool.query(
      `UPDATE avatars SET ${sets.join(', ')} WHERE id = $${i} RETURNING *`,
      vals
    );
    if (!res.rows[0]) throw new AvatarError('Avatar not found', 'NOT_FOUND');
    return this.mapRowToAvatar(res.rows[0]);
  }

  async addAvatarVersion(avatarId: string, url: string): Promise<AvatarVersionRecord> {
    // Determine next version
    const current = await this.pool.query(
      'SELECT COALESCE(MAX(version), 0) AS v FROM avatar_versions WHERE avatar_id = $1',
      [avatarId]
    );
    const next = Number(current.rows?.[0]?.v || 0) + 1;
    const res = await this.pool.query(
      `INSERT INTO avatar_versions (avatar_id, version, url) VALUES ($1,$2,$3) RETURNING *`,
      [avatarId, next, url]
    );
    // Also update primary avatar version
    await this.pool.query('UPDATE avatars SET version = $1 WHERE id = $2', [next, avatarId]);
    return this.mapRowToAvatarVersion(res.rows[0]);
  }

  async listVersions(avatarId: string): Promise<AvatarVersionRecord[]> {
    const res = await this.pool.query(
      'SELECT * FROM avatar_versions WHERE avatar_id = $1 ORDER BY version ASC',
      [avatarId]
    );
    return res.rows.map(r => this.mapRowToAvatarVersion(r));
  }

  async searchAvatars(filters: AvatarQueryFilters, page: number, limit: number): Promise<PaginatedAvatarsResponse> {
    const clauses: string[] = [];
    const vals: any[] = [];
    let i = 1;
    if (filters.userId) { clauses.push(`user_id = $${i++}`); vals.push(filters.userId); }
    if (filters.status) { clauses.push(`status = $${i++}`); vals.push(filters.status); }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';

    const count = await this.pool.query(`SELECT COUNT(*) AS total FROM avatars ${where}`, vals);
    const total = parseInt(count.rows?.[0]?.total || '0', 10);
    const offset = (page - 1) * limit;
    const list = await this.pool.query(
      `SELECT * FROM avatars ${where} ORDER BY created_at DESC LIMIT $${i++} OFFSET $${i++}`,
      [...vals, limit, offset]
    );
    return {
      avatars: list.rows.map(r => this.mapRowToAvatar(r)),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit)
    };
  }

  private mapRowToAvatar(row: any): AvatarRecord {
    return {
      id: row.id,
      userId: row.user_id,
      status: row.status as AvatarStatus,
      originalUrl: row.original_url,
      variants: row.variants || {},
      version: row.version,
      createdAt: row.created_at,
    };
  }

  private mapRowToAvatarVersion(row: any): AvatarVersionRecord {
    return {
      id: row.id,
      avatarId: row.avatar_id,
      version: row.version,
      url: row.url,
      createdAt: row.created_at,
    };
  }
}
