import React, { useMemo } from 'react';
import { computeEquity } from '../lib/poker/equity';
import type { Card } from '../types/poker';

interface Props {
  players: Array<{ id: string; name: string; holeCards?: Card[] }>;
  board: Card[];
  omaha: boolean;
}

/**
 * Each player's chance of winning from here during an all-in, when their cards are face up.
 * Exact with one or two cards to come; simulated before that.
 */
export default function EquityPanel({ players, board, omaha }: Props) {
  const withCards = players.filter(p => Array.isArray(p.holeCards) && p.holeCards.length >= (omaha ? 4 : 2));
  const cardKey = JSON.stringify([withCards.map(p => [p.id, p.holeCards]), board]);
  const results = useMemo(
    () => computeEquity(withCards.map(p => ({ id: p.id, holeCards: p.holeCards as Card[] })), board, { omaha }),
    // cardKey captures every input that matters
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [cardKey, omaha]
  );
  if (results.length < 2 || board.length >= 5) return null;
  const names = new Map(players.map(p => [p.id, p.name]));
  const exact = 5 - board.length <= 2;

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-4 mt-4 lg:col-span-2">
      <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100 mb-2">
        Chance to win {exact ? '' : <span className="font-normal text-gray-500 dark:text-gray-400">(estimated)</span>}
      </h3>
      <div className="space-y-2">
        {results
          .slice()
          .sort((a, b) => b.equity - a.equity)
          .map(r => (
            <div key={r.playerId}>
              <div className="flex justify-between text-xs text-gray-700 dark:text-gray-200">
                <span>{names.get(r.playerId) || 'Player'}</span>
                <span className="tabular-nums">
                  {(r.equity * 100).toFixed(1)}%
                  {r.tie > 0.005 && <span className="text-gray-500 dark:text-gray-400"> (tie {(r.tie * 100).toFixed(0)}%)</span>}
                </span>
              </div>
              <div className="h-2 rounded bg-gray-200 dark:bg-gray-700 overflow-hidden">
                <div className="h-full bg-emerald-500" style={{ width: `${r.equity * 100}%` }} />
              </div>
            </div>
          ))}
      </div>
    </div>
  );
}
