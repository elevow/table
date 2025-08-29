// US-017: Core User Profile - Types

export interface UserRecord {
  id: string;
  email: string;
  username: string;
  createdAt: Date;
  lastLogin?: Date | null;
  authProvider?: string | null;
  authProviderId?: string | null;
  isVerified: boolean;
  metadata?: Record<string, any> | null;
}

export interface CreateUserRequest {
  email: string;
  username: string;
  authProvider?: string;
  authProviderId?: string;
  metadata?: Record<string, any>;
}

export interface UpdateUserRequest {
  email?: string;
  username?: string;
  lastLogin?: Date;
  isVerified?: boolean;
  metadata?: Record<string, any>;
}

export interface AuthTokenRecord {
  id: string;
  userId: string;
  tokenHash: string;
  expiresAt: Date;
  type: 'password_reset' | 'email_verify' | 'session';
}

export interface UserQueryFilters {
  email?: string;
  username?: string;
  createdAfter?: Date;
  createdBefore?: Date;
}

export interface PaginationOptions {
  page: number;
  limit: number;
  sortBy?: 'created_at' | 'last_login' | 'email' | 'username';
  sortOrder?: 'asc' | 'desc';
}

export interface PaginatedUsersResponse {
  users: UserRecord[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface UserServiceError {
  code: string;
  message: string;
  details?: Record<string, any>;
}
