// US-019: Friend Relationships - Types

export type FriendStatus = 'pending' | 'accepted' | 'declined';

export interface FriendRelationshipRecord {
  id: string;
  userId: string; // requester
  friendId: string; // recipient
  status: FriendStatus;
  createdAt: Date;
  updatedAt: Date;
}

export interface FriendRequestInput {
  requesterId: string;
  recipientId: string;
}

export interface BlockRecord {
  id: string;
  userId: string;
  blockedId: string;
  reason?: string | null;
  createdAt: Date;
}

export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

// US-064: Friend System — Invites and head-to-head
export type InviteStatus = 'pending' | 'accepted' | 'declined' | 'canceled';

export interface FriendInviteRecord {
  id: string;
  inviterId: string;
  inviteeId: string;
  roomId: string; // game_rooms.id
  status: InviteStatus;
  createdAt: Date;
  respondedAt?: Date | null;
}

export interface FriendRelationshipStatus {
  status: FriendStatus | 'none';
  direction?: 'outgoing' | 'incoming' | null; // when pending
}

export interface HeadToHeadSummary {
  gamesPlayed: number;
  lastPlayed: Date | null;
}
