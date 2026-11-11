import type { Card } from '../../types/poker';

/**
 * Badugi hands. From four cards, the hand is the largest set with no two cards of the same suit
 * or rank; more cards beat fewer, and between hands of the same size the lower one wins, compared
 * from the highest card down. Aces are low. A four-card hand is a badugi; A-2-3-4 of four suits is
 * the best. Safe to import from client code.
 */

const LOW: Record<Card['rank'], number> = {
  'A': 1, '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9, '10': 10, 'J': 11, 'Q': 12, 'K': 13,
};
const NAME: Record<number, string> = { 1: 'A', 11: 'J', 12: 'Q', 13: 'K' };

export interface BadugiHand {
  cards: Card[];
  // Card values, highest first (aces 1)
  ranks: number[];
  // Higher wins; equal scores tie
  score: number;
  description: string;
}

export function isBadugiVariant(variant?: string | null): boolean {
  return variant === 'badugi';
}

const scoreOf = (ranks: number[]) =>
  ranks.length * 1e6 + ranks.reduce((sum, r, i) => sum + (15 - r) * 15 ** (3 - i), 0);

/** The best badugi hand these cards make. */
export function evaluateBadugi(cards: Card[]): BadugiHand {
  const hand = (cards || []).filter(c => c && c.rank && c.suit).slice(0, 4);
  let best: BadugiHand = { cards: [], ranks: [], score: 0, description: 'No hand' };
  for (let mask = 1; mask < 1 << hand.length; mask++) {
    const pick = hand.filter((_, i) => mask & (1 << i));
    if (new Set(pick.map(c => c.suit)).size !== pick.length) continue;
    if (new Set(pick.map(c => c.rank)).size !== pick.length) continue;
    const ranks = pick.map(c => LOW[c.rank]).sort((a, b) => b - a);
    const score = scoreOf(ranks);
    if (score > best.score) {
      const text = ranks.map(r => NAME[r] || String(r)).join('-');
      best = { cards: pick, ranks, score, description: ranks.length === 4 ? `Badugi ${text}` : `${ranks.length}-card ${text}` };
    }
  }
  return best;
}
