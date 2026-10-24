import React from 'react';
import type { Card } from '../types/poker';

const SUIT_SYMBOL: Record<Card['suit'], string> = { hearts: '♥', diamonds: '♦', clubs: '♣', spades: '♠' };

/** A small playing card, or a card back when `card` is omitted. */
export default function MiniCard({ card, size = 'sm' }: { card?: Card; size?: 'sm' | 'md' }) {
  const box = size === 'md' ? 'w-10 h-14 text-sm' : 'w-8 h-12 text-[11px]';
  if (!card) {
    return (
      <div className={`${box} rounded border border-blue-700 bg-gradient-to-br from-blue-500 to-blue-700 shadow`} aria-label="Hidden card" />
    );
  }
  const red = card.suit === 'hearts' || card.suit === 'diamonds';
  return (
    <div
      className={`${box} rounded border bg-white font-bold shadow flex flex-col items-center justify-center ${red ? 'text-red-600' : 'text-gray-900'}`}
      aria-label={`${card.rank} of ${card.suit}`}
    >
      <span>{card.rank}</span>
      <span>{SUIT_SYMBOL[card.suit]}</span>
    </div>
  );
}
