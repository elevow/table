export interface Card {
  suit: 'hearts' | 'diamonds' | 'clubs' | 'spades';
  rank: '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | '10' | 'J' | 'Q' | 'K' | 'A';
}

export interface Player {
  id: string;
  name: string;
  stack: number;
  position: number;
  holeCards?: Card[];
  currentBet: number;
  isActive: boolean;
  isFolded: boolean;
  isAllIn: boolean;
  timeBank: number;
}

export interface GameState {
  tableId: string;
  stage: 'preflop' | 'flop' | 'turn' | 'river' | 'showdown';
  players: Player[];
  activePlayer: string;
  pot: number;
  communityCards: Card[];
  currentBet: number;
  lastAction?: PlayerAction;
  dealerPosition: number;
}

export interface PlayerAction {
  type: 'bet' | 'call' | 'raise' | 'fold';
  playerId: string;
  amount?: number;
  timestamp: number;
}

export interface HandResult {
  playerId: string;
  hand: Card[];
  rank: number;
  description: string;
  winningAmount: number;
}
