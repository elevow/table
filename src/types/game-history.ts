// US-010: Game History Recording - Type Definitions

export interface GameHistoryRecord {
  id: string;
  tableId: string;
  handId: string;
  actionSequence: GameAction[];
  communityCards: string[];
  results: GameResults;
  startedAt: Date;
  endedAt: Date;
}

export interface GameAction {
  playerId: string;
  action: 'fold' | 'check' | 'call' | 'bet' | 'raise' | 'all-in';
  amount?: number;
  timestamp: Date;
  position: number;
  holeCards?: string[];
}

export interface GameResults {
  winners: PlayerResult[];
  pot: PotDistribution[];
  totalPot: number;
  rake: number;
  handType?: string;
}

export interface PlayerResult {
  playerId: string;
  position: number;
  holeCards: string[];
  bestHand: string[];
  handRank: string;
  winAmount: number;
  showedCards: boolean;
}

export interface PotDistribution {
  type: 'main' | 'side';
  amount: number;
  eligiblePlayers: string[];
  winner: string;
}

export interface CreateGameHistoryRequest {
  tableId: string;
  handId: string;
  actionSequence: GameAction[];
  communityCards: string[];
  results: GameResults;
  startedAt: Date;
  endedAt: Date;
}

export interface GameHistoryQueryOptions {
  tableId?: string;
  playerId?: string;
  handId?: string;
  dateFrom?: Date;
  dateTo?: Date;
  limit?: number;
  offset?: number;
  includeActions?: boolean;
  includeResults?: boolean;
}

export interface GameHistoryFilters {
  minPot?: number;
  maxPot?: number;
  handTypes?: string[];
  playerCount?: number;
  duration?: {
    min?: number;
    max?: number;
  };
}

export interface PaginatedGameHistoryResponse {
  records: GameHistoryRecord[];
  total: number;
  hasMore: boolean;
  nextOffset?: number;
}

export interface GameAnalytics {
  totalHands: number;
  totalPot: number;
  averagePot: number;
  averageHandDuration: number;
  mostFrequentAction: string;
  playerStats: Map<string, PlayerGameStats>;
}

export interface PlayerGameStats {
  handsPlayed: number;
  totalWinnings: number;
  averageWinnings: number;
  vpip: number; // Voluntarily Put money In Pot
  pfr: number;  // Pre-Flop Raise
  showdownWinRate: number;
}

export interface GameHistoryError extends Error {
  code: string;
  details?: Record<string, any>;
}

// Database row type for mapping
export interface GameHistoryRow {
  id: string;
  table_id: string;
  hand_id: string;
  action_sequence: string; // JSON string
  community_cards: string[];
  results: string; // JSON string
  started_at: Date;
  ended_at: Date;
  created_at: Date;
}

export interface PlayerActionRow {
  id: string;
  game_id: string;
  player_id: string;
  action: string;
  amount: number;
  timestamp: Date;
  position: number;
  created_at: Date;
}

// US-021: Run It Twice outcomes
export interface RunItTwiceOutcomeInput {
  handId: string;
  boardNumber: number; // 1 or 2 typically
  communityCards: string[]; // 5 cards when fully revealed
  winners: any; // structure holding winners and amounts for this board
  potAmount: number;
}

export interface RunItTwiceOutcomeRecord {
  id: string;
  handId: string;
  boardNumber: number;
  communityCards: string[];
  winners: any;
  potAmount: number;
}

export interface RunItTwiceOutcomeRow {
  id: string;
  hand_id: string;
  board_number: number;
  community_cards: string[];
  winners: string; // JSON string
  pot_amount: string | number; // may come back as string from DB numeric
}

// US-021: hand_history row shape
export interface HandHistoryRow {
  id: string;
  game_id: string;
  hand_number: number;
  community_cards: string[];
  player_cards: string; // JSON string
  actions: string; // JSON string array
  started_at: Date;
  ended_at: Date | null;
  winners: string; // JSON string
  pot_distribution: string; // JSON string
}
