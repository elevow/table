import type { GameStage, TableState } from '../../types/poker';

/**
 * Fixed-limit betting rules, shared by the engine and the table page.
 *
 * - The small bet is the big blind; the big bet is twice the big blind.
 * - Flop games use the small bet preflop and on the flop, the big bet on the turn and river.
 *   Stud uses the small bet on third and fourth street, the big bet from fifth street on.
 * - Every bet or raise is exactly one bet. A street is capped at FIXED_LIMIT_CAP bets (a bet and
 *   three raises), heads-up included: we keep the cap at every table size so the rule is the same
 *   for everyone, rather than lifting it when only two players are left.
 * - A player who has fewer chips may still go all-in for less. A short all-in does not count as a
 *   bet towards the cap; the next player who raises raises to the next full level.
 * - In stud the bring-in stays; the first player to act after it may complete it to the small bet,
 *   which counts as the first bet.
 * - (Simplification: the optional big bet on fourth street with an open pair in stud is not offered.)
 */

export const FIXED_LIMIT_CAP = 4;

const BIG_BET_STAGES: GameStage[] = ['turn', 'river', 'fifth', 'sixth', 'seventh'];

/** Size of one bet on this street. */
export function fixedLimitBetSize(stage: GameStage, bigBlind: number): number {
  return BIG_BET_STAGES.includes(stage) ? bigBlind * 2 : bigBlind;
}

export interface FixedLimitOptions {
  // One bet on this street
  unit: number;
  // Total the player's bet becomes if they bet (when nobody has bet) or raise
  betTo: number | null;
  raiseTo: number | null;
  // Betting has reached the cap for this street
  capped: boolean;
  bets: number;
}

/**
 * What the player may do with chips on this street: bet or raise to an exact total, never more
 * than their stack (a smaller amount is an all-in).
 */
export function fixedLimitOptions(
  state: Pick<TableState, 'stage' | 'bigBlind' | 'currentBet' | 'limitBets'>,
  player: { currentBet: number; stack: number }
): FixedLimitOptions {
  const unit = fixedLimitBetSize(state.stage, state.bigBlind);
  const bets = state.limitBets || 0;
  const capped = bets >= FIXED_LIMIT_CAP;
  const maxTotal = player.currentBet + player.stack;
  const currentBet = state.currentBet || 0;
  let betTo: number | null = null;
  let raiseTo: number | null = null;
  if (currentBet <= 0) {
    betTo = Math.min(unit, maxTotal);
  } else if (!capped && maxTotal > currentBet) {
    raiseTo = Math.min(fixedLimitRaiseTarget(currentBet, bets, unit), maxTotal);
  }
  return { unit, betTo, raiseTo, capped, bets };
}

/**
 * Total a full raise goes to: the next bet level. After a bring-in or a short all-in the level is
 * still ahead of the current bet, so the raise completes it.
 */
export function fixedLimitRaiseTarget(currentBet: number, bets: number, unit: number): number {
  const target = (bets + 1) * unit;
  return target > currentBet ? target : currentBet + unit;
}
