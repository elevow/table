import type { BettingMode, GameVariant, MixedGameEntry, WildRule } from '../../types/poker';

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
  'follow-the-queen',
  'baseball',
  'midnight-baseball',
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
  'follow-the-queen': 'Follow the Queen',
  'baseball': 'Baseball',
  'midnight-baseball': 'Midnight Baseball',
};

export const BETTING_MODE_LABELS: Record<BettingMode, string> = {
  'no-limit': 'No Limit',
  'pot-limit': 'Pot Limit',
  'fixed-limit': 'Fixed Limit',
};

export const WILD_RULE_LABELS: Record<WildRule, string> = {
  'deuces': 'Deuces Wild',
  'one-eyed-jacks': 'One-Eyed Jacks Wild',
  'follow-the-queen': 'Queens Wild',
  'baseball': '3s & 9s Wild',
};

/** A wild option a host or dealer can choose; games with their own wild cards set them instead. */
export function parseWildRule(v: unknown): WildRule | undefined {
  return v === 'deuces' || v === 'one-eyed-jacks' ? v : undefined;
}

// Games whose wild cards are part of the game, not a table option
const BUILT_IN_WILDS: Partial<Record<GameVariant, WildRule>> = {
  'follow-the-queen': 'follow-the-queen',
  'baseball': 'baseball',
  'midnight-baseball': 'baseball',
};

/** The wild cards a game comes with, if it has its own. */
export function builtInWildRule(variant?: string | null): WildRule | undefined {
  return variant ? BUILT_IN_WILDS[variant as GameVariant] : undefined;
}

/** Games whose wild cards are part of the game, not a table option. */
export function hasBuiltInWilds(variant?: string | null): boolean {
  return !!builtInWildRule(variant);
}

/**
 * Baseball and Midnight Baseball deal an extra card for each face-up 4 and ask a face-up 3 to
 * match the pot.
 */
export function isBaseballVariant(variant?: string | null): boolean {
  return variant === 'baseball' || variant === 'midnight-baseball';
}

/**
 * Midnight Baseball: every card is dealt face down and nobody looks. In turn, each player turns
 * cards face up until their face-up cards beat the high hand showing, and the betting follows.
 */
export function isMidnightBaseballVariant(variant?: string | null): boolean {
  return variant === 'midnight-baseball';
}

// Midnight Baseball: the table shows each turned card this long before the next, and the clock
// gives the next player to act that time back
export const MIDNIGHT_FLIP_MS = 2000;

export const MAX_TABLE_PLAYERS = 9;
// Seven cards each for seven players is 49 of the 52, so an eighth player could not be dealt in
export const MAX_SEVEN_CARD_WILD_PLAYERS = 7;
// Baseball's face-up 4s can each deal an extra card: six players need 42 cards plus up to 4 more
export const MAX_BASEBALL_PLAYERS = 6;

/** The most players a table can seat for this game. */
export function maxPlayersForGame(variant?: string | null, wildRule?: WildRule): number {
  if (isBaseballVariant(variant)) return MAX_BASEBALL_PLAYERS;
  const wild = !!wildRule || hasBuiltInWilds(variant);
  return wild && isSevenCardStudVariant(variant) ? MAX_SEVEN_CARD_WILD_PLAYERS : MAX_TABLE_PLAYERS;
}

/** The most players a mixed-game room can seat: the lowest limit of the games in its list. */
export function maxPlayersForMixedGames(games: MixedGameEntry[] | null | undefined): number {
  return Math.min(MAX_TABLE_PLAYERS, ...(games || []).map(g => maxPlayersForGame(g.variant)));
}

/** Whether this many players can play a game (Dealer's Choice picks). */
export function variantAllowedFor(variant: string | null | undefined, playerCount: number): boolean {
  return playerCount <= maxPlayersForGame(variant);
}

/**
 * Whether a game can take the Deuces or One-Eyed Jacks option with this many players (Dealer's
 * Choice picks). Games with their own wild cards can't.
 */
export function wildAllowedFor(variant: string | null | undefined, playerCount: number): boolean {
  return !hasBuiltInWilds(variant) && playerCount <= maxPlayersForGame(variant, 'deuces');
}

/**
 * Whether the room-level wild option applies. Dealer's Choice picks wilds per hand instead, and
 * mixed games change the game each hand.
 */
export function supportsWildRule(variant?: string | null): boolean {
  return variant !== 'dealers-choice' && variant !== 'mixed' && !hasBuiltInWilds(variant);
}

export function isGameVariant(v: unknown): v is GameVariant {
  return typeof v === 'string' && (ALL_VARIANTS as string[]).includes(v);
}

export function isBettingMode(v: unknown): v is BettingMode {
  return v === 'no-limit' || v === 'pot-limit' || v === 'fixed-limit';
}

/** Stud games: no board; each player has their own down and up cards. */
export function isStudVariant(v?: string | null): boolean {
  return v === 'seven-card-stud' || v === 'seven-card-stud-hi-lo' || v === 'five-card-stud' || v === 'razz' || v === 'follow-the-queen' || v === 'baseball' || v === 'midnight-baseball';
}

/** Stud games dealt seven cards each (Midnight Baseball deals all seven at once, face down). */
export function isSevenCardStudVariant(v?: string | null): boolean {
  return v === 'seven-card-stud' || v === 'seven-card-stud-hi-lo' || v === 'razz' || v === 'follow-the-queen' || v === 'baseball' || v === 'midnight-baseball';
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
    // Games with wild cards are always fixed limit
    const bettingMode = hasBuiltInWilds(variant) ? 'fixed-limit' : isBettingMode(mode) ? mode : defaultMode(variant);
    games.push({ variant, bettingMode });
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
