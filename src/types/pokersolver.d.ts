declare module 'pokersolver' {
  export interface Card {
    value: string;
    suit: string;
    rank: number;
  }

  export class Hand {
    static solve(cards: string[]): Hand;
    cards: Card[];
    name: string;
    rank: number;
    winner(others: Hand[]): boolean;
  }
}
