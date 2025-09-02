import type { TournamentConfig, BlindLevel } from './tournament';

export type TournamentStatus = 'setup' | 'running' | 'paused' | 'on-break' | 'completed' | 'cancelled';

export interface TournamentTable {
  id: string;
  players: string[]; // user IDs seated at this table
  maxSeats: number;
}

export interface TournamentState {
  id: string;
  name: string;
  config: TournamentConfig;
  status: TournamentStatus;
  createdAt: number; // epoch ms
  updatedAt: number; // epoch ms
  registeredPlayers: string[];
  eliminatedPlayers: string[]; // in elimination order
  tables: TournamentTable[];
  currentLevelIndex: number; // index into config.blindLevels
  currentLevelStartedAt: number | null; // epoch ms
  onBreak: boolean;
  breakEndsAt: number | null;
  currentBreakAfterLevel?: number | null; // which level's break we are currently on
  // Reporting fields
  registrationTimeline?: { at: number; type: 'register' | 'rebuy' | 'addOn'; userId?: string }[];
  eliminationRecords?: { userId: string; at: number; place: number }[];
}

export interface CreateTournamentInput {
  name: string;
  config: TournamentConfig;
}

export interface RegisterPlayerInput {
  tournamentId: string;
  userId: string;
}

export interface EliminatePlayerInput {
  tournamentId: string;
  userId: string;
}

export interface RebuyInput {
  tournamentId: string;
  userId: string;
}

export interface AddOnInput {
  tournamentId: string;
  userId: string;
}
