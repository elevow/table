import React from 'react';
import { BET_PRESETS, computePresetAmount, nudgeAmount, supportsBetPresets, type BetPreset } from '../lib/shared/bet-sizing';

interface Props {
  kind: 'bet' | 'raise';
  bettingMode?: string;
  pot: number;
  currentBet: number;
  myBet: number;
  /** Legal bounds for this action in the table's betting mode. */
  min: number;
  max: number;
  bigBlind: number;
  value: number;
  onChange: (amount: number) => void;
}

// Keyboard shortcuts find these buttons by their data attributes (1-4 and A)
const SHORTCUT_KEY: Record<BetPreset, string> = {
  min: '1',
  half: '2',
  'two-thirds': '3',
  pot: '4',
  'all-in': 'allin',
};

const buttonClass = 'px-2 py-1 min-h-[40px] sm:min-h-0 text-xs rounded bg-gray-200 hover:bg-gray-300 text-gray-900 dark:bg-gray-700 dark:hover:bg-gray-600 dark:text-gray-100';

/**
 * Quick amounts for the bet and raise controls. Hidden for betting modes without free sizing.
 */
export default function BetPresetButtons({ kind, bettingMode, pot, currentBet, myBet, min, max, bigBlind, value, onChange }: Props) {
  if (!supportsBetPresets(bettingMode)) return null;
  return (
    <div className="flex flex-wrap gap-2" role="group" aria-label={kind === 'bet' ? 'Bet size presets' : 'Raise size presets'}>
      {BET_PRESETS.map(({ preset, label, title }) => (
        <button
          key={preset}
          type="button"
          className={buttonClass}
          title={title}
          data-shortcut-preset={SHORTCUT_KEY[preset]}
          onClick={() => onChange(computePresetAmount({ preset, kind, pot, currentBet, myBet, min, max, bigBlind }))}
        >
          {label}
        </button>
      ))}
      <button
        type="button"
        className={buttonClass}
        title="One big blind less"
        aria-label="One big blind less"
        data-shortcut-nudge="down"
        onClick={() => onChange(nudgeAmount(value, -1, bigBlind, min, max))}
      >
        −BB
      </button>
      <button
        type="button"
        className={buttonClass}
        title="One big blind more"
        aria-label="One big blind more"
        data-shortcut-nudge="up"
        onClick={() => onChange(nudgeAmount(value, 1, bigBlind, min, max))}
      >
        +BB
      </button>
    </div>
  );
}
