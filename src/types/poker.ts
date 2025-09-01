export type GameStage = 'preflop' | 'flop' | 'turn' | 'river' | 'showdown';

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
  // Betting mode for the table: 'no-limit' (default) or 'pot-limit'
  bettingMode?: 'no-limit' | 'pot-limit';
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
  type: 'bet' | 'call' | 'raise' | 'fold';
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
