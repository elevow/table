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
      <div className="lg:mt-0 lg:absolute lg:left-[calc(50%+84px)] lg:top-[384px] flex justify-center">
        <button
          type="button"
          onClick={() => onToggleMuted(false)}
          aria-pressed={false}
          title="Show reactions at this table"
          className="min-h-[40px] rounded-lg border border-gray-300 bg-white px-3 text-xs text-gray-700 hover:bg-gray-50 dark:border-white/10 dark:bg-white/4 dark:text-gray-200 dark:hover:bg-white/8"
        >
          Show reactions
        </button>
      </div>
    );
  }
  return (
    // The top margin clears our own seat and its name plate, which hang below the felt
    <div className="lg:mt-0 lg:absolute lg:left-[calc(50%+84px)] lg:top-[384px] lg:flex-nowrap lg:gap-1.5 flex flex-wrap items-center justify-center gap-2" role="group" aria-label="Table reactions">
      {TABLE_REACTIONS.map(emote => (
        <button
          key={emote}
          type="button"
          onClick={() => onReact(emote)}
          disabled={coolingDown}
          aria-label={`React with ${emote}`}
          title={`React with ${emote}`}
          className="min-w-[40px] min-h-[40px] lg:min-w-[34px] lg:min-h-[34px] lg:text-base rounded-full border border-gray-300 bg-white px-2 text-lg leading-none text-gray-900 shadow-xs hover:bg-gray-50 disabled:opacity-50 dark:border-white/10 dark:bg-white/4 dark:text-gray-100 dark:hover:bg-white/8"
        >
          {emote === 'GG' ? <span className="text-sm font-bold">GG</span> : emote}
        </button>
      ))}
      <button
        type="button"
        onClick={() => onToggleMuted(true)}
        aria-pressed={true}
        title="Hide reactions at this table"
        aria-label="Hide reactions"
        className="flex min-w-[40px] min-h-[40px] lg:min-w-[34px] lg:min-h-[34px] items-center justify-center rounded-full border border-dashed border-gray-300 text-gray-500 hover:bg-gray-50 hover:text-gray-700 dark:border-white/15 dark:text-gray-400 dark:hover:bg-white/6 dark:hover:text-gray-200"
      >
        <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M17.9 17.9A10 10 0 0112 20c-7 0-10-8-10-8a18 18 0 014.1-5.9M9.9 4.2A9 9 0 0112 4c7 0 10 8 10 8a18 18 0 01-2.2 3.3M14.1 14.1a3 3 0 01-4.2-4.2M2 2l20 20" />
        </svg>
      </button>
    </div>
  );
}
