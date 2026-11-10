import React, { useEffect, useRef } from 'react';
import { describeAction, streetLabel } from '../lib/shared/hand-replay';
import type { GameStage, HandActionEntry } from '../types/poker';

interface Props {
  actions?: HandActionEntry[];
  players: Array<{ id: string; name?: string }>;
  handNumber?: number;
  variant?: string;
  // Shown inside the side panel tabs, without its own card
  embedded?: boolean;
}

const money = (n: number) => `$${n}`;

/** What has happened so far in the current hand, newest at the bottom. */
export default function HandActionLog({ actions = [], players, handNumber, variant, embedded = false }: Props) {
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
        <li key={`s${i}`} className="sticky top-0 z-10 bg-white pt-1.5 pb-0.5 text-[11px] font-semibold uppercase tracking-wider text-emerald-600 dark:bg-[#151a21] dark:text-emerald-400 border-t border-gray-100 dark:border-white/5 first:border-t-0 first:pt-0">
          {streetLabel(a.stage, variant)}
        </li>
      );
    }
    rows.push(
      <li key={i} className={a.action === 'fold' ? 'text-gray-400 dark:text-gray-500' : 'text-gray-700 dark:text-gray-300'}>
        {describeAction(a, names.get(a.playerId) || 'Player', money)}
      </li>
    );
  });

  return (
    <div className={embedded ? '' : 'surface p-5'}>
      <h3 className="section-title mb-3">
        Action{handNumber ? <span className="font-normal text-gray-500 dark:text-gray-400"> · Hand #{handNumber}</span> : null}
      </h3>
      {rows.length === 0 ? (
        <p className="text-xs text-gray-500 dark:text-gray-400">No actions yet this hand.</p>
      ) : (
        <ol ref={listRef} className="max-h-64 overflow-y-auto space-y-0.5 text-[13px] leading-5" aria-live="polite" aria-label="Actions this hand">
          {rows}
        </ol>
      )}
    </div>
  );
}
