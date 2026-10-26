import type { BettingMode, GameVariant, MixedGameEntry } from '../../types/poker';

/**
 * Facts about each game variant, in one place so the engine, the server routes and the table
 * page agree on them. Safe to import from client code.
 */

// Every playable variant, in the order they are offered to players
export const ALL_VARIANTS: GameVariant[] = [
  'texas-holdem',
  'omaha',
  'omaha-5',
  'omaha-hi-lo',
  'seven-card-stud',
  'seven-card-stud-hi-lo',
  'razz',
  'five-card-stud',
];

export const VARIANT_LABELS: Record<GameVariant, string> = {
  'texas-holdem': "Texas Hold'em",
  'omaha': 'Omaha',
  'omaha-5': '5-Card Omaha',
  'omaha-hi-lo': 'Omaha Hi-Lo',
  'seven-card-stud': 'Seven-Card Stud',
  'seven-card-stud-hi-lo': 'Seven-Card Stud Hi-Lo',
  'razz': 'Razz',
  'five-card-stud': 'Five-Card Stud',
};

export const BETTING_MODE_LABELS: Record<BettingMode, string> = {
  'no-limit': 'No Limit',
  'pot-limit': 'Pot Limit',
  'fixed-limit': 'Fixed Limit',
};

export function isGameVariant(v: unknown): v is GameVariant {
  return typeof v === 'string' && (ALL_VARIANTS as string[]).includes(v);
}

export function isBettingMode(v: unknown): v is BettingMode {
  return v === 'no-limit' || v === 'pot-limit' || v === 'fixed-limit';
}

/** Stud games: no board; each player has their own down and up cards. */
export function isStudVariant(v?: string | null): boolean {
  return v === 'seven-card-stud' || v === 'seven-card-stud-hi-lo' || v === 'five-card-stud' || v === 'razz';
}

/** Stud games dealt to seven cards (third to seventh street). */
export function isSevenCardStudVariant(v?: string | null): boolean {
  return v === 'seven-card-stud' || v === 'seven-card-stud-hi-lo' || v === 'razz';
}

/** Omaha games: the best hand uses exactly two hole cards and three board cards. */
export function isOmahaVariant(v?: string | null): boolean {
  return v === 'omaha' || v === 'omaha-hi-lo' || v === 'omaha-5';
}

/** Hold'em, including tables saved before the variant was recorded. */
export function isHoldemVariant(v?: string | null): boolean {
  return !v || v === 'texas-holdem';
}

/** Hole cards dealt in a board game (Hold'em or Omaha). */
export function holeCardCount(v?: string | null): number {
  if (v === 'omaha-5') return 5;
  if (v === 'omaha' || v === 'omaha-hi-lo') return 4;
  return 2;
}

export function variantLabel(v?: string | null): string {
  return (v && VARIANT_LABELS[v as GameVariant]) || (v ? v : VARIANT_LABELS['texas-holdem']);
}

/** "Fixed Limit Razz", "Pot Limit Omaha" and so on. */
export function gameLabel(entry: MixedGameEntry): string {
  return `${BETTING_MODE_LABELS[entry.bettingMode]} ${variantLabel(entry.variant)}`;
}

// A HORSE-style rotation: limit Hold'em, Omaha Hi-Lo, Razz, Stud and Stud Hi-Lo
export const HORSE_GAMES: MixedGameEntry[] = [
  { variant: 'texas-holdem', bettingMode: 'fixed-limit' },
  { variant: 'omaha-hi-lo', bettingMode: 'fixed-limit' },
  { variant: 'razz', bettingMode: 'fixed-limit' },
  { variant: 'seven-card-stud', bettingMode: 'fixed-limit' },
  { variant: 'seven-card-stud-hi-lo', bettingMode: 'fixed-limit' },
];

// Big-bet mix: no-limit Hold'em and pot-limit Omaha in turn
export const NLH_PLO_GAMES: MixedGameEntry[] = [
  { variant: 'texas-holdem', bettingMode: 'no-limit' },
  { variant: 'omaha', bettingMode: 'pot-limit' },
];

export const MIXED_GAME_PRESETS: Record<string, { name: string; games: MixedGameEntry[] }> = {
  horse: { name: 'HORSE (limit Hold\'em, Omaha Hi-Lo, Razz, Stud, Stud Hi-Lo)', games: HORSE_GAMES },
  'nlh-plo': { name: 'No-Limit Hold\'em / Pot-Limit Omaha', games: NLH_PLO_GAMES },
};

export const DEFAULT_HANDS_PER_GAME = 8;
export const MAX_MIXED_GAMES = 12;

/**
 * Validate a mixed-game list from a room's configuration; null when it is not usable. Entries
 * with an unknown variant are dropped, and a missing or unknown betting mode becomes the
 * variant's default.
 */
export function parseMixedGames(
  raw: unknown,
  defaultMode: (v: GameVariant) => BettingMode
): MixedGameEntry[] | null {
  if (!Array.isArray(raw)) return null;
  const games: MixedGameEntry[] = [];
  for (const item of raw.slice(0, MAX_MIXED_GAMES)) {
    const variant = typeof item === 'string' ? item : (item as { variant?: unknown })?.variant;
    if (!isGameVariant(variant)) continue;
    const mode = typeof item === 'object' && item ? (item as { bettingMode?: unknown }).bettingMode : undefined;
    games.push({ variant, bettingMode: isBettingMode(mode) ? mode : defaultMode(variant) });
  }
  return games.length > 0 ? games : null;
}

/** A hands-per-game count from configuration, kept within 1..100. */
export function parseHandsPerGame(raw: unknown): number {
  const n = Math.floor(Number(raw));
  if (!Number.isFinite(n) || n < 1) return DEFAULT_HANDS_PER_GAME;
  return Math.min(100, n);
}

/**
 * Where a mixed-game rotation stands, for the table: the game being played, the next one and how
 * many hands of the current game are left after this one.
 */
export function describeMixedRotation(mixed?: {
  games: MixedGameEntry[];
  handsPerGame: number;
  index: number;
  handsInGame: number;
} | null): { current: MixedGameEntry; next: MixedGameEntry; handsLeft: number } | null {
  if (!mixed || !Array.isArray(mixed.games) || mixed.games.length === 0) return null;
  const n = mixed.games.length;
  const index = ((mixed.index % n) + n) % n;
  const current = mixed.games[index];
  const next = mixed.games[(index + 1) % n];
  const handsLeft = Math.max(0, mixed.handsPerGame - mixed.handsInGame);
  return { current, next, handsLeft };
}
