// US-019: Friend Relationships - Service Layer

import { Pool } from 'pg';
import { FriendManager } from '../database/friend-manager';
import { BlockRecord, FriendRelationshipRecord, Paginated, FriendRelationshipStatus, FriendInviteRecord, HeadToHeadSummary } from '../../types/friend';

export class FriendService {
  private manager: FriendManager;

  constructor(pool: Pool) {
    this.manager = new FriendManager(pool);
  }

  async sendRequest(requesterId: string, recipientId: string): Promise<FriendRelationshipRecord> {
    this.requireId(requesterId, 'requesterId');
    this.requireId(recipientId, 'recipientId');
    return this.manager.sendRequest({ requesterId, recipientId });
  }

  async respondToRequest(id: string, action: 'accept' | 'decline'): Promise<FriendRelationshipRecord> {
    this.requireId(id, 'id');
    const accept = action === 'accept';
    return this.manager.respondToRequest(id, accept);
  }

  async listFriends(userId: string, page = 1, limit = 20): Promise<Paginated<FriendRelationshipRecord>> {
    this.requireId(userId, 'userId');
    const { p, l } = this.normalizePagination(page, limit);
    return this.manager.listFriends(userId, p, l);
  }

  async listPending(userId: string, page = 1, limit = 20): Promise<Paginated<FriendRelationshipRecord>> {
    this.requireId(userId, 'userId');
    const { p, l } = this.normalizePagination(page, limit);
    return this.manager.listPending(userId, p, l);
  }

  async unfriend(a: string, b: string): Promise<void> {
    this.requireId(a, 'a');
    this.requireId(b, 'b');
    return this.manager.unfriend(a, b);
  }

  async block(userId: string, blockedId: string, reason?: string): Promise<BlockRecord> {
    this.requireId(userId, 'userId');
    this.requireId(blockedId, 'blockedId');
    return this.manager.block(userId, blockedId, reason);
  }

  async unblock(userId: string, blockedId: string): Promise<void> {
    this.requireId(userId, 'userId');
    this.requireId(blockedId, 'blockedId');
    return this.manager.unblock(userId, blockedId);
  }

  // US-064: Relationship status
  async relationshipStatus(a: string, b: string): Promise<FriendRelationshipStatus> {
    this.requireId(a, 'a');
    this.requireId(b, 'b');
    return this.manager.getRelationshipStatus(a, b);
  }

  // US-064: Game invites
  async inviteToGame(inviterId: string, inviteeId: string, roomId: string): Promise<FriendInviteRecord> {
    this.requireId(inviterId, 'inviterId');
    this.requireId(inviteeId, 'inviteeId');
    this.requireId(roomId, 'roomId');
    return this.manager.createGameInvite(inviterId, inviteeId, roomId);
  }

  async respondToInvite(id: string, action: 'accept' | 'decline'): Promise<FriendInviteRecord> {
    this.requireId(id, 'id');
    const accept = action === 'accept';
    return this.manager.respondToGameInvite(id, accept);
  }

  async listInvites(userId: string, kind: 'incoming' | 'outgoing' = 'incoming', page = 1, limit = 20): Promise<Paginated<FriendInviteRecord>> {
    this.requireId(userId, 'userId');
    const { p, l } = this.normalizePagination(page, limit);
    return this.manager.listInvites(userId, kind, p, l);
  }

  // US-064: Head-to-head summary
  async headToHead(a: string, b: string): Promise<HeadToHeadSummary> {
    this.requireId(a, 'a');
    this.requireId(b, 'b');
    return this.manager.getHeadToHeadSummary(a, b);
  }

  private requireId(value: string | undefined, name: string): void {
    if (!value || typeof value !== 'string' || value.trim() === '') {
      throw new Error(`Missing or invalid ${name}`);
    }
  }

  private normalizePagination(page?: number, limit?: number): { p: number; l: number } {
    const p = Number.isFinite(page as number) && (page as number) > 0 ? (page as number) : 1;
    const l = Number.isFinite(limit as number) && (limit as number) > 0 && (limit as number) <= 100 ? (limit as number) : 20;
    return { p, l };
  }
}
