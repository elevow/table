// US-068: Session Tracking - Types

export interface UserSessionRecord {
  id: string;
  userId: string;
  token: string;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: Date;
  expiresAt: Date;
  lastActivity: Date;
}

export interface CreateSessionRequest {
  userId: string;
  token: string;
  ttlSeconds: number;
  ipAddress?: string | null;
  userAgent?: string | null;
}

export interface RenewSessionRequest {
  token: string;
  ttlSeconds: number;
}

export interface SessionQueryOptions {
  page?: number;
  limit?: number;
}

export interface PaginatedSessionsResponse {
  sessions: UserSessionRecord[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export class SessionError extends Error {
  code: string;
  details?: Record<string, any>;
  constructor(message: string, code = 'SESSION_ERROR', details?: Record<string, any>) {
    super(message);
    this.name = 'SessionError';
    this.code = code;
    this.details = details;
  }
}
