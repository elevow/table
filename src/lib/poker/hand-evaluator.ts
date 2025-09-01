import { Card, HandRanking, HandRank } from '../../types/poker';
import { HandInterface } from '../../types/poker-engine';

// Using require for pokersolver as it doesn't support ES modules
const pokersolver = require('pokersolver').Hand;

interface PokerSolverCard {
  value: string;
  suit: string;
  toString(): string;
}

export class HandEvaluator {
  private static readonly suitMap: { [key: string]: string } = {
    'hearts': 'h',
    'diamonds': 'd',
    'clubs': 'c',
    'spades': 's'
  };

  private static cardToString(card: Card): string {
    const rankMap: { [key: string]: string } = {
      '10': 'T',
      'J': 'J',
      'Q': 'Q',
      'K': 'K',
      'A': 'A'
    };
    const rank = rankMap[card.rank] || card.rank;
    return `${rank}${this.suitMap[card.suit]}`;
  }

  private static cardsToString(cards: Card[]): string[] {
    return cards.map(card => this.cardToString(card));
  }

  static evaluateHand(holeCards: Card[], communityCards: Card[]): { hand: HandInterface; cards: Card[] } {
    const allCards = [...holeCards, ...communityCards];
    const cardStrings = this.cardsToString(allCards);
    const hand = pokersolver.solve(cardStrings);
    
    // Map the cards in the winning hand back to our Card objects
    const winningCards = hand.cards.map((solverCard: PokerSolverCard) => {
      const rank = (solverCard.value === 'T' ? '10' : solverCard.value) as Card['rank'] | string;
      const suit = Object.keys(this.suitMap).find(key => this.suitMap[key] === solverCard.suit) as Card['suit'] | undefined;
      const found = allCards.find(card => card.rank === (rank as Card['rank']) && card.suit === suit);
      // Fallback: construct a Card if mapping fails (should not happen, but be resilient in tests)
      return found || ({ rank: rank as Card['rank'], suit: (suit || 'hearts') as Card['suit'] });
    });

    return { 
      hand: {
        rank: hand.rank,
        description: hand.descr,
        cards: hand.cards
      },
      cards: winningCards 
    };
  }

  static compareHands(hand1: HandInterface, hand2: HandInterface): number {
    // Convert string cards back to Card objects for solving
    const convertToCards = (hand: HandInterface): Card[] => {
      return hand.cards.map(card => ({
        suit: Object.keys(this.suitMap).find(
          key => this.suitMap[key] === card.suit
        ) as Card['suit'],
        rank: card.value === 'T' ? '10' : card.value as Card['rank']
      }));
    };

  const solved1 = pokersolver.solve(this.cardsToString(convertToCards(hand1)));
  const solved2 = pokersolver.solve(this.cardsToString(convertToCards(hand2)));
  const winners = pokersolver.winners([solved1, solved2]);
  // If both are winners, it's a tie
  if (winners.length > 1) return 0;
  return winners[0] === solved1 ? 1 : -1;
  }

  /**
   * Build a HandRanking view (US-026) from given cards.
   * Uses current evaluator output and derives basic fields; kickers default empty
   * because the underlying solver already encodes them in order of cards.
   */
  static getHandRanking(holeCards: Card[], communityCards: Card[]): HandRanking {
    const { hand, cards } = this.evaluateHand(holeCards, communityCards);

    // Map pokersolver description -> our HandRank enum
    const desc = String(hand.description || '').toLowerCase();

    // Utility: rank weight for sorting kickers
    const weight: Record<Card['rank'], number> = {
      '2': 2,
      '3': 3,
      '4': 4,
      '5': 5,
      '6': 6,
      '7': 7,
      '8': 8,
      '9': 9,
      '10': 10,
      'J': 11,
      'Q': 12,
      'K': 13,
      'A': 14,
    };

    // Determine if the best 5 cards form a royal flush (A,K,Q,J,10 same suit)
    const isRoyal = (() => {
      if (!desc.includes('straight') || !desc.includes('flush')) return false;
      const ranks = new Set(cards.map(c => c.rank));
      const suits = new Set(cards.map(c => c.suit));
      return (
        suits.size === 1 &&
        ['A', 'K', 'Q', 'J', '10'].every(r => ranks.has(r as Card['rank']))
      );
    })();

    let mappedRank: HandRank;
    if (isRoyal) {
      mappedRank = HandRank.RoyalFlush;
    } else if (desc.includes('straight flush')) {
      mappedRank = HandRank.StraightFlush;
    } else if (desc.includes('four of a kind')) {
      mappedRank = HandRank.FourOfAKind;
    } else if (desc.includes('full house')) {
      mappedRank = HandRank.FullHouse;
    } else if (desc.includes('flush')) {
      mappedRank = HandRank.Flush;
    } else if (desc.includes('straight')) {
      mappedRank = HandRank.Straight;
    } else if (desc.includes('three of a kind') || desc.includes('trips')) {
      mappedRank = HandRank.ThreeOfAKind;
    } else if (desc.includes('two pair')) {
      mappedRank = HandRank.TwoPair;
    } else if (desc.includes('pair')) {
      mappedRank = HandRank.OnePair;
    } else {
      mappedRank = HandRank.HighCard;
    }

    // Compute kickers as remaining cards (by rank, high to low) not in the best 5
    const all = [...holeCards, ...communityCards];
    const key = (c: Card) => `${c.rank}-${c.suit}`;
    const bestKeys = new Set(cards.map(key));
    const kickers = all
      .filter(c => !bestKeys.has(key(c)))
      .sort((a, b) => weight[b.rank] - weight[a.rank]);

    return {
      rank: mappedRank,
      name: isRoyal ? 'Royal Flush' : (hand.description || ''),
      cards,
      kickers,
      strength: mappedRank,
    };
  }
}
