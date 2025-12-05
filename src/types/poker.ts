// Extended to support Seven-card Stud streets (US-053)
export type GameStage =
  | 'preflop' | 'flop' | 'turn' | 'river' | 'showdown' // Hold'em/Omaha
  | 'third' | 'fourth' | 'fifth' | 'sixth' | 'seventh' // Seven-card Stud
  | 'awaiting-dealer-choice'; // Dealer's Choice pre-hand pause

// Game variant type - shared across TableState and PokerEngine
export type GameVariant = 'texas-holdem' | 'omaha' | 'omaha-hi-lo' | 'seven-card-stud' | 'seven-card-stud-hi-lo' | 'five-card-stud';

export interface Card {
  suit: 'hearts' | 'diamonds' | 'clubs' | 'spades';
  rank: '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | '10' | 'J' | 'Q' | 'K' | 'A';
}

export type GameAction = {
  type: 'initialize' | 'join' | 'leave' | 'start' | 'deal' | 'bet' | 'call' | 'raise' | 'fold' | 'timeout' | 'error';
  playerId?: string;
  tableId: string;
  amount?: number;
  timestamp: number;
  metadata?: any;
}

export interface Player {
  id: string;
  name: string;
  position: number;
  stack: number;
  holeCards?: Card[];
  currentBet: number;
  hasActed: boolean;
  isFolded: boolean;
  isAllIn: boolean;
  timeBank: number;
}

export interface TableState {
  tableId: string;
  stage: GameStage;
  players: Player[];
  activePlayer: string;
  pot: number;
  communityCards: Card[];
  currentBet: number;
  dealerPosition: number;
  smallBlind: number;
  bigBlind: number;
  minRaise: number;
  lastRaise: number;
  // Optional game variant; when set to 'omaha' or 'omaha-hi-lo', rules and dealing are adapted accordingly
  variant?: GameVariant;
  // Betting mode for the table: 'no-limit' (default) or 'pot-limit'
  bettingMode?: 'no-limit' | 'pot-limit';
  // Policy: when true, Run It Twice requires unanimous consent from all active players
  requireRunItTwiceUnanimous?: boolean;
  // US-029: Run It Twice state (set only when enabled)
  runItTwice?: RunItTwice;
  // RIT prompt metadata when waiting on a specific player to decide
  runItTwicePrompt?: RunItTwicePrompt | null;
  // When true, the prompt for the current hand has been resolved and should not reappear
  runItTwicePromptDisabled?: boolean;
  // US-052/US-054: Hi-Lo last showdown results (optional, present for omaha-hi-lo or seven-card-stud-hi-lo)
  lastHiLoResult?: {
    high: Array<{ playerId: string; amount: number }>;
    low: Array<{ playerId: string; amount: number }> | null;
  };
  // US-052/US-054: Optional player declarations for Hi-Lo variants
  hiLoDeclarations?: Record<string, 'high' | 'low' | 'both'>;
  // US-052/US-054: Low hand qualifier value (defaults to 8 for Hi-Lo variants)
  lowHandQualifier?: 8;
  // US-053: Seven-card Stud per-player cards and bring-in tracking
  studState?: {
    playerCards: Record<string, { downCards: Card[]; upCards: Card[] }>;
    bringIn?: { amount: number; player: string };
  };
}

export interface BettingRound {
  stage: GameStage;
  startPosition: number;
  activePosition: number;
  minBet: number;
  currentBet: number;
  lastRaise: number;
}

export interface PlayerAction {
  type: 'bet' | 'call' | 'raise' | 'fold' | 'check';
  playerId: string;
  tableId: string;
  amount?: number;
  timestamp: number;
}

export interface HandResult {
  playerId: string;
  hand: Card[];
  description: string;
  strength: number;
  winAmount: number;
}

// US-026: Hand Rankings types
export enum HandRank {
  HighCard = 1,
  OnePair = 2,
  TwoPair = 3,
  ThreeOfAKind = 4,
  Straight = 5,
  Flush = 6,
  FullHouse = 7,
  FourOfAKind = 8,
  StraightFlush = 9,
  RoyalFlush = 10
}

export interface HandRanking {
  rank: number; // numeric rank (1-10) aligned with HandRank
  name: string; // e.g., "Full House"
  cards: Card[]; // best 5 cards forming the hand
  kickers: Card[]; // tie-breakers in order (if applicable)
  strength: number; // same as rank for now; reserved for extended scoring
}

// US-029: Run It Twice types
export interface PotSplit {
  playerId: string;
  amount: number;
}

export interface RunResult {
  boardId: string;
  winners: Array<{
    playerId: string;
    winningHand: HandRanking;
    potShare: number;
  }>;
}

export interface RunItTwice {
  enabled: boolean;
  numberOfRuns: number; // 2-4
  boards: Card[][]; // Full community boards per run
  results: RunResult[];
  potDistribution: PotSplit[]; // aggregated distribution across runs
  seeds: string[]; // RNG seeds (opaque strings)
  // US-030: RNG Security metadata for audit/verification
  rngSecurity?: {
    seedGeneration: {
      entropy: any; // stored opaque; not serialized to clients
      timestamp: number;
      playerEntropy: string;
      vrf: string;
    };
    verification: {
      publicSeed: string;
      hashChain: string[];
      proof: string; // may be withheld from clients; used server-side for verification
    };
  };
}

export interface RunItTwicePrompt {
  playerId: string; // the player who must make the decision
  reason: 'lowest-hand';
  createdAt: number; // epoch ms when prompt issued
  boardCardsCount: number; // number of community cards visible at prompt time
  handDescription?: string; // textual summary of their current best hand
  highestHandDescription?: string; // textual summary of the highest hand among eligible players
  handDescriptionsByPlayer?: Record<string, string>; // per-player best-hand description for eligible players
  eligiblePlayerIds: string[]; // players considered when determining lowest hand
  tiedWith?: string[]; // other players with identical strength when tie-breaking randomly
}

// US-032: Disconnection handling
export interface DisconnectionState {
  playerId: string;
  graceTime: number; // in ms
  autoAction: {
    type: 'fold' | 'check-fold';
    executeAt: Date;
  };
  preservedStack: number;
  position: number;
  reconnectBy: Date;
}
