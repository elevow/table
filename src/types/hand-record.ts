import type { Card, GameVariant, HandActionEntry } from './poker';

export interface HandRecordCards {
  // Hold'em / Omaha
  hole?: Card[];
  // Stud
  down?: Card[];
  up?: Card[];
}

export interface HandRecordPlayer {
  id: string;
  name: string;
  seat: number;
  startStack: number;
  endStack: number;
  net: number;
  won: number;
  folded: boolean;
  // Omitted for other viewers unless the cards were shown at the table
  cards?: HandRecordCards;
  revealed: boolean;
}

export interface HandRecord {
  id: string;
  roomId: string;
  handNumber: number;
  variant?: GameVariant | string;
  kind?: 'normal' | 'bomb-pot';
  smallBlind: number;
  bigBlind: number;
  startedAt: string | null;
  endedAt: string;
  board: Card[];
  // Each run's full board when the hand was run more than once
  runBoards?: Card[][];
  players: HandRecordPlayer[];
  actions: HandActionEntry[];
  winners: Array<{ playerId: string; amount: number }>;
  pot: number;
  // Betting structure and the dealer button's seat, for hand-history export; missing on older hands
  bettingMode?: 'no-limit' | 'pot-limit';
  buttonSeat?: number;
}

/** A row in a list of hands, from the viewer's point of view. */
export interface HandSummary {
  id: string;
  roomId: string;
  handNumber: number;
  variant?: string;
  endedAt: string;
  pot: number;
  bigBlind: number;
  winners: Array<{ playerId: string; name: string; amount: number }>;
  myNet: number;
  myCards?: HandRecordCards;
}
