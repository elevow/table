// US-019: Friend Relationships - Data Access Layer

import { Pool } from 'pg';
import { v4 as uuidv4 } from 'uuid';
import {
  FriendRelationshipRecord,
  FriendRequestInput,
  FriendStatus,
  BlockRecord,
  Paginated,
  FriendRelationshipStatus,
  FriendInviteRecord,
  HeadToHeadSummary
} from '../../types/friend';

class FriendError extends Error {
  code: string;
  details?: Record<string, any>;
  constructor(message: string, code = 'UNKNOWN_ERROR', details?: Record<string, any>) {
    super(message);
    this.name = 'FriendError';
    this.code = code;
    this.details = details;
  }
}

export class FriendManager {
  constructor(private pool: Pool) {}

  async sendRequest(input: FriendRequestInput): Promise<FriendRelationshipRecord> {
    const { requesterId, recipientId } = input;
    if (requesterId === recipientId) throw new FriendError('Cannot friend yourself', 'INVALID');

    // Check for block
    const block = await this.pool.query(
      `SELECT 1 FROM blocked_users WHERE (user_id = $1 AND blocked_id = $2) OR (user_id = $2 AND blocked_id = $1) LIMIT 1`,
      [requesterId, recipientId]
    );
    if (block.rows.length) throw new FriendError('Either user has blocked the other', 'BLOCKED');

    const existing = await this.pool.query(
      `SELECT * FROM friend_relationships 
       WHERE (user_id = $1 AND friend_id = $2) OR (user_id = $2 AND friend_id = $1)
       LIMIT 1`,
      [requesterId, recipientId]
    );
    if (existing.rows[0]) {
      const row = existing.rows[0];
      if (row.status === 'pending') throw new FriendError('Request already pending', 'DUPLICATE');
      if (row.status === 'accepted') throw new FriendError('Already friends', 'ALREADY_FRIENDS');
      // If declined previously, allow new pending by updating
      const upd = await this.pool.query(
        `UPDATE friend_relationships SET user_id = $1, friend_id = $2, status = 'pending', updated_at = NOW() 
         WHERE id = $3 RETURNING *`,
        [requesterId, recipientId, row.id]
      );
      return this.mapFriend(upd.rows[0]);
    }

    const id = uuidv4();
    const res = await this.pool.query(
      `INSERT INTO friend_relationships (id, user_id, friend_id, status) VALUES ($1,$2,$3,'pending') RETURNING *`,
      [id, requesterId, recipientId]
    );
    return this.mapFriend(res.rows[0]);
  }

  async respondToRequest(id: string, accept: boolean): Promise<FriendRelationshipRecord> {
    const status: FriendStatus = accept ? 'accepted' : 'declined';
    const res = await this.pool.query(
      `UPDATE friend_relationships SET status = $1, updated_at = NOW() WHERE id = $2 RETURNING *`,
      [status, id]
    );
    if (!res.rows[0]) throw new FriendError('Request not found', 'NOT_FOUND');
    return this.mapFriend(res.rows[0]);
  }

  async listFriends(userId: string, page = 1, limit = 20): Promise<Paginated<FriendRelationshipRecord>> {
    const offset = (page - 1) * limit;
    const count = await this.pool.query(
      `SELECT COUNT(*) AS total FROM friend_relationships 
       WHERE (user_id = $1 OR friend_id = $1) AND status = 'accepted'`,
      [userId]
    );
    const total = parseInt(count.rows?.[0]?.total || '0', 10);
    const res = await this.pool.query(
      `SELECT * FROM friend_relationships 
       WHERE (user_id = $1 OR friend_id = $1) AND status = 'accepted'
       ORDER BY updated_at DESC
       LIMIT $2 OFFSET $3`,
      [userId, limit, offset]
    );
    const items = res.rows.map(r => this.mapFriend(r));
    return { items, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async listPending(userId: string, page = 1, limit = 20): Promise<Paginated<FriendRelationshipRecord>> {
    const offset = (page - 1) * limit;
    const count = await this.pool.query(
      `SELECT COUNT(*) AS total FROM friend_relationships 
       WHERE friend_id = $1 AND status = 'pending'`,
      [userId]
    );
    const total = parseInt(count.rows?.[0]?.total || '0', 10);
    const res = await this.pool.query(
      `SELECT * FROM friend_relationships 
       WHERE friend_id = $1 AND status = 'pending'
       ORDER BY created_at DESC
       LIMIT $2 OFFSET $3`,
      [userId, limit, offset]
    );
    const items = res.rows.map(r => this.mapFriend(r));
    return { items, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async unfriend(betweenA: string, andB: string): Promise<void> {
    await this.pool.query(
      `DELETE FROM friend_relationships WHERE (user_id = $1 AND friend_id = $2) OR (user_id = $2 AND friend_id = $1)`,
      [betweenA, andB]
    );
  }

  async block(userId: string, blockedId: string, reason?: string): Promise<BlockRecord> {
    const id = uuidv4();
    const res = await this.pool.query(
      `INSERT INTO blocked_users (id, user_id, blocked_id, reason) VALUES ($1,$2,$3,$4) RETURNING *`,
      [id, userId, blockedId, reason || null]
    );
    // Remove any friend relationships
    await this.unfriend(userId, blockedId);
    return this.mapBlock(res.rows[0]);
  }

  async unblock(userId: string, blockedId: string): Promise<void> {
    await this.pool.query(`DELETE FROM blocked_users WHERE user_id = $1 AND blocked_id = $2`, [userId, blockedId]);
  }

  // US-064: relationship status between two users
  async getRelationshipStatus(a: string, b: string): Promise<FriendRelationshipStatus> {
    const res = await this.pool.query(
      `SELECT * FROM friend_relationships WHERE (user_id = $1 AND friend_id = $2) OR (user_id = $2 AND friend_id = $1) LIMIT 1`,
      [a, b]
    );
    const row = res.rows[0];
    if (!row) return { status: 'none', direction: null };
    if (row.status === 'pending') {
      const direction = row.user_id === a ? 'outgoing' : 'incoming';
      return { status: 'pending', direction };
    }
    return { status: row.status as any, direction: null };
  }

  // US-064: Game invites between friends - store as friend_relationships extensions via a separate invites table
  async createGameInvite(inviterId: string, inviteeId: string, roomId: string): Promise<FriendInviteRecord> {
    // Ensure not blocked and either friends or pending allowed invites
    const block = await this.pool.query(
      `SELECT 1 FROM blocked_users WHERE (user_id = $1 AND blocked_id = $2) OR (user_id = $2 AND blocked_id = $1) LIMIT 1`,
      [inviterId, inviteeId]
    );
    if (block.rows.length) throw new FriendError('Either user has blocked the other', 'BLOCKED');

    const id = uuidv4();
    const res = await this.pool.query(
      `INSERT INTO friend_game_invites (id, inviter_id, invitee_id, room_id, status) VALUES ($1,$2,$3,$4,'pending') RETURNING *`,
      [id, inviterId, inviteeId, roomId]
    );
    return this.mapInvite(res.rows[0]);
  }

  async respondToGameInvite(id: string, accept: boolean): Promise<FriendInviteRecord> {
    const status = accept ? 'accepted' : 'declined';
    const res = await this.pool.query(
      `UPDATE friend_game_invites SET status = $1, responded_at = NOW() WHERE id = $2 RETURNING *`,
      [status, id]
    );
    if (!res.rows[0]) throw new FriendError('Invite not found', 'NOT_FOUND');
    return this.mapInvite(res.rows[0]);
  }

  async listInvites(userId: string, kind: 'incoming' | 'outgoing' = 'incoming', page = 1, limit = 20): Promise<Paginated<FriendInviteRecord>> {
    const col = kind === 'incoming' ? 'invitee_id' : 'inviter_id';
    const offset = (page - 1) * limit;
    const count = await this.pool.query(`SELECT COUNT(*) AS total FROM friend_game_invites WHERE ${col} = $1`, [userId]);
    const total = parseInt(count.rows?.[0]?.total || '0', 10);
    const res = await this.pool.query(
      `SELECT * FROM friend_game_invites WHERE ${col} = $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3`,
      [userId, limit, offset]
    );
    const items = res.rows.map(r => this.mapInvite(r));
    return { items, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  // US-064: Head-to-head summary using game_history
  async getHeadToHeadSummary(a: string, b: string): Promise<HeadToHeadSummary> {
    const res = await this.pool.query(
      `SELECT 
         COUNT(*)::int AS games_played,
         COALESCE(MAX(gh.ended_at), MAX(gh.started_at)) AS last_played
       FROM game_history gh
       WHERE (gh.action_sequence @> $1::jsonb OR gh.results @> $2::jsonb)
         AND (gh.action_sequence @> $3::jsonb OR gh.results @> $4::jsonb)`,
      [
        JSON.stringify([{ playerId: a }]),
        JSON.stringify({ winners: [{ playerId: a }] }),
        JSON.stringify([{ playerId: b }]),
        JSON.stringify({ winners: [{ playerId: b }] })
      ]
    );
    const gamesPlayed = parseInt(res.rows?.[0]?.games_played || '0', 10);
    const lastPlayed = res.rows?.[0]?.last_played || null;
    return { gamesPlayed, lastPlayed };
  }

  private mapFriend(row: any): FriendRelationshipRecord {
    return {
      id: row.id,
      userId: row.user_id,
      friendId: row.friend_id,
      status: row.status,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }

  private mapBlock(row: any): BlockRecord {
    return {
      id: row.id,
      userId: row.user_id,
      blockedId: row.blocked_id,
      reason: row.reason ?? null,
      createdAt: row.created_at
    };
  }

  private mapInvite(row: any): FriendInviteRecord {
    return {
      id: row.id,
      inviterId: row.inviter_id,
      inviteeId: row.invitee_id,
      roomId: row.room_id,
      status: row.status,
      createdAt: row.created_at,
      respondedAt: row.responded_at ?? null
    };
  }
}
