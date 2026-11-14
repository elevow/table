/**
 * Side bets: small games players join on the side of the poker. They are separate money: nothing
 * comes from or goes to the chips on the table. What each player wins or loses is kept in its own
 * ledger and added to their poker result when the night is settled up.
 *
 * Shared by the server (settlement) and the table page (the Side bets tab).
 */
import type { Card } from '../../types/poker';

export const SIDE_BETS = ['best-suit', 'flop-color', 'high-card-bingo', 'bad-beat'] as const;
export type SideBetKey = typeof SIDE_BETS[number];

/** Side bets whose stakes build up in a pot over several hands until someone wins it. */
export const POOL_BETS = ['high-card-bingo', 'bad-beat'] as const;
export type PoolBetKey = typeof POOL_BETS[number];

export const FLOP_COLORS = ['red', 'black', 'mixed'] as const;
export const BINGO_RANKS: Card['rank'][] = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];

// Bad beat jackpot: the player who lost with four of a kind or better gets this share, the winner the rest
export const BAD_BEAT_LOSER_SHARE = 0.75;

export const MAX_SIDE_BET_STAKE = 1000;

export interface SideBetInfo {
  key: SideBetKey;
  name: string;
  summary: string;
  // Bets where each player makes a choice, kept until they change it
  pick?: { label: string; options: Array<{ value: string; label: string }> };
}

const RANK_LABELS: Record<string, string> = { J: 'Jack', Q: 'Queen', K: 'King', A: 'Ace' };

export const SIDE_BET_INFO: Record<SideBetKey, SideBetInfo> = {
  'best-suit': {
    key: 'best-suit',
    name: 'Best suit',
    summary: 'Each hand names a suit. Whoever holds the most of it by value (2–10, J 11, Q 12, K 13, A 14) wins; everyone else in pays the stake. Your own cards only, folded or not.',
  },
  'flop-color': {
    key: 'flop-color',
    name: 'Flop color',
    summary: 'Call the flop all red, all black or mixed. Players who called it split the stakes of those who didn\'t. Hands without a flop don\'t count.',
    pick: {
      label: 'Your call',
      options: [
        { value: 'red', label: 'All red' },
        { value: 'black', label: 'All black' },
        { value: 'mixed', label: 'Mixed' },
      ],
    },
  },
  'high-card-bingo': {
    key: 'high-card-bingo',
    name: 'High card bingo',
    summary: 'Pick a rank. Every hand with a board, each player in puts the stake in the pot. The first board card that matches someone\'s rank wins them the pot; if nobody\'s comes, it carries over.',
    pick: {
      label: 'Your rank',
      options: BINGO_RANKS.map(r => ({ value: r, label: RANK_LABELS[r] || r })),
    },
  },
  'bad-beat': {
    key: 'bad-beat',
    name: 'Bad beat jackpot',
    summary: 'Each Hold\'em, Omaha or stud hand, players in put the stake in the jackpot. Lose at showdown with four of a kind or better and you take 75%, the winner 25%. Not played with wild cards. Never hit by the end of the night, nobody pays.',
  },
};

/** The stake for each side bet the host turned on, in dollars. */
export type SideBetStakes = Partial<Record<SideBetKey, number>>;

export function isSideBetKey(v: unknown): v is SideBetKey {
  return typeof v === 'string' && (SIDE_BETS as readonly string[]).includes(v);
}

export function isPoolBet(v: SideBetKey): v is PoolBetKey {
  return (POOL_BETS as readonly string[]).includes(v);
}

/** A stake rounded to cents, or 0 when it isn't a usable amount. */
export function sideBetStake(v: unknown): number {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.min(MAX_SIDE_BET_STAKE, Math.round(n * 100) / 100);
}

/** The side bets turned on in a room's configuration, with their stakes. */
export function parseSideBetStakes(v: unknown): SideBetStakes {
  const stakes: SideBetStakes = {};
  if (!v || typeof v !== 'object') return stakes;
  for (const key of SIDE_BETS) {
    const stake = sideBetStake((v as Record<string, unknown>)[key]);
    if (stake > 0) stakes[key] = stake;
  }
  return stakes;
}

/** Whether a pick is valid for a side bet; bets without picks take none. */
export function isValidPick(bet: SideBetKey, pick: unknown): boolean {
  const options = SIDE_BET_INFO[bet].pick?.options;
  if (!options) return pick == null;
  return typeof pick === 'string' && options.some(o => o.value === pick);
}

const SUIT_ORDER: Card['suit'][] = ['spades', 'hearts', 'diamonds', 'clubs'];

/** The suit best suit is played for in a hand: spades, hearts, diamonds, clubs, in turn. */
export function bestSuitForHand(handNumber: number): Card['suit'] {
  const n = Math.max(0, Math.floor(Number(handNumber) || 0));
  return SUIT_ORDER[n % SUIT_ORDER.length];
}

export const SUIT_SYMBOLS: Record<Card['suit'], string> = { spades: '♠', hearts: '♥', diamonds: '♦', clubs: '♣' };

export function formatMoney(amount: number): string {
  const abs = Math.abs(amount);
  const text = Number.isInteger(abs) ? abs.toLocaleString() : abs.toFixed(2);
  return `${amount < 0 ? '-' : ''}$${text}`;
}
