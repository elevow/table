import React from 'react';
import type { Card, TableState, WildRule } from '../types/poker';
import { describeMixedRotation, gameLabel, isHoldemVariant, isStudVariant, WILD_RULE_LABELS } from '../lib/poker/variant-rules';
import { followTheQueenRank } from '../lib/poker/wild-hands';

interface Props {
  state?: TableState | null;
}

const badge = 'inline-flex items-center px-3 py-1 text-xs font-semibold rounded-full';

const RANK_PLURAL: Partial<Record<Card['rank'], string>> = { J: 'Jacks', K: 'Kings', A: 'Aces' };

// The badge's tooltip for games whose wild cards come with special rules
const WILD_TITLES: Partial<Record<WildRule, string>> = {
  'follow-the-queen': 'Queens are wild, and so is the rank of the card dealt face up after the last face-up queen. Five of a kind is the top hand.',
  'baseball': '3s and 9s are wild. A 4 dealt face up gets an extra card face down; a 3 dealt face up means match the pot or fold. Five of a kind is the top hand.',
};

/** "Deuces Wild"; in Follow the Queen, what is wild right now, such as "Queens & 7s Wild". */
function wildLabel(state: TableState): string {
  if (state.wildRule !== 'follow-the-queen') return state.wildRule ? WILD_RULE_LABELS[state.wildRule] : '';
  const follow = followTheQueenRank(state.studState?.upCardOrder);
  return follow ? `Queens & ${RANK_PLURAL[follow] || `${follow}s`} Wild` : 'Queens Wild';
}

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
      {state.wildRule && (
        <span
          className={`${badge} bg-fuchsia-100 text-fuchsia-800 dark:bg-fuchsia-900/60 dark:text-fuchsia-100`}
          title={WILD_TITLES[state.wildRule] || 'A wild card counts as whatever makes your hand best. Five of a kind is the top hand.'}
        >
          {wildLabel(state)}
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
