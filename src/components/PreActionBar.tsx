import React from 'react';
import type { PreAction } from '../lib/shared/pre-action';

interface Props {
  /** Chips the player would need to put in to call right now. */
  owed: number;
  selected: PreAction | null;
  onSelect: (pre: PreAction | null) => void;
  formatAmount: (amount: number) => string;
  /** The player's stack; a call costs at most this (all-in for less). */
  stack?: number;
}

const isSame = (a: PreAction | null, b: PreAction) =>
  !!a && a.type === b.type && (a.type !== 'call' || (b.type === 'call' && a.amount === b.amount));

/**
 * Buttons to queue a decision before your turn. Clicking the selected one again clears it.
 */
export default function PreActionBar({ owed, selected, onSelect, formatAmount, stack }: Props) {
  const options: Array<{ pre: PreAction; label: string; title: string }> = owed > 0
    ? [
        { pre: { type: 'check-fold' }, label: 'Fold', title: 'Fold when it is your turn (check instead if the bet is withdrawn)' },
        { pre: { type: 'call', amount: owed }, label: `Call ${formatAmount(typeof stack === 'number' ? Math.min(owed, stack) : owed)}`, title: 'Call this amount; cancelled if someone raises' },
        { pre: { type: 'call-any' }, label: 'Call any', title: 'Call whatever it costs when it is your turn' },
      ]
    : [
        { pre: { type: 'check-fold' }, label: 'Check/Fold', title: 'Check if you can, otherwise fold' },
        { pre: { type: 'check' }, label: 'Check', title: 'Check if nobody bets; cancelled if someone does' },
        { pre: { type: 'call-any' }, label: 'Call any', title: 'Check, or call any bet, when it is your turn' },
      ];

  return (
    <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Pre-select your action">
      <span className="eyebrow mr-1">Pre-action</span>
      {options.map(({ pre, label, title }) => {
        const active = isSame(selected, pre);
        return (
          <button
            key={pre.type}
            type="button"
            onClick={() => onSelect(active ? null : pre)}
            title={title}
            aria-pressed={active}
            className={`btn btn-sm ${
              active
                ? 'border border-emerald-400/60 bg-emerald-50 text-emerald-800 dark:bg-emerald-400/15 dark:text-emerald-200'
                : 'btn-secondary'
            }`}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}
