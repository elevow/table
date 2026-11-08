import React from 'react';
import type { Card } from '../types/poker';
import { suitColorClass } from '../lib/shared/display-settings';

const SUIT_SYMBOL: Record<string, string> = { hearts: '♥', diamonds: '♦', clubs: '♣', spades: '♠' };

export type TableCardSize = 'xs' | 'sm' | 'md' | 'lg';

// Card box, corner rank and the large suit on the face, for each size
const SIZES: Record<TableCardSize, { box: string; rank: string; pip: string }> = {
  // Opponents' stud cards (matching the card backs beside them), run-it-twice boards
  xs: { box: 'w-8 h-12 rounded-md', rank: 'text-[15px]', pip: 'text-[22px]' },
  // Opponents' cards shown at showdown, and your own seven stud cards
  sm: { box: 'w-10 h-14 rounded-md', rank: 'text-lg', pip: 'text-[28px]' },
  // The board
  md: {
    // Phones keep the board as wide as it was, so it reaches no further toward the side seats
    box: 'w-12 h-[68px] max-sm:w-9 max-sm:h-[52px] rounded-lg',
    rank: 'text-2xl max-sm:text-lg',
    pip: 'text-[38px] max-sm:text-[26px]',
  },
  // Your own hole cards
  lg: {
    box: 'w-14 h-20 max-sm:w-12 max-sm:h-[68px] rounded-lg',
    rank: 'text-[28px] max-sm:text-2xl',
    pip: 'text-[46px] max-sm:text-[38px]',
  },
};

type Props = {
  card: Pick<Card, 'rank' | 'suit'>;
  size?: TableCardSize;
  highContrast?: boolean;
  className?: string;
  style?: React.CSSProperties;
  title?: string;
};

/**
 * A card face on the table: a large rank in the top corner, where it stays readable when cards
 * overlap, and a big suit on the face. Rank and suit share the suit's colour.
 */
export default function TableCard({ card, size = 'md', highContrast = false, className = '', style, title }: Props) {
  const s = SIZES[size];
  const symbol = SUIT_SYMBOL[card.suit] || '';
  return (
    <div
      className={`playing-card overflow-hidden ${s.box} ${suitColorClass(card.suit, highContrast)} ${className}`}
      style={style}
      title={title}
      aria-label={`${card.rank} of ${card.suit}`}
      role="img"
    >
      <span className={`absolute left-[9%] top-[5%] leading-none font-bold tracking-tighter ${s.rank}`} aria-hidden="true">
        {card.rank}
      </span>
      <span className={`absolute right-[7%] bottom-[3%] leading-none ${s.pip}`} aria-hidden="true">{symbol}</span>
    </div>
  );
}
