import React from 'react';
import { BASE_TURN_MS, LOW_TIME_WARNING_MS } from '../lib/shared/turn-clock';
import type { TurnClock } from '../hooks/useTurnClock';

interface Props {
  clock: TurnClock;
  /** Smaller version for a seat's info box. */
  compact?: boolean;
}

/**
 * Countdown for the player to act: the base time first, then the time bank. Turns red when time
 * is running low.
 */
export default function TurnClockBar({ clock, compact = false }: Props) {
  if (clock.remainingMs === null || clock.baseRemainingMs === null) return null;
  const remaining = Math.max(0, clock.remainingMs);
  const seconds = Math.ceil(remaining / 1000);
  const low = remaining <= LOW_TIME_WARNING_MS;
  const fraction = clock.inTimeBank
    ? 1
    : Math.max(0, Math.min(1, clock.baseRemainingMs / (clock.baseMs || BASE_TURN_MS)));
  const barColor = low ? 'bg-red-500' : clock.inTimeBank ? 'bg-amber-500' : 'bg-emerald-500';
  const label = remaining === 0
    ? 'Time’s up'
    : clock.inTimeBank
      ? `Time bank ${seconds}s`
      : `${Math.ceil(clock.baseRemainingMs / 1000)}s`;

  return (
    <div
      className={compact ? 'mt-1 w-full' : 'mb-3 w-full'}
      role="timer"
      aria-live="off"
      aria-label={`Time to act: ${label}`}
    >
      <div className={`flex items-center justify-between ${compact ? 'text-[10px]' : 'text-xs'} font-semibold ${low ? 'text-red-600 dark:text-red-400' : clock.inTimeBank ? 'text-amber-600 dark:text-amber-400' : 'text-gray-600 dark:text-gray-300'}`}>
        <span>{compact ? '' : 'Time to act'}</span>
        <span className="tabular-nums">{label}</span>
      </div>
      <div className={`w-full ${compact ? 'h-1' : 'h-1.5'} rounded bg-gray-200 dark:bg-gray-700 overflow-hidden`}>
        <div
          className={`h-full ${barColor} transition-[width] duration-200 ease-linear`}
          style={{ width: `${fraction * 100}%` }}
        />
      </div>
    </div>
  );
}
