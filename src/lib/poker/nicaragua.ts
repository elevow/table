import type { Card, NicaraguaMethod } from '../../types/poker';
import { HandEvaluator } from './hand-evaluator';
import { evaluateWildHigh } from './wild-hands';

/**
 * Nicaragua's ways to win, each scored so that a higher score wins and equal scores split. Safe to
 * import from client code.
 * - Highest hand: ordinary poker ranking.
 * - Lowest hand: ace-to-five, as in Razz (aces low, straights and flushes don't count).
 * - Highest or lowest count: the cards added up, picture cards 10, aces 11 for the highest count
 *   and 1 for the lowest (an ace counts whichever way helps).
 */

const COUNT: Record<Card['rank'], number> = {
  '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9, '10': 10, 'J': 10, 'Q': 10, 'K': 10, 'A': 1,
};

const valid = (cards: Card[] | undefined) => (cards || []).filter(c => c && c.rank && c.suit);

/** The cards added up for this method: aces count 11 for the highest count, 1 for the lowest. */
export function nicaraguaCount(cards: Card[], method: NicaraguaMethod): number {
  return valid(cards).reduce((sum, c) => sum + (c.rank === 'A' && method === 'high-count' ? 11 : COUNT[c.rank]), 0);
}

const noWilds = () => false;

/** A hand's score under the opener's method: higher wins. */
export function nicaraguaScore(cards: Card[], method: NicaraguaMethod): number {
  const hand = valid(cards);
  switch (method) {
    case 'low': return HandEvaluator.razzStrength(hand);
    case 'high-count': return nicaraguaCount(hand, method);
    case 'low-count': return 1000 - nicaraguaCount(hand, method);
    default: return evaluateWildHigh(hand, noWilds).score;
  }
}

/** What a hand is under the opener's method, e.g. "Count of 27" or "7-5-4-3-A Low". */
export function describeNicaraguaHand(cards: Card[], method: NicaraguaMethod): string {
  const hand = valid(cards);
  switch (method) {
    case 'low': return HandEvaluator.evaluateRazzLow(hand).description;
    case 'high-count':
    case 'low-count': return `Count of ${nicaraguaCount(hand, method)}`;
    default: return evaluateWildHigh(hand, noWilds).name;
  }
}
