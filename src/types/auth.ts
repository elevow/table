// Authentication and Session Management Types

export interface AuthSession {
  id: string;
  userId: string;
  token: string;
  expiresAt: Date;
  createdAt: Date;
  lastAccessed: Date;
  ipAddress: string;
  userAgent: string;
  isActive: boolean;
}

export interface AuthUser {
  id: string;
  email: string;
  username: string;
  isVerified: boolean;
  lastLogin?: Date;
  permissions?: string[];
  roles?: string[];
}

export interface AuthContext {
  user: AuthUser;
  session: AuthSession;
  isAuthenticated: boolean;
}

export interface AuthenticationOptions {
  requireAuth?: boolean;
  requireVerification?: boolean;
  permissions?: string[];
  roles?: string[];
  maxTokenAge?: number; // in milliseconds
}

export interface SessionCleanupOptions {
  maxIdleTime?: number; // milliseconds
  maxSessionAge?: number; // milliseconds
  cleanupExpired?: boolean;
}

export class AuthError extends Error {
  code: string;
  statusCode: number;

  constructor(message: string, code: string = 'AUTH_ERROR', statusCode: number = 401) {
    super(message);
    this.name = 'AuthError';
    this.code = code;
    this.statusCode = statusCode;
  }
}
