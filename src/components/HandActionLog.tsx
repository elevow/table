import React, { useEffect, useRef } from 'react';
import { describeAction } from '../lib/shared/hand-replay';
import type { GameStage, HandActionEntry } from '../types/poker';

interface Props {
  actions?: HandActionEntry[];
  players: Array<{ id: string; name?: string }>;
  handNumber?: number;
}

const STREET: Partial<Record<GameStage, string>> = {
  preflop: 'Preflop', flop: 'Flop', turn: 'Turn', river: 'River',
  third: '3rd street', fourth: '4th street', fifth: '5th street', sixth: '6th street', seventh: '7th street',
};

const money = (n: number) => `$${n}`;

/** What has happened so far in the current hand, newest at the bottom. */
export default function HandActionLog({ actions = [], players, handNumber }: Props) {
  const listRef = useRef<HTMLOListElement>(null);
  const names = new Map(players.map(p => [p.id, p.name || 'Player']));

  // Keep the latest action in view as the hand goes on
  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [actions.length, handNumber]);

  const rows: React.ReactNode[] = [];
  let stage: GameStage | null = null;
  actions.forEach((a, i) => {
    if (a.stage !== stage) {
      stage = a.stage;
      rows.push(
        <li key={`s${i}`} className="pt-1 text-[11px] uppercase tracking-wide text-gray-500 dark:text-gray-400 border-t border-gray-200 dark:border-gray-700 first:border-t-0 first:pt-0">
          {STREET[a.stage] || a.stage}
        </li>
      );
    }
    rows.push(
      <li key={i} className={a.action === 'fold' ? 'text-gray-500 dark:text-gray-400' : 'text-gray-900 dark:text-gray-100'}>
        {describeAction(a, names.get(a.playerId) || 'Player', money)}
      </li>
    );
  });

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-4">
      <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100 mb-2">
        Action{handNumber ? <span className="font-normal text-gray-500 dark:text-gray-400"> · Hand #{handNumber}</span> : null}
      </h3>
      {rows.length === 0 ? (
        <p className="text-xs text-gray-500 dark:text-gray-400">No actions yet this hand.</p>
      ) : (
        <ol ref={listRef} className="max-h-48 overflow-y-auto space-y-0.5 text-xs" aria-live="polite" aria-label="Actions this hand">
          {rows}
        </ol>
      )}
    </div>
  );
}
