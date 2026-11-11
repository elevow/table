import type { Card } from '../../types/poker';

/**
 * High and Low Chicago: seven-card stud where the highest (High Chicago) or lowest (Low Chicago)
 * spade in the hole wins half the pot. Aces are high, so in Low Chicago the 2 of spades is the
 * best spade. Safe to import from client code.
 */

const WEIGHT: Record<Card['rank'], number> = {
  '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9, '10': 10, 'J': 11, 'Q': 12, 'K': 13, 'A': 14,
};

export function isChicagoVariant(variant?: string | null): boolean {
  return variant === 'high-chicago' || variant === 'low-chicago';
}

/** The player's spade in the hole that counts for Chicago, if they have one. */
export function chicagoSpade(downCards: Card[] | undefined, variant?: string | null): Card | undefined {
  const spades = (downCards || []).filter(c => c && c.suit === 'spades');
  if (spades.length === 0) return undefined;
  const low = variant === 'low-chicago';
  return spades.reduce((best, c) => ((low ? WEIGHT[c.rank] < WEIGHT[best.rank] : WEIGHT[c.rank] > WEIGHT[best.rank]) ? c : best));
}

/** How good a Chicago spade is: higher wins; 0 for none. */
export function chicagoSpadeScore(downCards: Card[] | undefined, variant?: string | null): number {
  const spade = chicagoSpade(downCards, variant);
  if (!spade) return 0;
  return variant === 'low-chicago' ? 15 - WEIGHT[spade.rank] : WEIGHT[spade.rank];
}
