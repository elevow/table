import React from 'react';
import { TABLE_REACTIONS, type TableReaction } from '../lib/shared/reactions';

interface Props {
  onReact: (emote: TableReaction) => void;
  coolingDown: boolean;
  muted: boolean;
  onToggleMuted: (muted: boolean) => void;
}

/**
 * Row of quick reactions for seated players. Hiding reactions removes the row and everyone's
 * reaction bubbles, leaving a single button to bring them back.
 */
export default function ReactionPicker({ onReact, coolingDown, muted, onToggleMuted }: Props) {
  if (muted) {
    return (
      <div className="mt-10 max-sm:mt-2 flex justify-center">
        <button
          type="button"
          onClick={() => onToggleMuted(false)}
          aria-pressed={false}
          title="Show reactions at this table"
          className="min-h-[40px] rounded-lg border border-gray-300 bg-white px-3 text-xs text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700"
        >
          Show reactions
        </button>
      </div>
    );
  }
  return (
    // The top margin clears our own seat, which hangs below the felt on wide screens
    <div className="mt-10 max-sm:mt-2 flex flex-wrap items-center justify-center gap-2" role="group" aria-label="Table reactions">
      {TABLE_REACTIONS.map(emote => (
        <button
          key={emote}
          type="button"
          onClick={() => onReact(emote)}
          disabled={coolingDown}
          aria-label={`React with ${emote}`}
          title={`React with ${emote}`}
          className="min-w-[40px] min-h-[40px] rounded-full border border-gray-300 bg-white px-2 text-lg leading-none text-gray-900 shadow-sm hover:bg-gray-50 disabled:opacity-50 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 dark:hover:bg-gray-700"
        >
          {emote === 'GG' ? <span className="text-sm font-bold">GG</span> : emote}
        </button>
      ))}
      <button
        type="button"
        onClick={() => onToggleMuted(true)}
        aria-pressed={true}
        title="Hide reactions at this table"
        className="min-h-[40px] rounded-lg border border-gray-300 bg-white px-3 text-xs text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700"
      >
        Hide reactions
      </button>
    </div>
  );
}
