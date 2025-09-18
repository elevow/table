// US-018: Avatar Management - Types

export type AvatarStatus = 'active' | 'archived';

export interface AvatarRecord {
  id: string;
  userId: string;
  status: AvatarStatus;
  originalUrl: string;
  variants: Record<string, string>; // size -> url
  version: number;
  createdAt: Date;
}

export interface AvatarVersionRecord {
  id: string;
  avatarId: string;
  version: number;
  url: string;
  createdAt: Date;
}

export interface CreateAvatarRequest {
  userId: string;
  originalUrl: string;
  variants: Record<string, string>;
}

export interface UpdateAvatarRequest {
  status?: AvatarStatus;
  variants?: Record<string, string>;
}

export interface AvatarQueryFilters {
  userId?: string;
  status?: AvatarStatus;
}

export interface PaginatedAvatarsResponse {
  avatars: AvatarRecord[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface AvatarServiceError {
  code: string;
  message: string;
  details?: Record<string, any>;
}
