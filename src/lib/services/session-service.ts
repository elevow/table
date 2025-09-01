// US-068: Session Tracking - Service Layer
import { Pool } from 'pg';
import { SessionManager } from '../database/session-manager';
import {
  CreateSessionRequest,
  RenewSessionRequest,
  SessionError,
  UserSessionRecord,
  PaginatedSessionsResponse,
  SessionQueryOptions,
} from '../../types/session';

export interface SessionServiceConfig {
  maxConcurrentSessions?: number; // Monitor concurrent sessions per user
}

export class SessionService {
  private mgr: SessionManager;
  private cfg: Required<SessionServiceConfig>;

  constructor(pool: Pool, cfg: SessionServiceConfig = {}, manager?: SessionManager) {
    this.mgr = manager ?? new SessionManager(pool);
    this.cfg = { maxConcurrentSessions: cfg.maxConcurrentSessions ?? 5 };
  }

  async createSession(req: CreateSessionRequest): Promise<UserSessionRecord> {
    const activeCount = await this.mgr.countActiveSessions(req.userId);
    if (activeCount >= this.cfg.maxConcurrentSessions) {
      throw new SessionError('Too many concurrent sessions', 'CONCURRENT_LIMIT');
    }
    return this.mgr.createSession(req);
  }

  async verifySession(token: string): Promise<UserSessionRecord | null> {
    const session = await this.mgr.getByToken(token);
    if (!session) return null;
    if (new Date(session.expiresAt).getTime() <= Date.now()) return null;
    return session;
  }

  async touchActivity(token: string): Promise<void> {
    await this.mgr.touchActivity(token);
  }

  async renewSession(req: RenewSessionRequest): Promise<UserSessionRecord> {
    return this.mgr.renewSession(req);
  }

  async revokeByToken(token: string): Promise<void> {
    await this.mgr.revokeByToken(token);
  }

  async revokeAllForUser(userId: string): Promise<number> {
    return this.mgr.revokeAllForUser(userId);
  }

  async listUserSessions(userId: string, opts: SessionQueryOptions = {}): Promise<PaginatedSessionsResponse> {
    return this.mgr.listUserSessions(userId, opts);
  }
}
