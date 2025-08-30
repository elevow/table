// US-018: Avatar Management - Service Layer

import { AvatarManager } from '../database/avatar-manager';
import { Pool } from 'pg';
import {
  AvatarRecord,
  AvatarVersionRecord,
  CreateAvatarRequest,
  UpdateAvatarRequest,
  PaginatedAvatarsResponse,
  AvatarServiceError
} from '../../types/avatar';

class AvatarServiceErrorImpl extends Error implements AvatarServiceError {
  code: string;
  details?: Record<string, any>;
  constructor(message: string, code = 'UNKNOWN_ERROR', details?: Record<string, any>) {
    super(message);
    this.name = 'AvatarServiceError';
    this.code = code;
    this.details = details;
  }
}

export class AvatarService {
  private manager: AvatarManager;

  constructor(pool: Pool) {
    this.manager = new AvatarManager(pool);
  }

  async uploadAvatar(req: CreateAvatarRequest): Promise<AvatarRecord> {
    // Initial status pending
    return this.manager.createAvatar(req);
  }

  async approveAvatar(avatarId: string, moderatorId: string): Promise<AvatarRecord> {
    return this.manager.updateAvatar(avatarId, { status: 'approved', moderatorId, moderatedAt: new Date() });
  }

  async rejectAvatar(avatarId: string, moderatorId: string): Promise<AvatarRecord> {
    return this.manager.updateAvatar(avatarId, { status: 'rejected', moderatorId, moderatedAt: new Date() });
  }

  async addVersion(avatarId: string, url: string): Promise<AvatarVersionRecord> {
    return this.manager.addAvatarVersion(avatarId, url);
  }

  async listVersions(avatarId: string): Promise<AvatarVersionRecord[]> {
    return this.manager.listVersions(avatarId);
  }

  async getLatestForUser(userId: string): Promise<AvatarRecord | null> {
    return this.manager.getLatestAvatarForUser(userId);
  }

  async search(userId: string | undefined, status: 'pending' | 'approved' | 'rejected' | 'archived' | undefined, page: number, limit: number): Promise<PaginatedAvatarsResponse> {
    return this.manager.searchAvatars({ userId, status }, page, limit);
  }
}
