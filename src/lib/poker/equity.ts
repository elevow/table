import { HandEvaluator } from './hand-evaluator';
import type { Card } from '../../types/poker';
import type { HandInterface } from '../../types/poker-engine';

export interface EquityResult {
  playerId: string;
  // Share of the pot won on average, 0..1 (ties split)
  equity: number;
  win: number;
  tie: number;
}

const SUITS: Card['suit'][] = ['hearts', 'diamonds', 'clubs', 'spades'];
const RANKS: Card['rank'][] = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
const key = (c: Card) => `${c.rank}${c.suit}`;

/** Small seeded generator so the same spot shows the same simulated numbers on every render. */
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function* combinations<T>(items: T[], k: number, start = 0, prefix: T[] = []): Generator<T[]> {
  if (prefix.length === k) {
    yield prefix;
    return;
  }
  for (let i = start; i <= items.length - (k - prefix.length); i++) {
    yield* combinations(items, k, i + 1, [...prefix, items[i]]);
  }
}

/**
 * Chance each player wins the pot from here, for Hold'em or Omaha with every player's cards
 * known (an all-in). Exact when two or fewer board cards are still to come; otherwise a seeded
 * simulation of `samples` boards.
 */
export function computeEquity(
  players: Array<{ id: string; holeCards: Card[] }>,
  board: Card[],
  opts: { omaha?: boolean; samples?: number } = {}
): EquityResult[] {
  const contenders = players.filter(p => p.holeCards.length >= (opts.omaha ? 4 : 2));
  if (contenders.length < 2) return [];
  const need = 5 - board.length;
  const used = new Set([...board, ...contenders.flatMap(p => p.holeCards)].map(key));
  const deck: Card[] = [];
  for (const suit of SUITS) for (const rank of RANKS) {
    const c = { suit, rank };
    if (!used.has(key(c))) deck.push(c);
  }

  const evaluate = opts.omaha
    ? HandEvaluator.evaluateOmahaHand.bind(HandEvaluator)
    : HandEvaluator.evaluateHand.bind(HandEvaluator);
  const wins = new Array(contenders.length).fill(0);
  const ties = new Array(contenders.length).fill(0);
  const shares = new Array(contenders.length).fill(0);
  let trials = 0;

  const score = (fullBoard: Card[]) => {
    const hands: HandInterface[] = contenders.map(p => evaluate(p.holeCards, fullBoard).hand);
    let best = [0];
    for (let i = 1; i < hands.length; i++) {
      const cmp = HandEvaluator.compareHands(hands[i], hands[best[0]]);
      if (cmp > 0) best = [i];
      else if (cmp === 0) best.push(i);
    }
    best.forEach(i => {
      if (best.length === 1) wins[i] += 1;
      else ties[i] += 1;
      shares[i] += 1 / best.length;
    });
    trials += 1;
  };

  if (need <= 0) {
    score(board);
  } else if (need <= 2) {
    for (const runout of combinations(deck, need)) score([...board, ...runout]);
  } else {
    const samples = opts.samples ?? (opts.omaha ? 400 : 1500);
    const rand = mulberry32(Array.from(used).join('').split('').reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) | 0, 7));
    for (let s = 0; s < samples; s++) {
      // Partial Fisher-Yates: draw `need` distinct cards
      const pool = deck.slice();
      const runout: Card[] = [];
      for (let k = 0; k < need; k++) {
        const j = k + Math.floor(rand() * (pool.length - k));
        [pool[k], pool[j]] = [pool[j], pool[k]];
        runout.push(pool[k]);
      }
      score([...board, ...runout]);
    }
  }

  return contenders.map((p, i) => ({
    playerId: p.id,
    equity: trials ? shares[i] / trials : 0,
    win: trials ? wins[i] / trials : 0,
    tie: trials ? ties[i] / trials : 0,
  }));
}
