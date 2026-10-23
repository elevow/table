import React from 'react';
import type { PreAction } from '../lib/shared/pre-action';

interface Props {
  /** Chips the player would need to put in to call right now. */
  owed: number;
  selected: PreAction | null;
  onSelect: (pre: PreAction | null) => void;
  formatAmount: (amount: number) => string;
}

const isSame = (a: PreAction | null, b: PreAction) =>
  !!a && a.type === b.type && (a.type !== 'call' || (b.type === 'call' && a.amount === b.amount));

/**
 * Buttons to queue a decision before your turn. Clicking the selected one again clears it.
 */
export default function PreActionBar({ owed, selected, onSelect, formatAmount }: Props) {
  const options: Array<{ pre: PreAction; label: string; title: string }> = owed > 0
    ? [
        { pre: { type: 'check-fold' }, label: 'Fold', title: 'Fold when it is your turn (check instead if the bet is withdrawn)' },
        { pre: { type: 'call', amount: owed }, label: `Call ${formatAmount(owed)}`, title: 'Call this amount; cancelled if someone raises' },
        { pre: { type: 'call-any' }, label: 'Call Any', title: 'Call whatever it costs when it is your turn' },
      ]
    : [
        { pre: { type: 'check-fold' }, label: 'Check/Fold', title: 'Check if you can, otherwise fold' },
        { pre: { type: 'check' }, label: 'Check', title: 'Check if nobody bets; cancelled if someone does' },
        { pre: { type: 'call-any' }, label: 'Call Any', title: 'Check, or call any bet, when it is your turn' },
      ];

  return (
    <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Pre-select your action">
      <span className="text-xs text-gray-600 dark:text-gray-300">Pre-action:</span>
      {options.map(({ pre, label, title }) => {
        const active = isSame(selected, pre);
        return (
          <button
            key={pre.type}
            type="button"
            onClick={() => onSelect(active ? null : pre)}
            title={title}
            aria-pressed={active}
            className={`px-3 py-1 rounded text-sm border transition-colors ${
              active
                ? 'bg-blue-600 border-blue-600 text-white'
                : 'bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-600 text-gray-800 dark:text-gray-100 hover:bg-gray-50 dark:hover:bg-gray-700'
            }`}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}
