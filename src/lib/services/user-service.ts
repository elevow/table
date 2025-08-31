// US-017: Core User Profile - Service Layer

import crypto from 'crypto';
import { UserManager } from '../database/user-manager';
import {
  UserRecord,
  CreateUserRequest,
  UpdateUserRequest,
  PaginatedUsersResponse,
  UserQueryFilters,
  PaginationOptions
} from '../../types/user';

export class UserService {
  constructor(private manager: UserManager) {}

  createUser(req: CreateUserRequest): Promise<UserRecord> {
    return this.manager.createUser(req);
  }

  getUserById(id: string, callerUserId?: string): Promise<UserRecord | null> {
    return this.manager.getUserById(id, callerUserId);
  }

  getUserByEmail(email: string): Promise<UserRecord | null> {
    return this.manager.getUserByEmail(email);
  }

  getUserByUsername(username: string): Promise<UserRecord | null> {
    return this.manager.getUserByUsername(username);
  }

  updateUser(id: string, updates: UpdateUserRequest, callerUserId?: string): Promise<UserRecord> {
    return this.manager.updateUser(id, updates, callerUserId);
  }

  searchUsers(filters: UserQueryFilters, pagination: PaginationOptions): Promise<PaginatedUsersResponse> {
    return this.manager.searchUsers(filters, pagination);
  }

  // Password reset token management (store only hash)
  async createPasswordReset(userId: string, ttlMinutes = 60): Promise<{ token: string; expiresAt: Date }> {
    const token = crypto.randomBytes(32).toString('hex');
    const tokenHash = this.hashToken(token);
    const expiresAt = new Date(Date.now() + ttlMinutes * 60_000);
    await this.manager.upsertAuthToken(userId, tokenHash, expiresAt, 'password_reset');
    return { token, expiresAt };
  }

  async verifyPasswordReset(userId: string, token: string): Promise<boolean> {
    const tokenHash = this.hashToken(token);
    const existing = await this.manager.findValidToken(userId, tokenHash, 'password_reset');
    return !!existing;
  }

  async consumePasswordReset(userId: string, token: string): Promise<boolean> {
    const tokenHash = this.hashToken(token);
    const existing = await this.manager.findValidToken(userId, tokenHash, 'password_reset');
    if (!existing) return false;
    await this.manager.deleteToken(existing.id);
    return true;
  }

  private hashToken(token: string): string {
    return crypto.createHash('sha256').update(token).digest('hex');
  }
}

export function createUserService(manager: UserManager): UserService {
  return new UserService(manager);
}
