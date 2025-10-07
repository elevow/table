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
    // Avatars are immediately active - no approval process
    return this.manager.createAvatar(req);
  }

  async addVersion(avatarId: string, url: string): Promise<AvatarVersionRecord> {
    return this.manager.addAvatarVersion(avatarId, url);
  }

  async listVersions(avatarId: string): Promise<AvatarVersionRecord[]> {
    return this.manager.listVersions(avatarId);
  }

  async getLatestForUser(userId: string): Promise<AvatarRecord | null> {
    // Defensive: short-circuit for non-UUID ids (frontend may pass short ids)
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(userId);
    if (!isUuid) return null;
    return this.manager.getLatestAvatarForUser(userId);
  }

  async search(userId: string | undefined, status: 'active' | 'archived' | undefined, page: number, limit: number): Promise<PaginatedAvatarsResponse> {
    return this.manager.searchAvatars({ userId, status }, page, limit);
  }
}
