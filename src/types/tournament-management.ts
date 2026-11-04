import type { TournamentConfig, BlindLevel } from './tournament';

export type TournamentStatus = 'setup' | 'running' | 'paused' | 'on-break' | 'completed' | 'cancelled';

export interface TournamentTable {
  id: string;
  roomId?: string; // the game room where this table plays, once it has one
  number: number; // Table 1, Table 2, ... for display; numbers of broken tables aren't reused
  maxSeats: number;
  seats: (string | null)[]; // seats[i] is seat i + 1: the user ID sitting there, or null when empty
}

/**
 * Hand for hand, on the bubble (src/lib/tournament/tournament-manager.ts): each table plays one hand
 * of a round, then waits until every table has finished its hand before the next round is dealt.
 */
export interface HandForHand {
  round: number; // 1 for the first round on this bubble
  // Tables that have dealt their hand of the round, with the number of the hand each had just
  // finished when it did (the round's hand is over once the table reports a later one)
  dealtAfter: Record<string, number>;
  finished: string[]; // tables whose hand of the round is over
  // Players who busted this round, eliminated together when it ends, the smallest starting stack
  // (at any table) finishing lowest
  busts: { userId: string; eliminatedBy?: string; startStack: number }[];
}

/** A player moved to another table when the tables were balanced or one was broken. */
export interface TableMove {
  at: number; // epoch ms
  userId: string;
  fromTableId: string;
  toTableId: string;
  seat: number; // seat number at the new table
  reason: 'balance' | 'break';
}

export interface TournamentState {
  id: string;
  name: string;
  config: TournamentConfig;
  status: TournamentStatus;
  createdBy?: string | null; // user who created it; null for tournaments made outside the API
  // Private tournaments (src/lib/tournament/tournament-privacy.ts); unset means public
  visibility?: 'public' | 'private';
  inviteCode?: string; // stored without the dash
  members?: string[]; // users who joined through the invite link
  createdAt: number; // epoch ms
  updatedAt: number; // epoch ms
  registeredPlayers: string[];
  eliminatedPlayers: string[]; // in elimination order
  rebuysClosedAt?: number | null; // epoch ms the director closed rebuys ahead of their last level
  tables: TournamentTable[]; // drawn at the start; empty before it
  tableMoves?: TableMove[];
  currentLevelIndex: number; // index into config.blindLevels
  // Level clock (src/lib/tournament/tournament-clock.ts)
  currentLevelStartedAt: number | null; // epoch ms the current stretch of the level began; null while paused or on a break
  levelElapsedMs?: number; // level time played before currentLevelStartedAt
  onBreak: boolean;
  breakEndsAt: number | null; // epoch ms; null while the break is paused
  breakRemainingMs?: number | null; // break time left while paused during a break
  pausedFrom?: 'running' | 'on-break' | null; // what resuming returns to
  currentBreakAfterLevel?: number | null; // which level's break we are currently on
  // Reporting fields
  registrationTimeline?: { at: number; type: 'register' | 'rebuy' | 'addOn' | 'reentry'; userId?: string }[];
  eliminationRecords?: {
    userId: string;
    at: number;
    place: number;
    eliminatedBy?: string;
    bounty?: number;
    removed?: boolean; // taken out by the director rather than knocked out
    forfeitedBounty?: number; // a removed player's bounty, which nobody won
  }[];
  // Knockouts (src/lib/tournament/tournament-money.ts)
  bounties?: Record<string, number>; // bounty on each player still in
  bountyWinnings?: Record<string, number>; // bounty cash each player has won
  // Chips (src/lib/tournament/table-rooms.ts): each player's stack as last reported by their table,
  // and chips they've bought (starting stack, late entry, rebuy, add-on) that haven't reached a table yet
  chips?: Record<string, number>;
  pendingChips?: Record<string, number>;
  handForHand?: HandForHand | null;
  cancelledAt?: number;
  cancelReason?: string | null;
  // The tournament just before the latest elimination, while nothing else has changed since; undo restores it
  lastElimination?: { before: TournamentState };
}

export interface CreateTournamentInput {
  name: string;
  config: TournamentConfig;
  createdBy?: string | null;
  visibility?: 'public' | 'private';
}

export interface RegisterPlayerInput {
  tournamentId: string;
  userId: string;
}

export interface EliminatePlayerInput {
  tournamentId: string;
  userId: string;
  eliminatedBy?: string; // who knocked them out; required when the tournament has bounties
}

export interface RebuyInput {
  tournamentId: string;
  userId: string;
}

export interface AddOnInput {
  tournamentId: string;
  userId: string;
}
