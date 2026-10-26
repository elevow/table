import React from 'react';
import type { TableState } from '../types/poker';
import { describeMixedRotation, gameLabel, isHoldemVariant, isStudVariant } from '../lib/poker/variant-rules';

interface Props {
  state?: TableState | null;
}

const badge = 'inline-flex items-center px-3 py-1 text-xs font-semibold rounded-full';

/**
 * Table header badges for the rules in play: fixed-limit betting, antes, the 7-2 bounty and,
 * in a mixed game, the current game and the next one.
 */
export default function GameRulesBadges({ state }: Props) {
  if (!state) return null;
  const mixed = describeMixedRotation(state.mixedGame);
  const anteApplies = (state.ante || 0) > 0 && !isStudVariant(state.variant);
  const bountyApplies = (state.sevenDeuceBounty || 0) > 0 && isHoldemVariant(state.variant);
  return (
    <>
      {mixed && (
        <span
          className={`${badge} bg-indigo-100 text-indigo-800 dark:bg-indigo-900/60 dark:text-indigo-100`}
          title="Mixed games: the game changes automatically every few hands"
          aria-label="Mixed game rotation"
        >
          Now: {gameLabel(mixed.current)} · Next: {gameLabel(mixed.next)}{' '}
          {mixed.handsLeft === 0 ? 'next hand' : `in ${mixed.handsLeft} hand${mixed.handsLeft === 1 ? '' : 's'}`}
        </span>
      )}
      {!mixed && state.bettingMode === 'fixed-limit' && (
        <span className={`${badge} bg-sky-100 text-sky-800 dark:bg-sky-900/60 dark:text-sky-100`} title="Bets and raises are a fixed size, up to four per round">
          Fixed limit
        </span>
      )}
      {anteApplies && (
        <span className={`${badge} bg-amber-100 text-amber-800 dark:bg-amber-900/60 dark:text-amber-100`} title="Every player antes before each hand">
          Ante ${state.ante}
        </span>
      )}
      {bountyApplies && (
        <span className={`${badge} bg-rose-100 text-rose-800 dark:bg-rose-900/60 dark:text-rose-100`} title="Win a pot with 7-2 offsuit and show it: every other player in the hand pays you this">
          7-2 bounty ${state.sevenDeuceBounty}
        </span>
      )}
    </>
  );
}

/** Announces a 7-2 bounty won in the hand just played. */
export function SevenDeuceBountyBanner({ state }: Props) {
  const bounty = state?.sevenDeuceResult;
  if (!state || state.stage !== 'showdown' || !bounty) return null;
  const name = state.players?.find(p => p.id === bounty.playerId)?.name || 'A player';
  return (
    <div
      className="lg:col-span-3 bg-rose-50 dark:bg-rose-900/30 border border-rose-300 dark:border-rose-700 rounded-lg p-3 text-sm text-rose-900 dark:text-rose-100"
      role="status"
    >
      7-2 bounty! {name} won with seven-deuce and collects ${bounty.total} from the table.
    </div>
  );
}
