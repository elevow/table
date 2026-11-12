import React from 'react';
import type { BettingMode, GameVariant, WildRule } from '../types/poker';
import { BETTING_EXPLAINED, HIGH_HANDS, WILD_EXPLAINED, gameRulesFor, type RankingKind } from '../lib/ui/game-rules';
import { BETTING_MODE_LABELS, VARIANT_LABELS, hasBuiltInWilds } from '../lib/poker/variant-rules';

interface Props {
  // The game being played now (or the table's game before the first hand)
  variant?: string | null;
  bettingMode?: BettingMode | null;
  wildRule?: WildRule | null;
  // The table's format: a single game, 'dealers-choice' or 'mixed'
  tableGame?: string | null;
  // The dealer is choosing the next game
  choosing?: boolean;
}

const heading = 'text-sm font-semibold text-gray-900 dark:text-gray-100 mt-4 mb-1';
const list = 'text-sm text-gray-700 dark:text-gray-300 space-y-1 pl-5';

const FORMAT_NOTE: Record<string, string> = {
  'dealers-choice': "This table plays Dealer's Choice: the player choosing picks the game, and it changes as the choice moves around the table.",
  'mixed': 'This table plays mixed games: the game changes automatically every few hands.',
};

/** The ranking chart a game is won with. */
function Ranking({ kind }: { kind: RankingKind }) {
  if (kind === 'razz' || kind === 'badugi' || kind === 'guts') return null;
  return (
    <details className="mt-4">
      <summary className="cursor-pointer text-sm font-semibold text-gray-900 dark:text-gray-100">Hand rankings, best first</summary>
      <ol className={`${list} list-decimal mt-2`}>
        {HIGH_HANDS.map(h => (
          <li key={h.name}>
            <span className="font-medium text-gray-900 dark:text-gray-100">{h.name}</span>{' '}
            <span className="text-gray-500 dark:text-gray-400">· {h.example}</span>
          </li>
        ))}
      </ol>
      {kind === 'hi-lo' && (
        <p className="mt-2 text-sm text-gray-700 dark:text-gray-300">
          Low hands are compared from the highest card down: 7-5-4-3-2 beats 7-6-3-2-A, and 5-4-3-2-A is the best low.
        </p>
      )}
    </details>
  );
}

/**
 * The Rules tab: how the game being played works, how it's won, and this table's betting and
 * wild cards, for players who don't know the game.
 */
export default function GameRulesPanel({ variant, bettingMode, wildRule, tableGame, choosing }: Props) {
  const rules = gameRulesFor(variant);
  const formatNote = tableGame ? FORMAT_NOTE[tableGame] : undefined;
  const name = variant ? VARIANT_LABELS[variant as GameVariant] : undefined;
  // A game's own wild cards are part of its rules; the table option is explained here
  const wild = wildRule && !hasBuiltInWilds(variant) ? WILD_EXPLAINED[wildRule] : undefined;

  return (
    <div>
      {formatNote && <p className="text-sm text-gray-700 dark:text-gray-300 mb-2">{formatNote}</p>}
      {choosing && <p className="text-sm text-gray-700 dark:text-gray-300 mb-2">The next game is being chosen. These are the rules of the last one.</p>}
      {!rules ? (
        <p className="text-sm text-gray-600 dark:text-gray-400">The rules show here once a game is chosen.</p>
      ) : (
        <>
          <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100">
            {bettingMode ? `${BETTING_MODE_LABELS[bettingMode]} ` : ''}{name}
          </h3>
          <p className="text-sm text-gray-700 dark:text-gray-300 mt-1">{rules.summary}</p>

          <h4 className={heading}>How a hand plays</h4>
          <ol className={`${list} list-decimal`}>
            {rules.howToPlay.map((step, i) => <li key={i}>{step}</li>)}
          </ol>

          <h4 className={heading}>Winning</h4>
          <ul className={`${list} list-disc`}>
            {rules.winning.map((line, i) => <li key={i}>{line}</li>)}
          </ul>

          {(bettingMode || wild) && (
            <>
              <h4 className={heading}>At this table</h4>
              <ul className={`${list} list-disc`}>
                {bettingMode && <li>{BETTING_EXPLAINED[bettingMode]}</li>}
                {wild && <li>{wild}</li>}
              </ul>
            </>
          )}

          <Ranking kind={rules.ranking} />
        </>
      )}
    </div>
  );
}
