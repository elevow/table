/**
 * Your chances of improving on the last card to come (the river, or the last stud card), from what
 * you can see. Opponents' hidden cards are unknown to you, so they count among the unseen cards,
 * which is how players work out their outs at the table.
 */
import { HandRank, type Card, type GameVariant } from '../../types/poker';
import { HandEvaluator } from './hand-evaluator';

const RANKS: Card['rank'][] = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
const SUITS: Card['suit'][] = ['hearts', 'diamonds', 'clubs', 'spades'];

const HAND_NAMES: Record<number, string> = {
  [HandRank.OnePair]: 'Pair',
  [HandRank.TwoPair]: 'Two Pair',
  [HandRank.ThreeOfAKind]: 'Three of a Kind',
  [HandRank.Straight]: 'Straight',
  [HandRank.Flush]: 'Flush',
  [HandRank.FullHouse]: 'Full House',
  [HandRank.FourOfAKind]: 'Four of a Kind',
  [HandRank.StraightFlush]: 'Straight Flush',
  [HandRank.RoyalFlush]: 'Royal Flush',
};

export interface ImprovementOdds {
  /** Cards you can't see, any of which could come last */
  unseen: number;
  /** How many of them make a better kind of hand than you hold now */
  improving: number;
  /** Chance to improve, 0-100 */
  pct: number;
  /** Best kind of hand first */
  byHand: Array<{ name: string; count: number; pct: number }>;
}

/**
 * The games where the next card is the last one, as far as working out improvement goes: high
 * hands only, since low hands (razz, hi-lo) are judged differently.
 */
export function lastCardDrawFor(variant: GameVariant | string | undefined, cards: { board: number; mine: number }): 'river' | 'last card' | null {
  if (!variant || variant === 'texas-holdem' || variant === 'omaha' || variant === 'omaha-5') {
    return cards.board === 4 ? 'river' : null;
  }
  if (variant === 'seven-card-stud') return cards.mine === 6 ? 'last card' : null;
  if (variant === 'five-card-stud') return cards.mine === 4 ? 'last card' : null;
  return null;
}

const key = (c: Card) => `${c.rank}-${c.suit}`;

/**
 * Try each unseen card as the last card and count the ones that make a better kind of hand.
 * mine: your cards (hole cards, or all your stud cards); board: community cards; seen: other
 * cards you can see, such as opponents' stud up cards.
 */
export function improvementOnLastCard(opts: { mine: Card[]; board: Card[]; seen?: Card[]; omaha?: boolean }): ImprovementOdds | null {
  const { mine, board, seen = [], omaha = false } = opts;
  if (mine.length === 0) return null;
  const rankOf = (extra: Card[]): number => (omaha
    ? HandEvaluator.getOmahaHandRanking(mine, [...board, ...extra])
    : HandEvaluator.getHandRanking(mine, [...board, ...extra])).rank;

  try {
    const known = new Set([...mine, ...board, ...seen].map(key));
    const unseen: Card[] = [];
    for (const suit of SUITS) for (const rank of RANKS) if (!known.has(`${rank}-${suit}`)) unseen.push({ rank, suit });
    if (unseen.length === 0) return null;

    const now = rankOf([]);
    const counts = new Map<number, number>();
    for (const card of unseen) {
      const next = rankOf([card]);
      if (next > now) counts.set(next, (counts.get(next) || 0) + 1);
    }
    const pctOf = (n: number) => Math.round((n / unseen.length) * 1000) / 10;
    const improving = Array.from(counts.values()).reduce((a, b) => a + b, 0);
    return {
      unseen: unseen.length,
      improving,
      pct: pctOf(improving),
      byHand: Array.from(counts.entries())
        .sort((a, b) => b[0] - a[0])
        .map(([rank, count]) => ({ name: HAND_NAMES[rank] || 'Better hand', count, pct: pctOf(count) })),
    };
  } catch {
    return null;
  }
}

/** "27% to improve on the river: Flush 9 cards (20%), Straight 3 cards (7%)". */
export function describeImprovement(odds: ImprovementOdds, when: string): string {
  if (odds.improving === 0) return `No card on the ${when} improves your hand`;
  const parts = odds.byHand.map(h => `${h.name} ${h.count} card${h.count === 1 ? '' : 's'} (${Math.round(h.pct)}%)`);
  return `${Math.round(odds.pct)}% to improve on the ${when}: ${parts.join(', ')}`;
}
