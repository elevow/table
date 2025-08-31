export type RoomStatus = 'waiting' | 'active' | 'closed';

export interface GameRoomRecord {
  id: string;
  name: string;
  gameType: string;
  maxPlayers: number;
  blindLevels: any;
  createdBy: string;
  createdAt: Date;
  status: RoomStatus;
  configuration: any | null;
}

export interface ActiveGameRecord {
  id: string;
  roomId: string;
  currentHandId: string | null;
  dealerPosition: number;
  currentPlayerPosition: number;
  pot: number;
  state: any | null;
  lastActionAt: Date;
}

export interface CreateRoomInput {
  name: string;
  gameType: string;
  maxPlayers: number;
  blindLevels: any;
  createdBy: string;
  configuration?: any;
}

export interface StartGameInput {
  roomId: string;
  dealerPosition: number;
  currentPlayerPosition: number;
  currentHandId?: string | null;
  pot?: number;
  state?: any;
}

export interface UpdateActiveGameInput {
  id: string;
  currentHandId?: string | null;
  dealerPosition?: number;
  currentPlayerPosition?: number;
  pot?: number;
  state?: any;
}

export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

// Note: Some service/manager methods may accept an optional callerUserId to run under RLS.
