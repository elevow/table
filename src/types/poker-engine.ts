export interface HandInterface {
  rank: number;
  description: string;
  cards: Array<{
    value: string;
    suit: string;
  }>;
}

export interface PlayerAction {
  type: 'bet' | 'call' | 'raise' | 'fold' | 'check';
  playerId: string;
  amount?: number;
}

export interface HandResult {
  playerId: string;
  hand: Card[];
  description: string;
  strength: number;
  winAmount: number;
}

export interface Card {
  suit: 'hearts' | 'diamonds' | 'clubs' | 'spades';
  rank: '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | '10' | 'J' | 'Q' | 'K' | 'A';
}
