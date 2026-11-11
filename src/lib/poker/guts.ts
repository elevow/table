import type { Card } from '../../types/poker';

/**
 * Guts hands: two cards, so only pairs and high cards count (no straights or flushes). A pair
 * beats any two different cards; otherwise the higher card, then the other. Aces are high.
 * Safe to import from client code.
 */

const WEIGHT: Record<Card['rank'], number> = {
  '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9, '10': 10, 'J': 11, 'Q': 12, 'K': 13, 'A': 14,
};
const NAME: Record<number, string> = {
  2: 'Two', 3: 'Three', 4: 'Four', 5: 'Five', 6: 'Six', 7: 'Seven', 8: 'Eight', 9: 'Nine', 10: 'Ten', 11: 'Jack', 12: 'Queen', 13: 'King', 14: 'Ace',
};
const plural = (v: number) => (v === 6 ? 'Sixes' : `${NAME[v]}s`);

// Losers pay the size of the pot, up to this many big blinds unless the host sets another cap
export const DEFAULT_GUTS_CAP_BB = 10;

export function isGutsVariant(variant?: string | null): boolean {
  return variant === 'guts';
}

const values = (cards: Card[]) =>
  (cards || []).filter(c => c && c.rank).slice(0, 2).map(c => WEIGHT[c.rank]).sort((a, b) => b - a);

/** A two-card hand's score: higher wins, equal scores split. */
export function gutsScore(cards: Card[]): number {
  const [hi = 0, lo = 0] = values(cards);
  return hi === lo ? 1000 + hi : hi * 15 + lo;
}

/** "Pair of Kings" or "Ace-Ten". */
export function describeGutsHand(cards: Card[]): string {
  const [hi = 0, lo = 0] = values(cards);
  if (!hi) return '';
  return hi === lo ? `Pair of ${plural(hi)}` : `${NAME[hi]}-${NAME[lo]}`;
}
