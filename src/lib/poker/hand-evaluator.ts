import { Card } from '../../types/poker';
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
      const rank = solverCard.value === 'T' ? '10' : solverCard.value;
      return allCards.find(card => 
        card.rank === rank && 
        card.suit === Object.keys(this.suitMap).find(key => this.suitMap[key] === solverCard.suit)
      )!;
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
    
    return solved1.rank === pokersolver.winners([solved1, solved2])[0].rank ? 1 : -1;
  }
}
