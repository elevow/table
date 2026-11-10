import { HandRank } from '../../types/poker';
import type { Card, HandRanking, WildRule } from '../../types/poker';
import { HandEvaluator } from './hand-evaluator';

/**
 * Hand evaluation with wild cards. A wild card counts as whatever makes the hand best, so five of
 * a kind is possible and is the top hand. Safe to import from client code.
 */

export type WildMatcher = (card: Card) => boolean;

/** Which cards a table's wild rule makes wild; null when nothing is wild. */
export function wildMatcher(rule?: WildRule): WildMatcher | null {
  if (rule === 'deuces') return card => card.rank === '2';
  if (rule === 'one-eyed-jacks') return card => card.rank === 'J' && (card.suit === 'spades' || card.suit === 'hearts');
  return null;
}

/** A best hand; higher scores win and equal scores tie. */
export interface WildHand extends HandRanking {
  score: number;
}

const HIGH_VALUE: Record<Card['rank'], number> = {
  '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9, '10': 10, 'J': 11, 'Q': 12, 'K': 13, 'A': 14,
};
const LOW_RANKS: Card['rank'][] = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];

const ONE: Record<number, string> = {
  1: 'Ace', 2: 'Two', 3: 'Three', 4: 'Four', 5: 'Five', 6: 'Six', 7: 'Seven', 8: 'Eight', 9: 'Nine', 10: 'Ten', 11: 'Jack', 12: 'Queen', 13: 'King', 14: 'Ace',
};
const plural = (rank: number) => (rank === 6 ? 'Sixes' : `${ONE[rank]}s`);

interface Classified {
  category: HandRank;
  // Card values in the order hands of this category compare
  values: number[];
}

/** The top card of the straight these five values make; 0 if they make none. */
function straightTop(values: number[]): number {
  if (values.length !== 5 || new Set(values).size !== 5) return 0;
  const sorted = [...values].sort((a, b) => b - a);
  if (sorted[0] === 14 && sorted[1] === 5 && sorted[4] === 2) return 5; // A-2-3-4-5
  return sorted[0] - sorted[4] === 4 ? sorted[0] : 0;
}

/** Classify card values, with wild cards already standing in as specific ranks. */
function classify(values: number[], canFlush: boolean): Classified {
  const counts = new Map<number, number>();
  values.forEach(v => counts.set(v, (counts.get(v) || 0) + 1));
  const groups = [...counts.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0]);
  const byGroup = groups.flatMap(([rank, count]) => Array<number>(count).fill(rank));
  const top = groups[0]?.[1] || 0;
  const second = groups[1]?.[1] || 0;
  const flush = canFlush && values.length === 5;
  const high = straightTop(values);
  const straightValues = high === 5 ? [5, 4, 3, 2, 1] : [high, high - 1, high - 2, high - 3, high - 4];

  if (top === 5) return { category: HandRank.FiveOfAKind, values: byGroup };
  if (flush && high) return { category: high === 14 ? HandRank.RoyalFlush : HandRank.StraightFlush, values: straightValues };
  if (top === 4) return { category: HandRank.FourOfAKind, values: byGroup };
  if (top === 3 && second === 2) return { category: HandRank.FullHouse, values: byGroup };
  if (flush) return { category: HandRank.Flush, values: [...values].sort((a, b) => b - a) };
  if (high) return { category: HandRank.Straight, values: straightValues };
  if (top === 3) return { category: HandRank.ThreeOfAKind, values: byGroup };
  if (top === 2 && second === 2) return { category: HandRank.TwoPair, values: byGroup };
  if (top === 2) return { category: HandRank.OnePair, values: byGroup };
  return { category: HandRank.HighCard, values: byGroup };
}

// The same packing the engine uses for hands without wild cards
function scoreOf({ category, values }: Classified): number {
  const [v0 = 0, v1 = 0, v2 = 0, v3 = 0, v4 = 0] = values;
  return category * 1e10 + v0 * 1e8 + v1 * 1e6 + v2 * 1e4 + v3 * 1e2 + v4;
}

function describe({ category, values }: Classified): string {
  const [first, ...rest] = values;
  switch (category) {
    case HandRank.FiveOfAKind: return `Five of a Kind, ${plural(first)}`;
    case HandRank.RoyalFlush: return 'Royal Flush';
    case HandRank.StraightFlush: return `Straight Flush, ${ONE[first]} High`;
    case HandRank.FourOfAKind: return `Four of a Kind, ${plural(first)}`;
    case HandRank.FullHouse: return `Full House, ${plural(first)} over ${plural(values[3])}`;
    case HandRank.Flush: return `Flush, ${ONE[first]} High`;
    case HandRank.Straight: return `Straight, ${ONE[first]} High`;
    case HandRank.ThreeOfAKind: return `Three of a Kind, ${plural(first)}`;
    case HandRank.TwoPair: return `Two Pair, ${plural(first)} and ${plural(rest[1])}`;
    case HandRank.OnePair: return `Pair of ${plural(first)}`;
    default: return first ? `${ONE[first]} High` : 'High Card';
  }
}

/** The best a set of up to five cards can be, trying every rank each wild card could stand for. */
function bestClassification(cards: Card[], isWild: WildMatcher): Classified {
  const natural = cards.filter(c => !isWild(c));
  const wilds = cards.length - natural.length;
  const canFlush = new Set(natural.map(c => c.suit)).size <= 1;
  const values = natural.map(c => HIGH_VALUE[c.rank]);

  let best = classify(values, canFlush);
  let bestScore = -1;
  const assign = (left: number, from: number) => {
    if (left === 0) {
      const candidate = classify(values, canFlush);
      const score = scoreOf(candidate);
      if (score > bestScore) { best = candidate; bestScore = score; }
      return;
    }
    // Wild cards are interchangeable, so only non-decreasing assignments need trying
    for (let rank = from; rank <= 14; rank++) {
      values.push(rank);
      assign(left - 1, rank);
      values.pop();
    }
  };
  assign(wilds, 2);
  return best;
}

function bestHigh(fives: Card[][], isWild: WildMatcher, all: Card[]): WildHand {
  let bestCards: Card[] = [];
  let best: Classified = { category: HandRank.HighCard, values: [] };
  let bestScore = -1;
  for (const five of fives) {
    const candidate = bestClassification(five, isWild);
    const score = scoreOf(candidate);
    if (score > bestScore) { best = candidate; bestCards = five; bestScore = score; }
  }
  const used = new Set(bestCards);
  return {
    rank: best.category,
    name: describe(best),
    cards: bestCards,
    kickers: all.filter(c => !used.has(c)),
    strength: best.category,
    score: bestScore,
  };
}

const validCards = (cards: Card[] | undefined) => (cards || []).filter(c => c && c.rank && c.suit);
const fivesFrom = (cards: Card[]) => (cards.length <= 5 ? [cards] : HandEvaluator.combinations(cards, 5));

/** Every hand Omaha allows: exactly two hole cards and three from the board. */
function omahaFives(hole: Card[], board: Card[]): Card[][] {
  const fives: Card[][] = [];
  for (const pair of HandEvaluator.combinations(hole, 2)) {
    for (const three of HandEvaluator.combinations(board, 3)) fives.push([...pair, ...three]);
  }
  return fives;
}

/** The best high hand from any number of cards. */
export function evaluateWildHigh(cards: Card[], isWild: WildMatcher): WildHand {
  const valid = validCards(cards);
  return bestHigh(fivesFrom(valid), isWild, valid);
}

/** The best high hand under Omaha's two-from-hand, three-from-board rule. */
export function evaluateWildOmaha(hole: Card[], board: Card[], isWild: WildMatcher): WildHand {
  const fives = omahaFives(validCards(hole), validCards(board));
  const all = [...validCards(hole), ...validCards(board)];
  return fives.length > 0 ? bestHigh(fives, isWild, all) : evaluateWildHigh(all, isWild);
}

/** Replace each wild card with the lowest rank these cards don't already hold, which is its best low. */
function fillLowWilds(cards: Card[], isWild: WildMatcher): Card[] {
  const taken = new Set(cards.filter(c => !isWild(c)).map(c => c.rank));
  return cards.map(card => {
    if (!isWild(card)) return card;
    const rank = LOW_RANKS.find(r => !taken.has(r)) as Card['rank'];
    taken.add(rank);
    return { ...card, rank };
  });
}

function bestEightOrBetter(fives: Card[][], isWild: WildMatcher): { lowCards: Card[]; ranks: number[] } | null {
  let best: { lowCards: Card[]; ranks: number[] } | null = null;
  for (const five of fives) {
    if (five.length !== 5) continue;
    const low = HandEvaluator.evaluateAceToFiveLow(fillLowWilds(five, isWild));
    if (low && (!best || HandEvaluator.compareAceToFiveLow(low.ranks, best.ranks) < 0)) {
      best = { lowCards: five, ranks: low.ranks };
    }
  }
  return best;
}

/** The best qualifying 8-or-better low from any number of cards, or null if there is none. */
export function evaluateWildLow(cards: Card[], isWild: WildMatcher): { lowCards: Card[]; ranks: number[] } | null {
  return bestEightOrBetter(fivesFrom(validCards(cards)), isWild);
}

/** The best qualifying 8-or-better low under Omaha's rule, or null if there is none. */
export function evaluateWildOmahaLow(hole: Card[], board: Card[], isWild: WildMatcher): { lowCards: Card[]; ranks: number[] } | null {
  return bestEightOrBetter(omahaFives(validCards(hole), validCards(board)), isWild);
}

/** The best razz hand: its five cards, a description and a strength where higher is better. */
export function evaluateWildRazz(cards: Card[], isWild: WildMatcher): { lowCards: Card[]; description: string; strength: number } {
  let bestCards: Card[] = [];
  let bestFilled: Card[] = [];
  let bestKey: number[] | null = null;
  for (const five of fivesFrom(validCards(cards))) {
    const filled = fillLowWilds(five, isWild);
    const key = HandEvaluator.razzLowKey(filled);
    if (!bestKey || HandEvaluator.compareRazzLow(key, bestKey) < 0) {
      bestKey = key; bestCards = five; bestFilled = filled;
    }
  }
  return {
    lowCards: bestCards,
    description: HandEvaluator.evaluateRazzLow(bestFilled).description,
    strength: HandEvaluator.razzStrength(bestFilled),
  };
}
