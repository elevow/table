import type { Hand } from 'pokersolver';
import { Card, HandResult } from '../types/poker';

// Using require for pokersolver as it doesn't support ES modules
const pokersolver = require('pokersolver').Hand;

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

  static evaluateHand(holeCards: Card[], communityCards: Card[]): { hand: Hand; cards: Card[] } {
    const allCards = [...holeCards, ...communityCards];
    const cardStrings = this.cardsToString(allCards);
    const hand = pokersolver.solve(cardStrings);
    
    // Map the cards in the winning hand back to our Card objects
    const winningCards = hand.cards.map(solverCard => {
      const rank = solverCard.value === 'T' ? '10' : solverCard.value;
      return allCards.find(card => 
        card.rank === rank && 
        card.suit === Object.keys(this.suitMap).find(key => this.suitMap[key] === solverCard.suit)
      )!;
    });

    return { hand, cards: winningCards };
  }

  static determineWinners(players: { id: string; holeCards: Card[] }[], communityCards: Card[]): HandResult[] {
    // Get all player hands
    const playerHands = players
      .filter(p => p.holeCards && p.holeCards.length === 2)
      .map(player => {
        const { hand, cards } = this.evaluateHand(player.holeCards, communityCards);
        return {
          playerId: player.id,
          hand: cards,
          solverHand: hand,
          description: hand.name,
          strength: hand.rank
        };
      });

    // Find the highest rank
    const maxRank = Math.max(...playerHands.map(h => h.strength));
    
    // Get all players with the highest rank
    const winners = playerHands.filter(h => h.strength === maxRank);

    // Convert to HandResult format
    return winners.map(winner => ({
      playerId: winner.playerId,
      hand: winner.hand,
      description: winner.description,
      strength: winner.strength,
      winAmount: 0 // This will be set by the pot distribution logic
    }));
  }
}
