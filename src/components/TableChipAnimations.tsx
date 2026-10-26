import React, { useEffect, useRef, useState } from 'react';
import { chipSnapshot, diffChipMoves, POT, type ChipMove, type ChipSnapshot } from '../lib/shared/table-animations';
import type { SeatAnchor } from './SeatReactionBubbles';

interface Props {
  anchors: SeatAnchor[];
  gameState: any;
}

// Where the pot label sits on the felt (centre, just below the board)
const POT_POINT = { left: '50%', top: 'calc(50% + 32px)' };
// Remove a chip even if its animationend never fires (hidden tab, interrupted animation)
const CHIP_LIFETIME_MS = 1600;

type Sprite = ChipMove & { fromPoint: { left: string; top: string }; toPoint: { left: string; top: string } };

const prefersReducedMotion = () => {
  try {
    return typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
};

/**
 * Chips flying from a seat into the pot when a player puts money in, and from the pot to the
 * winners when the hand is settled. Purely decorative: it reacts to states that have already
 * arrived and shows nothing when the player asked for reduced motion.
 */
export default function TableChipAnimations({ anchors, gameState }: Props) {
  const [sprites, setSprites] = useState<Sprite[]>([]);
  const prevRef = useRef<ChipSnapshot | null>(null);
  const anchorsRef = useRef(anchors);
  anchorsRef.current = anchors;
  const timersRef = useRef<Array<ReturnType<typeof setTimeout>>>([]);

  useEffect(() => {
    const next = chipSnapshot(gameState);
    if (!next) return;
    const moves = diffChipMoves(prevRef.current, next);
    prevRef.current = next;
    if (moves.length === 0 || prefersReducedMotion()) return;

    const pointOf = (who: string) => {
      if (who === POT) return POT_POINT;
      const anchor = anchorsRef.current.find(a => a.playerId === who);
      return anchor ? { left: anchor.left, top: anchor.top } : null;
    };
    const fresh: Sprite[] = [];
    for (const move of moves) {
      const fromPoint = pointOf(move.from);
      const toPoint = pointOf(move.to);
      if (fromPoint && toPoint) fresh.push({ ...move, fromPoint, toPoint });
    }
    if (fresh.length === 0) return;
    setSprites(prev => [...prev.filter(s => !fresh.some(f => f.id === s.id)), ...fresh]);
    const ids = new Set(fresh.map(s => s.id));
    timersRef.current.push(setTimeout(() => setSprites(prev => prev.filter(s => !ids.has(s.id))), CHIP_LIFETIME_MS));
  }, [gameState]);

  useEffect(() => () => timersRef.current.forEach(clearTimeout), []);

  if (sprites.length === 0) return null;
  return (
    <div className="absolute inset-0 pointer-events-none z-20" aria-hidden="true">
      {sprites.map(sprite => (
        <div
          key={sprite.id}
          className={`table-chip-fly ${sprite.from === POT ? 'table-chip-fly-win' : ''}`}
          style={{
            '--chip-from-x': sprite.fromPoint.left,
            '--chip-from-y': sprite.fromPoint.top,
            '--chip-to-x': sprite.toPoint.left,
            '--chip-to-y': sprite.toPoint.top,
          } as React.CSSProperties}
          onAnimationEnd={() => setSprites(prev => prev.filter(s => s.id !== sprite.id))}
        >
          <span className="block w-4 h-4 rounded-full bg-yellow-400 border-2 border-dashed border-white shadow-md dark:bg-yellow-500" />
        </div>
      ))}
    </div>
  );
}
