/**
 * Quick bet sizes (min, half pot, two-thirds pot, pot, all-in) for the bet and raise controls.
 *
 * Amounts are the player's total bet on the street after the action, the same number the
 * bet/raise controls and the action API use. The pot already holds every chip put in this
 * hand, including bets on the current street, so a pot-sized raise is
 * "call, then raise by the pot after calling": currentBet + (pot + toCall).
 */

export type BetPreset = 'min' | 'half' | 'two-thirds' | 'pot' | 'all-in';

export const BET_PRESETS: ReadonlyArray<{ preset: BetPreset; label: string; title: string }> = [
  { preset: 'min', label: 'Min', title: 'Smallest legal amount' },
  { preset: 'half', label: '½ Pot', title: 'Half the pot' },
  { preset: 'two-thirds', label: '⅔ Pot', title: 'Two thirds of the pot' },
  { preset: 'pot', label: 'Pot', title: 'The size of the pot' },
  { preset: 'all-in', label: 'All-in', title: 'Every chip you have (capped by the pot in pot-limit)' },
];

const FRACTIONS: Record<'half' | 'two-thirds' | 'pot', number> = {
  half: 1 / 2,
  'two-thirds': 2 / 3,
  pot: 1,
};

export interface BetSizingInput {
  preset: BetPreset;
  /** 'bet' when nobody has bet this street, 'raise' when there is a bet to face. */
  kind: 'bet' | 'raise';
  /** Chips in the pot, including bets already made on this street. */
  pot: number;
  /** The highest total bet on this street. */
  currentBet: number;
  /** What this player has already put in on this street. */
  myBet: number;
  /** Legal bounds for the betting mode, from the table's bet/raise bounds helpers. */
  min: number;
  max: number;
  bigBlind: number;
}

/**
 * Size of one chip for rounding. Tables with whole-number blinds play in whole chips; tables
 * with fractional blinds (0.25/0.50) would lose their small bets to whole-chip rounding, so
 * they round to cents instead.
 */
export function chipUnit(bigBlind: number): number {
  return bigBlind >= 1 && Number.isInteger(bigBlind) ? 1 : 0.01;
}

const roundTo = (value: number, unit: number) => Number((Math.round(value / unit) * unit).toFixed(2));

/** Only no-limit and pot-limit have free bet sizing; other modes (e.g. fixed-limit) get no presets. */
export function supportsBetPresets(bettingMode: string | undefined | null): boolean {
  const mode = bettingMode || 'no-limit';
  return mode === 'no-limit' || mode === 'pot-limit';
}

/**
 * Total bet for a preset, rounded to the table's chip size and kept within [min, max].
 * Min and all-in return the bounds exactly so a short stack can always go all-in.
 */
export function computePresetAmount(input: BetSizingInput): number {
  const { preset, kind, min, max, bigBlind } = input;
  const lo = Math.min(min, max);
  const hi = Math.max(min, max);
  if (preset === 'min') return lo;
  if (preset === 'all-in') return hi;

  const pot = Math.max(0, Number(input.pot) || 0);
  const currentBet = Math.max(0, Number(input.currentBet) || 0);
  const myBet = Math.max(0, Number(input.myBet) || 0);
  const fraction = FRACTIONS[preset];

  let target: number;
  if (kind === 'raise') {
    // Call first, then raise by a share of the pot as it stands after the call
    const toCall = Math.max(0, currentBet - myBet);
    target = currentBet + fraction * (pot + toCall);
  } else {
    target = myBet + fraction * pot;
  }

  const rounded = roundTo(target, chipUnit(bigBlind));
  return Math.max(lo, Math.min(hi, rounded));
}

/** The amount after moving it by one big blind, kept within the legal bounds. */
export function nudgeAmount(current: number, direction: 1 | -1, bigBlind: number, min: number, max: number): number {
  const lo = Math.min(min, max);
  const hi = Math.max(min, max);
  const step = bigBlind > 0 ? bigBlind : chipUnit(bigBlind);
  const base = Math.max(lo, Math.min(hi, Number(current) || 0));
  const next = Number((base + direction * step).toFixed(2));
  return Math.max(lo, Math.min(hi, next));
}
