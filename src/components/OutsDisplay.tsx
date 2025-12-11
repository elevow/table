import React from 'react';
import { Card } from '../types/poker';

interface OutsDisplayProps {
  outs: Card[];
  oddsNextCard: number;
  oddsByRiver?: number;
  outsByCategory?: {
    category: string;
    cards: Card[];
    count: number;
  }[];
  losingPlayerName?: string;
  winningPlayerName?: string;
}

/**
 * Component to display outs and odds for a losing hand after an all-in
 */
export const OutsDisplay: React.FC<OutsDisplayProps> = ({
  outs,
  oddsNextCard,
  oddsByRiver,
  outsByCategory,
  losingPlayerName,
  winningPlayerName
}) => {
  // Helper to get suit color class
  const getSuitColorClass = (suit: Card['suit']) => {
    return suit === 'hearts' || suit === 'diamonds'
      ? 'text-red-600 dark:text-red-400'
      : 'text-gray-800 dark:text-gray-200';
  };

  // Helper to get suit symbol
  const getSuitSymbol = (suit: Card['suit']) => {
    switch (suit) {
      case 'hearts': return '♥';
      case 'diamonds': return '♦';
      case 'clubs': return '♣';
      case 'spades': return '♠';
    }
  };

  if (outs.length === 0) {
    return null;
  }

  return (
    <div className="bg-blue-50 dark:bg-blue-900/30 border border-blue-300 dark:border-blue-700 text-blue-900 dark:text-blue-100 rounded-lg shadow-md p-4 mt-4">
      <h3 className="text-lg font-semibold mb-2 flex items-center gap-2">
        <span className="inline-block px-2 py-0.5 text-xs rounded bg-blue-600 text-white">OUTS</span>
        {losingPlayerName ? `${losingPlayerName}'s Outs` : 'Outs to Win'}
      </h3>
      
      <div className="text-sm mb-3">
        {losingPlayerName && winningPlayerName ? (
          <p className="opacity-90">
            Cards that would improve <span className="font-semibold">{losingPlayerName}</span>&apos;s hand to beat <span className="font-semibold">{winningPlayerName}</span>
          </p>
        ) : (
          <p className="opacity-90">Cards that would improve the losing hand</p>
        )}
      </div>

      {/* Odds Display */}
      <div className="grid grid-cols-2 gap-3 mb-4">
        <div className="bg-white dark:bg-gray-800 rounded-lg p-3 border border-blue-200 dark:border-blue-800">
          <div className="text-xs opacity-70 mb-1">Next Card</div>
          <div className="text-2xl font-bold text-blue-600 dark:text-blue-400">
            {oddsNextCard.toFixed(1)}%
          </div>
          <div className="text-xs opacity-70 mt-1">
            {outs.length} {outs.length === 1 ? 'out' : 'outs'}
          </div>
        </div>
        
        {oddsByRiver !== undefined && (
          <div className="bg-white dark:bg-gray-800 rounded-lg p-3 border border-blue-200 dark:border-blue-800">
            <div className="text-xs opacity-70 mb-1">By River</div>
            <div className="text-2xl font-bold text-blue-600 dark:text-blue-400">
              {oddsByRiver.toFixed(1)}%
            </div>
            <div className="text-xs opacity-70 mt-1">
              Combined odds
            </div>
          </div>
        )}
      </div>

      {/* Cards by Category */}
      {outsByCategory && outsByCategory.length > 0 && (
        <div className="space-y-3">
          {outsByCategory.map((category, idx) => (
            <div key={idx} className="bg-white dark:bg-gray-800 rounded-lg p-3 border border-blue-200 dark:border-blue-800">
              <div className="text-sm font-semibold mb-2">
                {category.category} ({category.count} {category.count === 1 ? 'card' : 'cards'})
              </div>
              <div className="flex flex-wrap gap-1">
                {category.cards.map((card, cardIdx) => (
                  <div
                    key={cardIdx}
                    className="bg-white dark:bg-gray-700 rounded border border-gray-300 dark:border-gray-600 text-xs p-1 w-8 h-11 flex flex-col items-center justify-center font-bold shadow-sm"
                  >
                    <div className="text-gray-800 dark:text-gray-100">{card.rank}</div>
                    <div className={getSuitColorClass(card.suit)}>
                      {getSuitSymbol(card.suit)}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* All Outs (collapsed view if many) */}
      {outs.length > 20 && (
        <details className="mt-3">
          <summary className="cursor-pointer text-sm font-medium hover:text-blue-700 dark:hover:text-blue-300">
            Show all {outs.length} outs
          </summary>
          <div className="mt-2 flex flex-wrap gap-1">
            {outs.map((card, idx) => (
              <div
                key={idx}
                className="bg-white dark:bg-gray-700 rounded border border-gray-300 dark:border-gray-600 text-xs p-1 w-8 h-11 flex flex-col items-center justify-center font-bold shadow-sm"
              >
                <div className="text-gray-800 dark:text-gray-100">{card.rank}</div>
                <div className={getSuitColorClass(card.suit)}>
                  {getSuitSymbol(card.suit)}
                </div>
              </div>
            ))}
          </div>
        </details>
      )}
    </div>
  );
};

export default OutsDisplay;
