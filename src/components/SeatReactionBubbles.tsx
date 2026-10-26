import React from 'react';
import type { ReactionBubble } from '../hooks/useTableReactions';

/** Where a seated player sits on the felt, as the seat's CSS left/top. */
export interface SeatAnchor {
  playerId: string;
  left: string;
  top: string;
}

interface Props {
  anchors: SeatAnchor[];
  bubbles: Record<string, ReactionBubble>;
  nameOf: (playerId: string) => string;
}

/** Reaction bubbles drawn just above each seat. Purely visual; never blocks clicks. */
export default function SeatReactionBubbles({ anchors, bubbles, nameOf }: Props) {
  return (
    <>
      {anchors.map(anchor => {
        const bubble = bubbles[anchor.playerId];
        if (!bubble) return null;
        return (
          <div
            key={`${anchor.playerId}-${bubble.id}`}
            className="absolute z-30 pointer-events-none"
            style={{ left: anchor.left, top: `calc(${anchor.top} - 44px)`, transform: 'translate(-50%, -50%)' }}
          >
            <div
              className="table-reaction-pop rounded-full border border-gray-200 bg-white px-2.5 py-1 text-xl leading-none text-gray-900 shadow-lg dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
              role="img"
              aria-label={`${nameOf(anchor.playerId)} reacts ${bubble.emote}`}
            >
              {bubble.emote === 'GG' ? <span className="text-sm font-bold">GG</span> : bubble.emote}
            </div>
          </div>
        );
      })}
    </>
  );
}
