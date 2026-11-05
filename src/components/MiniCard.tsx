import React from 'react';
import type { Card } from '../types/poker';
import { suitColorClass } from '../lib/shared/display-settings';

const SUIT_SYMBOL: Record<Card['suit'], string> = { hearts: '♥', diamonds: '♦', clubs: '♣', spades: '♠' };

/** A small playing card, or a card back when `card` is omitted. `highContrast` follows the player's display setting. */
export default function MiniCard({ card, size = 'sm', highContrast = false }: { card?: Card; size?: 'sm' | 'md'; highContrast?: boolean }) {
  const box = size === 'md' ? 'w-10 h-14 text-sm' : 'w-8 h-12 text-[11px]';
  if (!card) {
    return (
      <div className={`${box} card-back`} aria-label="Hidden card"><div className="card-back-inner" /></div>
    );
  }
  return (
    <div
      className={`${box} playing-card gap-0.5 ${suitColorClass(card.suit, highContrast)}`}
      aria-label={`${card.rank} of ${card.suit}`}
    >
      <span>{card.rank}</span>
      <span>{SUIT_SYMBOL[card.suit]}</span>
    </div>
  );
}
