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
  /** What this player last bet or raised to, if they have this session. */
  lastBet?: number;
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

const buttonClass = 'btn btn-sm btn-secondary px-2.5! shrink-0 sm:flex-1 max-sm:h-10 max-sm:px-0! max-sm:text-[11px]';

/**
 * Quick amounts for the bet and raise controls. Hidden for betting modes without free sizing.
 */
export default function BetPresetButtons({ kind, bettingMode, pot, currentBet, myBet, min, max, bigBlind, value, lastBet, onChange }: Props) {
  if (!supportsBetPresets(bettingMode)) return null;
  const hasLastBet = !!lastBet && lastBet > 0;
  return (
    <div className={`flex flex-wrap gap-1.5 sm:flex-1 sm:flex-nowrap max-sm:grid max-sm:w-full max-sm:gap-1 ${hasLastBet ? 'max-sm:grid-cols-8' : 'max-sm:grid-cols-7'}`} role="group" aria-label={kind === 'bet' ? 'Bet size presets' : 'Raise size presets'}>
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
      {hasLastBet && (
        <button
          type="button"
          className={buttonClass}
          title={`Your last bet: $${lastBet}`}
          onClick={() => onChange(Math.max(min, Math.min(max, lastBet as number)))}
        >
          Last
        </button>
      )}
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
